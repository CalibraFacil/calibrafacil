# Desktop security perimeter

`apps/desktop` hosts a privileged window: the preload bridge (`window.calibraBridge`)
gives the page `authFetch` (cloud calls with the stored session cookies), the local API
token and `openExternal`. Everything below keeps that window on the app and the bridge
out of reach of any other page. Roadmap 2, item A5.

## IPC sender check

`assertTrustedSender` (`apps/desktop/src/main/main.ts`) parses the calling frame's URL
and compares scheme and host exactly (`trusted-origins.ts`). Userinfo
(`http://localhost:5173@evil.example/`), prefix-sharing hosts or ports
(`localhost:51730`, `app://calibra-facil.evil`), encoded variants and unparseable URLs are
all refused. The Vite dev origins and `CALIBRA_DESKTOP_RENDERER_URL` are trusted only
when `!app.isPackaged`.

## Navigation guards

`navigation-guards.ts`, installed on **every** web contents through
`app.on("web-contents-created")`:

- `will-navigate`, `will-redirect` and `will-frame-navigate`: a main-frame navigation that
  leaves the trusted origins is cancelled. An `http(s)` URL without credentials is opened
  in the system browser instead (the same rule as the `openExternal` IPC); anything else
  is just dropped.
- Subframes are not fenced by these events. The CSP's `frame-src` decides what a frame
  may load (the certificate preview iframe is a signed storage URL), and blocking a
  frame's internal navigations would break Chromium's PDF viewer.
- `will-attach-webview` is cancelled and `setWindowOpenHandler` always denies (web links
  go to the browser).

A consequence worth knowing: code that assigns `window.location` to an external page
(for example a hosted checkout) now opens the system browser rather than replacing the
app.

## Content-Security-Policy on `app://`

The protocol handler attaches the policy from `content-security-policy.ts` to every HTML
response (assets get `nosniff` only). It mirrors the hosted policy in
`apps/web/public/_headers`; the differences are the desktop's real network surface:
`connect-src` adds the local server's loopback port (`http://<CALIBRA_LOCAL_HOST>:*`,
the port is picked at run time), the cloud API origin(s) from the build-time
`VITE_DESKTOP_AUTH_API_URL` default and the runtime `CALIBRA_DESKTOP_AUTH_API_URL`
override, and ViaCEP (called directly by the customer forms). The dev server serves its
own headers; the policy applies to packaged builds only.

## Permissions

`permissions.ts` installs request, check and device handlers on the default session.
Only `clipboard-sanitized-write` (`navigator.clipboard.writeText`, the "copy link"
buttons) is granted, and only to a trusted origin. Camera, microphone, geolocation,
notifications (native notifications come from the main process), clipboard read,
WebUSB/WebSerial/HID and everything else are denied. A new feature that needs another
permission must add it to `allowedPermissions` with the reason.

## safeStorage on Linux

`secret-encryption.ts`: on Linux Electron reports encryption as available even with the
`basic_text` backend (a hard-coded key), so only `gnome_libsecret` and the `kwallet*`
backends count. The renderer cannot write secrets: `setSecret` is not exposed on the
bridge (only `getSecretStatuses` and `deleteSecret` are).

## Fuses

`apps/desktop/electron-builder.yml` (`electronFuses`) flips these on the packaged binary
right before signing; `pnpm check:desktop:fuses` (`scripts/check-desktop-fuses.mjs`)
reads the fuse wire of the unpacked build with `@electron/fuses` and fails on any
difference. CI runs it in the **Desktop** job of `safety-net.yml` (Linux) and in
`desktop-windows-release.yml`, right after packaging.

| Fuse                                    | State         | Why                                                                           |
| --------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `RunAsNode`                             | **enabled**   | The local server is spawned as `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. |
| `EnableCookieEncryption`                | enabled       | Session cookies at rest are encrypted with the OS keystore.                   |
| `EnableNodeOptionsEnvironmentVariable`  | disabled      | `NODE_OPTIONS` could inject code into the signed binary.                      |
| `EnableNodeCliInspectArguments`         | disabled      | No `--inspect` on a shipped build.                                            |
| `EnableEmbeddedAsarIntegrityValidation` | enabled       | Tampered `app.asar` is refused (macOS and Windows; ignored on Linux).         |
| `OnlyLoadAppFromAsar`                   | enabled       | An unpacked `app/` folder cannot shadow the asar.                             |
| `GrantFileProtocolExtraPrivileges`      | disabled      | The renderer is served from `app://`, never `file://`.                        |
| `LoadBrowserProcessSpecificV8Snapshot`  | default (off) | Not used.                                                                     |

Notes:

- **Follow-up:** `RunAsNode` can only be turned off once the local server runs under
  Electron's `utilityProcess` instead of a child spawned with `ELECTRON_RUN_AS_NODE`
  (`local-server-manager.ts`). Until then the fuse is the largest remaining gap: any
  local process that can launch the binary with that variable gets a Node runtime
  signed as CalibraFácil.
- **Cookie encryption is a one-way switch.** Chromium's cookie store keeps reading
  existing plaintext rows after the flip and encrypts a cookie the next time it is
  written (verified on Linux with Electron 42: a pre-flip cookie stayed readable and a
  new one was stored in `encrypted_value`), so the session cookie flow in `main.ts`
  (`persistDesktopAuthCookie`) keeps working and nobody is signed out by the upgrade.
  The reverse, shipping a build with the fuse off over data written with it on, makes the
  encrypted cookies unreadable (everyone signs in again). Never turn it back off.
- `EnableNodeOptionsEnvironmentVariable` also makes the binary ignore
  `NODE_EXTRA_CA_CERTS`. A lab behind a TLS-inspecting proxy that set that variable to
  trust its CA for the main process's cloud calls (`authFetch`, the sync proxy) will no
  longer get it honoured; if that is reported, the fix is to load the extra CA explicitly
  in the main process, not to re-enable the fuse.
- Asar integrity relies on electron-builder embedding the asar header hash (a `Info.plist`
  entry on macOS, an exe resource on Windows). It cannot be exercised on Linux, so the
  first Windows release built with this change should be launched once before it is
  announced.
