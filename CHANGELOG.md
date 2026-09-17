# Changelog

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
