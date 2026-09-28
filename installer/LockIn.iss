; Lock In installer.
;
; Double-click, one UAC prompt, then the account checkboxes. The setup installs
; the self-contained service and tray app, migrates an existing PowerShell
; watchdog, and never opens a terminal. Inno Setup was chosen over WiX because
; the product needs a single user-facing wizard with a dynamic account page and
; in-place upgrade/rollback logic, not an MSI package for enterprise
; deployment; Inno produces one .exe and its Pascal script can run that logic
; directly.

#define MyAppName "Lock In"
#define MyAppVersion GetEnv('LOCKIN_VERSION')
#if MyAppVersion == ""
  #define MyAppVersion "0.0.0"
#endif
#define ServiceName "LockInWatchdog"

[Setup]
AppId={{9F3B7E52-4C1A-4F6E-B1D2-6A8E2C4F0B77}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=Lock In
DefaultDirName={autopf}\Lock In
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=LockIn-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupIconFile=..\windows\LockIn.App\lockin.ico
UninstallDisplayIcon={app}\LockIn.App.exe
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; The service is published as one self-contained executable, so the same file
; is both the installed service and the elevated helper the wizard runs.
Source: "..\windows\publish\service\LockIn.Service.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\windows\publish\service\LockIn.Service.exe"; DestDir: "{tmp}"; Flags: dontcopy
Source: "..\windows\publish\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\windows\.cache\MicrosoftEdgeWebView2Setup.exe"; DestDir: "{tmp}"; Flags: dontcopy

[Registry]
; The tray app starts for every account at logon; it exits quietly for
; accounts that are not protected.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LockInApp"; ValueData: """{app}\LockIn.App.exe"""; Flags: uninsdeletevalue

[Icons]
Name: "{commonstartmenu}\Lock In Emergency Disarm"; Filename: "{app}\LockIn.App.exe"; Parameters: "--emergency-disarm"; Comment: "Stop Lock In enforcing now (asks for administrator rights once)"

[Run]
Filename: "{tmp}\MicrosoftEdgeWebView2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing the WebView2 runtime…"; Flags: runhidden waituntilterminated; Check: WebView2Missing
Filename: "{app}\LockIn.App.exe"; Description: "Open the Lock In dashboard"; Flags: nowait postinstall skipifsilent

[Code]
var
  AccountsPage: TWizardPage;
  OptionsPage: TInputOptionWizardPage;
  AccountList: TNewCheckListBox;
  AccountSids: TArrayOfString;
  EraseData: Boolean;

function HelperPath(): String;
begin
  Result := ExpandConstant('{tmp}\LockIn.Service.exe');
end;

function ScPath(): String;
begin
  Result := ExpandConstant('{sys}\sc.exe');
end;

function SchTasksPath(): String;
begin
  Result := ExpandConstant('{sys}\schtasks.exe');
end;

procedure RunHidden(const FileName, Params: String);
var
  Code: Integer;
begin
  Exec(FileName, Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function WebView2Missing(): Boolean;
var
  Version: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    Result := False
  else if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    Result := False;
end;

procedure CopyDirectory(const Source, Dest: String);
var
  FindRec: TFindRec;
  SrcPath, DstPath: String;
begin
  if not DirExists(Source) then Exit;
  if not DirExists(Dest) then ForceDirectories(Dest);
  if FindFirst(Source + '\*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Name = '.') or (FindRec.Name = '..') then Continue;
        SrcPath := Source + '\' + FindRec.Name;
        DstPath := Dest + '\' + FindRec.Name;
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
          CopyDirectory(SrcPath, DstPath)
        else
          CopyFile(SrcPath, DstPath, False);
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

function SelectedSids(): String;
var
  I: Integer;
begin
  Result := '';
  for I := 0 to GetArrayLength(AccountSids) - 1 do
    if AccountList.Checked[I] then
    begin
      if Result <> '' then Result := Result + ',';
      Result := Result + AccountSids[I];
    end;
end;

function ForceExtension(): Boolean;
begin
  Result := OptionsPage.Values[1];
end;

procedure InitializeWizard();
var
  DataPath, Line, Sid, Display, IsProtected, IsLaunching, LaunchingName: String;
  Lines: TArrayOfString;
  I, P, Code: Integer;
  Checked: Boolean;
begin
  ExtractTemporaryFile('LockIn.Service.exe');
  ExtractTemporaryFile('MicrosoftEdgeWebView2Setup.exe');
  DataPath := ExpandConstant('{tmp}\lockin-accounts.tsv');
  LaunchingName := GetEnv('USERNAME');
  Exec(HelperPath(), '--setup-helper list-accounts --out "' + DataPath + '" --launching-name "' + LaunchingName + '"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);

  AccountsPage := CreateCustomPage(wpSelectDir, 'Windows accounts to protect',
    'Lock In enforces per account. Tick every account that should be contained; already-protected accounts and the account that started this installer are ticked already.');
  AccountList := TNewCheckListBox.Create(AccountsPage.Surface);
  AccountList.Parent := AccountsPage.Surface;
  AccountList.Align := alClient;
  AccountList.BorderStyle := bsNone;
  AccountList.Font.Assign(WizardForm.Font);

  if LoadStringsFromFile(DataPath, Lines) then
  begin
    for I := 0 to GetArrayLength(Lines) - 1 do
    begin
      Line := Lines[I];
      if Line = '' then Continue;
      P := Pos(#9, Line);
      if P = 0 then Continue;
      Sid := Copy(Line, 1, P - 1); Delete(Line, 1, P);
      P := Pos(#9, Line);
      Display := Copy(Line, 1, P - 1); Delete(Line, 1, P);
      P := Pos(#9, Line);
      IsProtected := Copy(Line, 1, P - 1); Delete(Line, 1, P);
      IsLaunching := Line;
      Checked := (IsProtected = '1') or (IsLaunching = '1');
      AccountList.Items.Add(Display + '  (' + Sid + ')');
      AccountList.Checked[AccountList.Items.Count - 1] := Checked;
      SetArrayLength(AccountSids, GetArrayLength(AccountSids) + 1);
      AccountSids[GetArrayLength(AccountSids) - 1] := Sid;
    end;
  end;

  if GetArrayLength(AccountSids) = 0 then
    MsgBox('No local Windows accounts could be listed. Lock In needs at least one protected account.',
      mbError, MB_OK);

  OptionsPage := CreateInputOptionPage(AccountsPage.ID, 'Browser extension',
    'How should the Lock In extension reach Chrome and Brave?',
    'The Chrome Web Store listing still serves an older build without the watchdog, so the recommended choice guides you through loading the release build by hand. The tray app will also offer to open the extensions page.',
    True, False);
  OptionsPage.Add('Guide me through loading the extension by hand (recommended for now)');
  OptionsPage.Add('Force-install it from the Chrome Web Store (only once the store serves a compatible version)');
  OptionsPage.Values[0] := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  I, Count: Integer;
begin
  Result := True;
  if CurPageID = AccountsPage.ID then
  begin
    Count := 0;
    for I := 0 to GetArrayLength(AccountSids) - 1 do
      if AccountList.Checked[I] then Count := Count + 1;
    if Count = 0 then
    begin
      MsgBox('Tick at least one Windows account to protect.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure Rollback();
begin
  RunHidden(ScPath(), 'stop {#ServiceName}');
  RunHidden(ScPath(), 'delete {#ServiceName}');
  DelTree(ExpandConstant('{app}'), True, True, True);
  if DirExists(ExpandConstant('{app}.previous')) then
  begin
    CopyDirectory(ExpandConstant('{app}.previous'), ExpandConstant('{app}'));
    DelTree(ExpandConstant('{app}.previous'), True, True, True);
    if FileExists(ExpandConstant('{app}\LockIn.Service.exe')) then
    begin
      RunHidden(ScPath(), 'create {#ServiceName} binPath= "\"' + ExpandConstant('{app}\LockIn.Service.exe') + '\"" start= auto obj= LocalSystem DisplayName= "Lock In Watchdog"');
      RunHidden(ScPath(), 'start {#ServiceName}');
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Params: String;
begin
  if CurStep = ssInstall then
  begin
    // The old PowerShell watchdog and any previous service are stopped before
    // their files are replaced, and the whole previous install is kept for
    // rollback.
    RunHidden(ScPath(), 'stop {#ServiceName}');
    RunHidden(ScPath(), 'delete {#ServiceName}');
    RunHidden(SchTasksPath(), '/Delete /TN "Lock In Watchdog" /F');
    if DirExists(ExpandConstant('{app}')) then
      CopyDirectory(ExpandConstant('{app}'), ExpandConstant('{app}.previous'));
  end
  else if CurStep = ssPostInstall then
  begin
    Params := '--setup-helper apply-config --sids "' + SelectedSids() + '"'
      + ' --install-dir "' + ExpandConstant('{app}') + '"'
      + ' --data-dir "' + ExpandConstant('{commonappdata}\LockIn') + '"'
      + ' --app-path "' + ExpandConstant('{app}\LockIn.App.exe') + '"'
      + ' --force-extension ' + IntToStr(Ord(ForceExtension()));
    Exec(HelperPath(), Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
    if Code <> 0 then
    begin
      Rollback();
      RaiseException('Lock In could not write its protected configuration.');
    end;

    RunHidden(ScPath(), 'create {#ServiceName} binPath= "\"' + ExpandConstant('{app}\LockIn.Service.exe') + '\"" start= auto obj= LocalSystem DisplayName= "Lock In Watchdog"');
    RunHidden(ScPath(), 'description {#ServiceName} "Lock In usage accounting and fail-closed browser watchdog."');
    // SCM recovery actions replace the scheduled task's every-minute restart.
    RunHidden(ScPath(), 'failure {#ServiceName} reset= 86400 actions= restart/60000/restart/60000/restart/60000');
    RunHidden(ScPath(), 'start {#ServiceName}');
    Exec(HelperPath(), '--setup-helper health --timeout 30', '', SW_HIDE, ewWaitUntilTerminated, Code);
    if Code <> 0 then
    begin
      Rollback();
      RaiseException('The Lock In service did not become healthy, so the previous installation was restored.');
    end;
    DelTree(ExpandConstant('{app}.previous'), True, True, True);
  end;
end;

function InitializeUninstall(): Boolean;
begin
  EraseData := False;
  case MsgBox('Keep your Lock In zones, usage and protected accounts on this PC?' + #13#10 + #13#10 +
      'Yes — keep them (recommended; a later reinstall picks up where you left off).' + #13#10 +
      'No — erase everything, including zones, usage and protected accounts.', mbConfirmation, MB_YESNOCANCEL) of
    IDYES: EraseData := False;
    IDNO: EraseData := True;
    else begin Result := False; Exit; end;
  end;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
  Helper: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    Helper := ExpandConstant('{app}\LockIn.Service.exe');
    // Disarm first, then remove only Lock In's own rules and values.
    if FileExists(Helper) then
      Exec(Helper, '--setup-helper disarm --remove-rules', '', SW_HIDE, ewWaitUntilTerminated, Code);
    RunHidden(ScPath(), 'stop {#ServiceName}');
    RunHidden(ScPath(), 'delete {#ServiceName}');
    RunHidden(SchTasksPath(), '/Delete /TN "Lock In Watchdog" /F');
    if FileExists(Helper) then
      Exec(Helper, '--setup-helper remove-config', '', SW_HIDE, ewWaitUntilTerminated, Code);
  end
  else if CurUninstallStep = usPostUninstall then
  begin
    if EraseData then
      DelTree(ExpandConstant('{commonappdata}\LockIn'), True, True, True);
  end;
end;
