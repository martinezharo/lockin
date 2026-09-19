# Unlisted update checklist — version 1.4.1

## Developer account

Completed: version `1.3.0` is already published as unlisted, which Google only allows once the account is
signed in, protected by 2-Step Verification, bound to the developer agreement, paid up and contact-verified.

- [x] Sign in with the intended publisher Google account.
- [x] Enable 2-Step Verification.
- [x] Accept the Chrome Web Store developer agreement.
- [x] Pay the one-time developer registration fee.
- [x] Verify the publisher contact email.

## Package

- [ ] Push tag `v1.4.1` so the Release workflow publishes both archives with their checksums.
- [ ] Install and test the released `lock-in-1.4.1-windows-watchdog.zip` first.
- [ ] Paste that release's literal SHA-256 into `store/reviewer-notes.md`.
- [ ] Approve the `chrome-web-store` environment so the tagged run uploads `lock-in-1.4.1-chrome-web-store.zip`.
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
