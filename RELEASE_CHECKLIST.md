# PixivPlus 2.0.0 Release Checklist

## Automated

- [x] Run `npm run release:check`.
- [x] Confirm all tests and validation checks pass.
- [x] Inspect `dist/pixiv-plus-2.0.0.zip` and verify that it contains runtime files only.
- [x] Confirm `manifest.json` and `package.json` versions match.
- [x] Register the unpacked extension and its service worker in Microsoft Edge 153 using an isolated browser profile.

## Manual browser QA

- [ ] Repeat the unpacked-extension check in the user's normal Edge profile.
- [ ] Verify a single-page JPEG and PNG preview/download.
- [ ] Verify a multi-page work with mixed page selection and Shift range selection.
- [ ] Verify Ugoira ZIP and frame timing JSON downloads.
- [ ] Verify cancel, cancel all, pause/resume queue, failed retry, and all duplicate policies.
- [ ] Verify browser-default download fallback after dismissing the directory picker.
- [ ] Verify settings persist after browser restart.
- [ ] Verify English and Simplified Chinese UI.
- [ ] Verify keyboard navigation, focus trapping, and reduced-motion mode.
- [ ] Verify behavior while logged out and when artwork is unavailable.

## Store submission

- [ ] Upload the generated ZIP without modifying it.
- [ ] Copy the single-purpose and permission justifications from `STORE_LISTING.md`.
- [ ] Declare that the Manifest V3 package uses no remote code.
- [ ] Publish `PRIVACY.md` at a stable public HTTPS URL and add it to Partner Center.
- [ ] Add English and Simplified Chinese descriptions and logos.
- [ ] Upload screenshots that contain no private account data or mature artwork.
- [ ] Confirm release notes match `CHANGELOG.md`.
