# PixivPlus Release Checklist

## 2.2.0: workbench settings and shared original cache

- [x] `npm run release:check`: 66 tests and manifest/permissions/locales/CSP validation passed.
- [x] Built `dist/pixiv-plus-2.2.0.zip`, verified ZIP integrity and runtime-only entries; preserved the submitted 2.1.0 archive.
- Package SHA-256: `a3aeec9b46b488d084210bdff6aefe9afceefd3c557165d18f92d1e7ef9fa3c7`.
- Store submission status is tracked in Partner Center; building/uploading does not mean certification or publication is complete.
- [x] Shared original-cache tests: cache-hit saving without another transfer, in-flight deduplication, independent consumer cancellation, expiry, capacity eviction and incomplete-transfer rejection.
- [x] Edge isolated fixture: per-thumbnail byte progress and completed markers; saving a cached original left the original-transfer count unchanged at 12.
- [ ] After extension reload, verify real Pixiv byte progress, blob preview/CSP fallback, cached original save and correct first-page-only status for multi-page works.
- [x] Behavioral regressions cover bookmark switching/failure, concurrent read/history writes, cancellation, producer cancellation, same-name allocation, partial Ugoira retry, folder invalidation and ask/all settings.
- [x] Verify focused pagination drafts and button keyboard activation in Edge using the local workbench fixture.
- [x] Verify queue expansion, history focus trapping, Escape/focus restoration, tag expansion and multi-page selection in the local fixture (no live account or filesystem writes).
- [ ] Reload the real extension and verify logged-in bookmark/unbookmark, cross-tab persistence, native folder authorization and actual JPEG/PNG/Ugoira saves. Local fixture coverage does not replace this check.
- [ ] Verify simultaneous cross-tab downloads into the same directory under all three duplicate policies.
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
