# Unlisted update checklist — version 1.4.1

## Developer account

- [ ] Sign in with the intended publisher Google account.
- [ ] Enable 2-Step Verification.
- [ ] Accept the Chrome Web Store developer agreement.
- [ ] Pay the one-time developer registration fee.
- [ ] Verify the publisher contact email.

## Package

- [ ] Install and test `dist/lock-in-1.4.1-windows-watchdog.zip` first.
- [ ] Publish a reviewer-accessible HTTPS download for that exact watchdog archive and record its SHA-256.
- [ ] Replace the submission-blocker paragraph in `store/reviewer-notes.md` with that URL and checksum.
- [ ] Upload `dist/lock-in-1.4.1-chrome-web-store.zip`.
- [ ] Confirm the dashboard detects Manifest V3 and version 1.4.1.
- [ ] Do not upload the repository or a manually created ZIP.

## Store listing

- [ ] Paste the name, summary, and detailed description from `store/listing.md`.
- [ ] Choose Productivity and English.
- [ ] Upload at least one 1280x800 screenshot from `store/screenshots/`.
- [ ] Use the existing 128px store icon from the uploaded package.

## Privacy practices

- [ ] Paste the single-purpose statement from `store/listing.md`.
- [ ] Paste each permission justification from `store/privacy-practices.md`.
- [ ] Remove the obsolete `declarativeNetRequest` justification.
- [ ] Declare and justify the fixed loopback host permission.
- [ ] Declare no remote code.
- [ ] Declare browsing activity, user activity, and user-provided configuration accurately.
- [ ] Certify Limited Use compliance.
- [ ] Update the public privacy-policy URL to the version 1.4.1 text before uploading the package.

## Distribution and review

- [ ] Select `Unlisted` visibility.
- [ ] Select all regions unless there is a specific reason not to.
- [ ] Confirm there are no in-app purchases.
- [ ] Paste `store/reviewer-notes.md` into the test-instructions field.
- [ ] Confirm the reviewer can download and install the Windows watchdog without repository access.
- [ ] Submit for review only after every warning in the dashboard is resolved.

## After approval of 1.4.1

- [ ] Confirm the existing extension ID remains `ceggfchogfcdgnobpekajiojobghcggi`.
- [ ] Install the Windows watchdog before Chrome updates the extension.
- [ ] Follow `store/force-install-after-approval.md` from an administrator account.
- [ ] Confirm the Lock In dashboard reaches **Windows enforcement armed**.
- [ ] Confirm schedule, allowance, restart and sensor-missing behavior on the real browser.
- [ ] Confirm `ExtensionInstallForcelist` appears in `chrome://policy` and the
  normal Extensions page does not offer a disable/remove control.
