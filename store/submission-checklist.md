# Unlisted submission checklist

## Developer account

- [ ] Sign in with the intended publisher Google account.
- [ ] Enable 2-Step Verification.
- [ ] Accept the Chrome Web Store developer agreement.
- [ ] Pay the one-time developer registration fee.
- [ ] Verify the publisher contact email.

## Package

- [ ] Upload `dist/lock-in-1.3.0-chrome-web-store.zip`.
- [ ] Confirm the dashboard detects Manifest V3 and version 1.3.0.
- [ ] Do not upload the repository or a manually created ZIP.

## Store listing

- [ ] Paste the name, summary, and detailed description from `store/listing.md`.
- [ ] Choose Productivity and English.
- [ ] Upload at least one 1280x800 screenshot from `store/screenshots/`.
- [ ] Use the existing 128px store icon from the uploaded package.

## Privacy practices

- [ ] Paste the single-purpose statement from `store/listing.md`.
- [ ] Paste each permission justification from `store/privacy-practices.md`.
- [ ] Declare no remote code.
- [ ] Declare browsing activity, user activity, and user-provided configuration accurately.
- [ ] Certify Limited Use compliance.
- [ ] Add `https://gist.github.com/martinezharo/ab4b917dfc95ad2a24800632a09390d2` as the public privacy-policy URL.

## Distribution and review

- [ ] Select `Unlisted` visibility.
- [ ] Select all regions unless there is a specific reason not to.
- [ ] Confirm there are no in-app purchases.
- [ ] Paste `store/reviewer-notes.md` into the test-instructions field.
- [ ] Submit for review only after every warning in the dashboard is resolved.

## After approval

- [ ] Copy the extension ID from the approved Web Store item.
- [ ] Follow `store/force-install-after-approval.md` from an administrator
  account to force-install Lock In on this computer.
- [ ] Confirm `ExtensionInstallForcelist` appears in `chrome://policy` and the
  normal Extensions page does not offer a disable/remove control.
