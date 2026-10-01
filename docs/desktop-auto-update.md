# Desktop auto-update (Electron + GitHub Releases)

The desktop app (`apps/desktop`) updates itself with [`electron-updater`], reading the
installers attached to this repository's **GitHub releases**.

## How it works

- **Client:** `apps/desktop/src/main/updater.ts` drives `electron-updater`'s `autoUpdater`
  (`autoDownload = false`, so the user confirms each update). The feed is configured in
  `apps/desktop/electron-builder.yml`:

  ```yaml
  publish:
    provider: github
  ```

  electron-builder infers the owner/repository from the git remote at build time. On the
  **stable** channel the app only considers regular releases; on **beta**
  (`updateChannel = "beta"` in the desktop settings) it also accepts pre-releases
  (`allowPrerelease`). Downloads are verified against the `sha512` in the release's
  `latest*.yml` manifest.

- **Build-time configuration:** a release build must point at the deployment its users
  sign in to. Set these before building (they are baked into the bundle):

  | Variable                    | Meaning                                       | Default                 |
  | --------------------------- | --------------------------------------------- | ----------------------- |
  | `VITE_DESKTOP_AUTH_API_URL` | Cloud API the desktop app authenticates with  | `http://localhost:3000` |
  | `VITE_DESKTOP_AUTH_ORIGIN`  | Web origin presented to that API's auth layer | `http://localhost:5173` |

  `CALIBRA_DESKTOP_AUTH_API_URL` / `CALIBRA_DESKTOP_AUTH_ORIGIN` still override them at
  runtime, which is handy when testing a build against another environment.

## Publishing a release

1. Create a GitHub release (draft or pre-release) with a tag such as
   `desktop-v0.1.0-20261001.1`.
2. Run the **Desktop Windows Release** workflow with that tag: it builds the installer, runs
   the artifact smoke test and uploads the installer, its `.blockmap` and `latest.yml` to
   the release.
3. Publish the release (or mark it as a pre-release for the beta channel). Installed apps
   pick it up on their next update check.

Building for other platforms works the same way locally:

```bash
pnpm dist:desktop:linux   # AppImage + deb
pnpm dist:desktop:mac     # dmg + zip (on macOS)
pnpm dist:desktop:win     # NSIS installer (on Windows)
```

## Gotchas

- Only **published** releases are visible to the updater; drafts are not.
- Bump `apps/desktop/package.json` `version` for every release — the updater compares
  semantic versions, not tags.
- Unsigned installers trigger SmartScreen (Windows) and Gatekeeper (macOS) warnings.
  Code-signing certificates are not part of this repository.

[`electron-updater`]: https://www.electron.build/auto-update
