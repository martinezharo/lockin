# Force-install Lock In after Chrome Web Store approval

Chrome assigns the extension ID when the Web Store item is created. Replace
`EXTENSION_ID` below with that value after the unlisted item is approved.

## Windows policy

1. Open Registry Editor as an administrator.
2. Go to:
   `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist`
3. Create a new **String Value** using the next unused numeric name, such as
   `1`.
4. Set its value to:
   `EXTENSION_ID;https://clients2.google.com/service/update2/crx`
5. Restart Chrome and check `chrome://policy` for
   `ExtensionInstallForcelist`.

Chrome will install and keep the extension enabled for every Windows user on
the managed computer. Removing it then requires administrator access to remove
the machine policy; it cannot be disabled from the normal Extensions page.

Keep the Web Store visibility set to **Unlisted**. The policy uses the Web Store
update service, so no public search listing is required.

