# PixivPlus 2.1.0 Release Checklist

## Next release: workbench-only settings

- [ ] Verify the following feed opens in the workbench even with an old saved `workbenchEnabled: false` preference.
- [ ] Verify no original-page toggle, hover-preview settings, or legacy thumbnail download buttons remain.
- [ ] Verify density, width, preload, download and naming settings persist; check save-failure feedback.
- [ ] Verify existing read state, download history, and directory access survive the upgrade.
- [ ] Reload the unpacked extension and refresh existing Pixiv tabs before browser QA.
- [ ] Start original preloading, leave the workbench, and verify remaining preloads stop without affecting downloads.
- [ ] Leave a preloading tab hidden for 10 minutes; return and verify only unfinished works resume.
- [ ] Turn off automatic preloading during a run; verify it stays stopped and the current image stays visible.
- [ ] Verify metadata cleanup does not trigger repeat original-image requests or clear read state/history.

The checklist below records the previous 2.1.0 release; its submitted ZIP must not be overwritten by development builds.

## Automated

- [x] Run `npm run release:check`.
- [x] Confirm all tests and validation checks pass.
- [x] Inspect `dist/pixiv-plus-2.1.0.zip` and verify that it contains runtime files only.
- [x] Confirm `manifest.json` and `package.json` versions match.
- [x] Register the unpacked extension and its service worker in Microsoft Edge 153 using an isolated browser profile.

## Manual browser QA

- [ ] Repeat the unpacked-extension check in the user's normal Edge profile.
- [ ] Verify the following-feed workbench discovers newly appended Pixiv cards.
- [ ] Verify work navigation, page navigation, zoom, pan, focus mode, unread filtering, and density changes.
- [ ] Verify Shift range selection and batch downloads from the workbench.
- [ ] Verify manual and automatic current-feed original-image preloading.
- [ ] Verify a single-page JPEG and PNG preview/download.
- [ ] Verify a multi-page work with mixed page selection and Shift range selection.
- [ ] Verify Ugoira ZIP and frame timing JSON downloads.
- [ ] Verify cancel, cancel all, pause/resume queue, failed retry, and all duplicate policies.
- [ ] Verify dismissing the directory picker queues no download and starts no network transfer.
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
