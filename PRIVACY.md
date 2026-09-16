# PixivPlus Privacy Policy

Last updated: September 16, 2026

PixivPlus is a browser extension that improves browsing and downloading artwork on Pixiv. It does not operate an external server and does not sell, share, or transmit user data to the developer or to advertising or analytics providers.

## Data processed locally

PixivPlus stores the following data locally in the browser:

- extension settings, such as preview behavior, filename templates, and download preferences;
- the directory handle selected by the user, where supported by the browser;
- download history containing artwork titles, artist names, Pixiv artwork identifiers, thumbnail URLs, filenames, states, and timestamps.

This information remains on the user's device. Users can remove it by clearing extension storage, resetting the download directory, or uninstalling the extension.

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
