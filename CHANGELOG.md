# Changelog

## 2.2.0 - 2026-09-19

- Added per-thumbnail byte-progress strips and truthful queued/loading/cached/failed/paused/released states, separate from unread markers.
- Share original bytes across preload, preview and download requests; save cache hits without another transfer and coalesce in-flight consumers with independent cancellation.
- Bound the tab-local byte cache to 128MB and 10 idle minutes; expiration/eviction updates thumbnail status without automatic reload loops. Manual preload retries missing cached bytes. Multi-page preload still covers the first original only.
- Bound bookmark mutations to their original artwork, refresh bookmark IDs before toggling, and verify native fallback results instead of claiming success.
- Merge read-state and download-history deltas in the background to prevent concurrent tabs from losing records.
- Stop cancelled download producers and staged writes; serialize destination naming, check the actual folder, and keep Ugoira ZIP/JSON names paired. Retry partial saves without replacing files changed since the previous attempt.
- Propagate folder changes to open tabs while keeping existing queued tasks bound to their chosen destination.
- Restore ask/all multi-page downloads, expandable queue controls/history/retry, keyboard-safe page input, and keyboard-accessible full tags.
- Add foreground metadata priority, in-flight cancellation, 30-second request/body timeouts, and UTF-8-safe filename limits.
- Add shared Chinese UI localization, modal focus trapping/restoration, and native-page focus isolation.
- Clarify site-origin directory permissions and protect existing release archives; use timestamped preview builds for development.
- Add behavioral regressions and a local workbench fixture with synthetic images, isolated storage and in-memory downloads.
- Added cancellation of image/metadata preloads on leaving the workbench or after 10 minutes in the background, with unfinished-only resumption.
- Bounded artwork/user metadata caches to 200/100 entries with five-minute expiry and least-recently-used eviction; removed the non-expiring workbench metadata cache.
- Release original-transfer ports, listeners and timers on every completion path; keep completion markers separate to prevent cleanup/reload loops.
- Kept directory selection, read state, download history and downloaded files unchanged.
- Rebuilt settings as a workbench-styled popup and full options page with browsing, downloads, and filename sections.
- Added live feed density/width settings, keyboard-accessible controls, and light/dark system themes.
- Added validated partial settings writes and truthful save/error states.
- Reused the download filename generator for single/multi-page previews and clickable naming tokens.
- Added workbench settings/folder shortcuts and reliable directory reset with cross-tab invalidation.
- Made the following-feed workbench the sole extension browsing UI; removed the native-page switch, hover-preview module, and legacy thumbnail download buttons.
- Removed obsolete hover/native-page preferences without touching saved read state, downloads, or directory access.

## 2.1.0 - 2026-09-17

- Added a reversible split-view workbench for Pixiv's followed-artworks feed.
- Added a resizable thumbnail browser, unread state, density controls, and feed filters.
- Added keyboard-first artwork and page navigation, focus mode, zoom, and drag-to-pan.
- Added range selection and batch original-file downloads.
- Preserved the native Pixiv page behind the workbench with a one-click fallback.
- Added English and Simplified Chinese workbench UI and a dedicated settings switch.
- Fixed split-view sizing so long feeds keep square thumbnails, scroll independently, and leave previews visible.
- Added previous, next, and direct page-number controls to the artwork feed.
- Added a prominent floating button for returning to the workbench from Pixiv's original page.
- Changed artwork bookmarks to prefer Pixiv's native in-page control, with a CSRF-compatible AJAX fallback and no legacy bookmark tab.
- Replaced the feed page-number stepper with a centered numeric field without spinner arrows.
- Stopped downloads before queuing or fetching when no download folder is authorized.
- Persisted workbench read state across feed pages and browser restarts.
- Moved artwork metadata into an adaptive image-anchored information island.
- Integrated active download progress into the workbench shortcut bar.
- Added one-click current-feed original-image preloading and an optional automatic preload preference.

## 2.0.0 - 2026-09-16

- Rebuilt browsing around a non-blocking side preview and opt-in immersive viewer.
- Added keyboard-first navigation and an in-viewer shortcut guide.
- Added bounded concurrent downloads, real cancellation, retry, queue pause, and aggregate progress.
- Switched multi-page works to Pixiv's authoritative pages endpoint.
- Added per-thumbnail queued, progress, completed, and failed states.
- Added multi-page range selection, estimated size, dimensions, and format information.
- Added duplicate-file policies: skip, auto rename, and overwrite.
- Added Ugoira source ZIP downloads with frame timing JSON.
- Added English and Simplified Chinese settings interfaces.
- Added privacy documentation, release validation, automated tests, a SHA-256 checksum, and release ZIP packaging.
