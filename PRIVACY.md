# PixivPlus Privacy Policy

Last updated: September 19, 2026

PixivPlus is a browser extension that improves browsing and downloading artwork on Pixiv. It does not operate an external server and does not sell, share, or transmit user data to the developer or to advertising or analytics providers.

## Data processed locally

PixivPlus stores the following data locally in the browser:

- extension settings, such as workbench layout, filename templates, and download preferences;
- artwork identifiers used to remember read state;
- the directory handle selected by the user, where supported by the browser;
- download history containing artwork titles, artist names, Pixiv artwork identifiers, thumbnail URLs, filenames, states, and timestamps.

This information remains on the user's device. Settings, read state, and download history use extension storage and are removed when that storage is cleared or the extension is uninstalled. The remembered directory handle uses IndexedDB in the `www.pixiv.net` site context; uninstalling the extension does not promise to clear site data. Use “Forget folder” before uninstalling, or clear Pixiv site data through browser settings to remove that reference. Forgetting a folder is not the same as revoking the browser's site-level file permission; manage that permission in browser settings. Downloaded files are never deleted by these operations.

Directory access uses the browser's site-origin File System Access permission model, not an extension-private filesystem sandbox. Grant access only to a dedicated download folder, not a broad personal-data directory. Pixiv site scripts share that origin's storage/permission boundary. The extension does not transmit the selected handle to its developer or third parties.

Original-image preloading, previews and downloads share a tab-local in-memory byte cache, capped at 128MB and evicted after 10 minutes without use or earlier under the capacity limit. Reloading or closing the tab discards this cache. Temporary transfer, write and displayed-image data are separate from that cache budget. No additional persistent image database is created; the browser may maintain its own HTTP cache independently.

## Network access

PixivPlus communicates only with `www.pixiv.net` and `i.pximg.net` to retrieve artwork metadata, thumbnails, original image files, animation archives, and to perform user-requested Pixiv actions such as bookmarking. These requests use the user's existing Pixiv session and are subject to Pixiv's own terms and privacy policy.

## Permissions

- `storage` stores settings and download history locally.
- `declarativeNetRequest` sets the Pixiv Referer header required by Pixiv's image host.
- Access to `www.pixiv.net` reads artwork metadata and adds the extension interface.
- Access to `i.pximg.net` retrieves thumbnails and original artwork files selected by the user.

## Remote code and analytics

PixivPlus does not download or execute remote code. It contains no analytics, telemetry, advertising, tracking pixels, or crash-reporting service.

## Changes

Material changes to this policy will be documented in the repository and reflected in the extension release notes.

## Contact

Questions and privacy requests can be submitted through the issue tracker at https://github.com/qing-yi-5427/pixiv-plus/issues.
