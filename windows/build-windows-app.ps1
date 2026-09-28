# Builds the Lock In Windows app and the installer.
#
#   powershell -File windows/build-windows-app.ps1
#
# Produces dist/LockIn-Setup-<version>.exe with a .sha256 beside it. Signing is
# pluggable through SIGNING_CERT_BASE64 and SIGNING_CERT_PASSWORD; without them
# the build is unsigned and still installs (SmartScreen needs "More info").
[CmdletBinding()]
param(
  [string]$Version = '',
  [switch]$SkipInstaller,
  [switch]$SkipWebView2Download
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $Version) {
  $Version = (Get-Content (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json).version
}
Write-Host "Building Lock In $Version"

$publishRoot = Join-Path $PSScriptRoot 'publish'
$serviceOut = Join-Path $publishRoot 'service'
$appOut = Join-Path $publishRoot 'app'
Remove-Item -Recurse -Force $publishRoot -ErrorAction SilentlyContinue

Write-Host 'Publishing the service (self-contained, single file)...'
dotnet publish (Join-Path $PSScriptRoot 'LockIn.Service\LockIn.Service.csproj') `
  -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true `
  -p:DebugType=none -o $serviceOut | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'The service publish failed.' }

Write-Host 'Publishing the tray app (self-contained)...'
dotnet publish (Join-Path $PSScriptRoot 'LockIn.App\LockIn.App.csproj') `
  -c Release -r win-x64 --self-contained true `
  -p:DebugType=none -o $appOut | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'The app publish failed.' }
if (-not (Test-Path (Join-Path $appOut 'web\src\pages\options\options.html'))) {
  throw 'The app publish is missing the web pages; check the Content globs in LockIn.App.csproj.'
}

if (-not $SkipInstaller) {
  $cache = Join-Path $PSScriptRoot '.cache'
  $webView2 = Join-Path $cache 'MicrosoftEdgeWebView2Setup.exe'
  if (-not (Test-Path $webView2) -and -not $SkipWebView2Download) {
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    Write-Host 'Downloading the WebView2 bootstrapper...'
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $webView2 -UseBasicParsing
  }
  if (-not (Test-Path $webView2)) { throw 'The WebView2 bootstrapper is missing and downloading was skipped.' }

  $iscc = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $iscc) {
    $command = Get-Command iscc -ErrorAction SilentlyContinue
    if ($command) { $iscc = $command.Source }
  }
  if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) was not found. Install it with: winget install JRSoftware.InnoSetup' }

  $env:LOCKIN_VERSION = $Version
  & $iscc (Join-Path $projectRoot 'installer\LockIn.iss') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed.' }

  $installer = Join-Path $projectRoot "dist\LockIn-Setup-$Version.exe"
  if (-not (Test-Path $installer)) { throw "The installer was not produced at $installer" }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$installer.sha256" -Value "$hash  LockIn-Setup-$Version.exe" -Encoding ascii
  Write-Host "Built $installer"
  Write-Host "SHA-256: $hash"
}

# Signing is optional and pluggable. The certificate never touches the
# repository; CI provides it as a base64 secret.
$certBase64 = $env:SIGNING_CERT_BASE64
if ($certBase64) {
  $signtool = Get-Command signtool -ErrorAction SilentlyContinue
  if (-not $signtool) {
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match 'x64' } | Select-Object -First 1
  }
  if (-not $signtool) { throw 'SIGNING_CERT_BASE64 is set but signtool.exe was not found.' }
  $pfx = Join-Path ([IO.Path]::GetTempPath()) "lockin-signing-$([guid]::NewGuid().ToString('N')).pfx"
  try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($certBase64))
    $targets = @(
      (Join-Path $serviceOut 'LockIn.Service.exe'),
      (Join-Path $appOut 'LockIn.App.exe')
    )
    if (-not $SkipInstaller) { $targets += (Join-Path $projectRoot "dist\LockIn-Setup-$Version.exe") }
    foreach ($target in $targets) {
      $arguments = @('sign', '/fd', 'SHA256', '/f', $pfx)
      if ($env:SIGNING_CERT_PASSWORD) { $arguments += @('/p', $env:SIGNING_CERT_PASSWORD) }
      $arguments += @('/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', $target)
      & $signtool.Source @arguments | Out-Host
      if ($LASTEXITCODE -ne 0) { throw "Signing failed for $target" }
    }
    Write-Host 'Signed the service, the app and the installer.'
  } finally {
    Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host 'No signing certificate configured; this build is unsigned.'
}
