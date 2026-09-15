# Desktop auto-update (Electron + Cloudflare R2)

The desktop app (`apps/desktop`) self-updates with [`electron-updater`]. Because the repo
is **private**, we do **not** use the GitHub provider (that would require an embedded token
and GitHub is not a binary CDN). Instead the update feed is hosted on a **Cloudflare R2**
bucket behind a public custom domain — the standard pattern for proprietary Electron apps.

## How it works

- **Client:** `apps/desktop/src/main/updater.ts` drives `electron-updater`'s `autoUpdater`
  (`autoDownload = false` — the user confirms each update). The feed URL is baked in from
  `apps/desktop/electron-builder.yml`:

  ```yaml
  publish:
    provider: generic
    url: https://updates.calibrafacil.com/desktop
  ```

  On the **stable** channel it fetches `…/desktop/latest.yml`; on **beta**
  (`updateChannel = "beta"`) it fetches `…/desktop/beta.yml`. The installer path inside
  the manifest is resolved relative to that URL, and the download is verified against the
  `sha512` in the manifest.

- **Server:** an R2 bucket served at `https://updates.calibrafacil.com` (public read). The
  feed lives under the `desktop/` key prefix:

  ```
  desktop/latest.yml                       # Windows feed manifest
  desktop/CalibraFacil-<ver>-win-x64.exe   # installer (+ .blockmap for delta updates)
  desktop/latest-mac.yml  + .dmg/.zip      # once macOS builds are wired
  desktop/latest-linux.yml + .AppImage/.deb
  ```

- **Pipeline:**
  1. `Desktop Windows Release` builds the installer and attaches it to a GitHub release.
  2. A human runs the manual offline-release sign-off
     (`.goals/OFFLINE_LOCAL_FIRST_MANUAL_SMOKE.md`) and publishes the GitHub release.
  3. `Desktop Publish Update Feed` (dispatched with the release tag) mirrors the published
     release's assets into the R2 bucket → customers see the update.

  Publishing the feed is intentionally a **separate, deliberate step** so customers only
  receive an update after sign-off, not on every build.

## One-time setup (operator)

All in the Cloudflare dashboard for the `calibrafacil.com` zone + R2.

1. **Create the bucket** — R2 → _Create bucket_ → `calibrafacil-desktop-updates`
   (matches naming of `calibrafacil-documents`). Location: automatic / ENAM is fine.

2. **Bind the public domain** — bucket → _Settings_ → _Custom Domains_ → _Connect Domain_
   → `updates.calibrafacil.com`. Cloudflare adds the proxied CNAME automatically (the zone
   is already on Cloudflare). This makes objects publicly readable at
   `https://updates.calibrafacil.com/<key>`. Update binaries are meant to be public — no
   signed URLs needed. (Optionally add a cache rule, but the workflow already sets
   `Cache-Control: no-cache` on the `*.yml` manifests and `immutable` on installers.)

3. **Create a scoped API token** — R2 → _Manage R2 API Tokens_ → _Create_ → permission
   **Object Read & Write**, scoped to **only** `calibrafacil-desktop-updates` (least
   privilege; the release CI must not be able to touch the documents bucket). This yields an
   **Access Key ID** and **Secret Access Key** (S3 credentials).

4. **Set GitHub repo secrets + variable** (Settings → Secrets and variables → Actions):

   | Kind     | Name                                   | Value                                                                 |
   | -------- | -------------------------------------- | --------------------------------------------------------------------- |
   | Variable | `DESKTOP_UPDATES_R2_BUCKET`            | `calibrafacil-desktop-updates`                                        |
   | Secret   | `R2_ACCOUNT_ID`                        | Cloudflare account id (the `<id>` in `<id>.r2.cloudflarestorage.com`) |
   | Secret   | `DESKTOP_UPDATES_R2_ACCESS_KEY_ID`     | from step 3                                                           |
   | Secret   | `DESKTOP_UPDATES_R2_SECRET_ACCESS_KEY` | from step 3                                                           |

## Publishing a release to the feed

After the GitHub release is **published** (not a draft) and signed off:

```
gh workflow run "Desktop Publish Update Feed" -f tag=desktop-v0.0.2-20260629.1
```

The workflow refuses to run against a draft release, uploads installers first and the
`latest*.yml` manifest last, then verifies. To backfill an already-published release (e.g.
the current `desktop-v0.0.2-20260629.1`), just run it with that tag.

## Verifying

```
curl -fsSL https://updates.calibrafacil.com/desktop/latest.yml      # current stable manifest
curl -fsSI https://updates.calibrafacil.com/desktop/CalibraFacil-0.0.2-win-x64.exe | head
```

`latest.yml` should report the published `version:` and a `sha512:` matching the installer.
The filename in `latest.yml` (`url:`/`path:`) must exactly match the uploaded object key.

## Gotchas

- **Keep the artifact filename ASCII.** `electron-builder.yml` uses
  `artifactName: CalibraFacil-${version}-…`, _not_ `${productName}` ("CalibraF**á**cil").
  GitHub release assets **strip the accent** from the filename but `latest.yml`'s content
  keeps it, so the manifest would point `electron-updater` at a URL that 404s. (This bit the
  first v0.0.2 publish; the manifest was corrected in-place.) An ASCII `artifactName` keeps
  the installer, blockmap, and manifest self-consistent through the GitHub → R2 round-trip.
- **The AWS CLI ↔ R2 checksum issue** is handled in the workflow via
  `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` — don't remove it.

[`electron-updater`]: https://www.electron.build/auto-update
