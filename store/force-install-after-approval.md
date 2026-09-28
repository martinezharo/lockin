# Force-install Lock In after Chrome Web Store approval

The existing unlisted item ID is `ceggfchogfcdgnobpekajiojobghcggi`.

The installer can write the Chrome and Brave `ExtensionInstallForcelist` policy itself, and it is
switchable:

- The account wizard asks **Guide me through loading the extension by hand** (default) or
  **Force-install it from the Chrome Web Store**.
- The default is the guide because the store listing currently serves an older build without the
  watchdog. The tray app detects a browser with no Lock In sensor and offers to open the extensions
  page.
- After the store serves a watchdog-compatible version, run the installer again and pick the
  force-install option, or set the switch directly from an elevated prompt:
  `LockIn.Service.exe --setup-helper apply-config --force-extension 1` (add `--sids <sid,...>` to
  keep a specific protected set; without it the existing set and the launching account are kept).

The installer owns only the values it writes: it records them under
`HKLM\SOFTWARE\LockIn\OwnedExtensionPolicy` and removes only values that still hold the Lock In
extension id when the switch is turned off or Lock In is uninstalled. Existing administrator policy
entries are never touched, and a new value is written under a free numeric name from 900 upwards.

The paths used are:

- `HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist`
- `HKLM\SOFTWARE\Policies\BraveSoftware\Brave\ExtensionInstallForcelist`

Value format: `ceggfchogfcdgnobpekajiojobghcggi;https://clients2.google.com/service/update2/crx`.

Keep the Web Store visibility set to **Unlisted**. The policy uses the Web Store update service, so
no public search listing is required.

After force installation, check both the extension policy and the watchdog:

- `chrome://policy` or `brave://policy` shows `ExtensionInstallForcelist`.
- The Lock In dashboard shows **Windows enforcement armed**.
- `services.msc` shows `LockInWatchdog` running as `LocalSystem`.
