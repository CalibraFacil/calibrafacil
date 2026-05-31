# Thermal Label Printing (Zebra / ZPL)

This document is the design record behind real thermal-printer support for
calibration labels (the `feat/thermal-label-printing*` branch stack). It explains
the architecture, the transport matrix, the key decisions and their rationale, the
native-module packaging, and how to verify/extend it.

## Problem

A calibration label used to be a 50×30 mm **PDF** (React `LabelHtml.tsx` →
Gotenberg) opened in a browser tab (`window.open`). That is unreliable on thermal
label printers: driver/media scaling, soft QR/barcodes, no exact media sizing. We
wanted **real** printing — printer-native **ZPL** sent straight to a Zebra-class
printer — from every runtime the product ships in (cloud web app + desktop/offline
Electron), with the PDF kept as a universal fallback.

## Shape

One **pure ZPL core** feeds runtime-selected **transports**:

```
packages/label-zpl   pure, zero-dep: buildLabelZpl + ^FH/^CI28 escaping + ^BQ QR
        │ used by
 apps/api  ── GET /api/jobs/:id/label.zpl ──►  ZPL built server-side
   (verification token never leaves the server)
        │ browser fetches ZPL, then picks a transport by runtime:
 apps/web (features/printing/print-label.ts)
   ├─ desktop      → apps/local-server /api/printer/print → net | usb | serial
   ├─ cloud        → Zebra Browser Print agent
   │                 → granted WebUSB device
   │                 → granted Web Serial port
   └─ else         → PDF "Baixar Etiqueta QR" (window.open)  ← universal fallback
```

`packages/label-zpl` is pure (like `@calibra-facil/shared`), so it runs in the
worker, the API, the local-server, and the browser without pulling server runtime
into the frontend type graph — it respects the
[API/client contract boundary](./api-client-contract.md).

## Components

| Area | What |
|---|---|
| `packages/label-zpl` | Typed ZPL builder. `buildLabelZpl(data, options)`, `buildTestLabelZpl(options)`, `defaultRenderOptions(dpi)`. Native `^BQ` QR; `^FH` + `^CI28` hex escaping; DPI-driven layout (203 → `^PW400 ^LL240`, 300 → `^PW591 ^LL354`). |
| `packages/schemas/src/printing.ts` | `PrinterConnection` (discriminated union: `network` / `usb` / `serial`), `PrinterProfile`, `PrintLabelRequest`, `PrintTestRequest`, `PrinterDiscoverResult`. Schema-first source of truth. |
| `apps/api` `GET /:id/label.zpl` | Builds ZPL server-side from the same data `fetchLabelData` uses (`?dpi=203\|300`). Exposed to the frontend as `calibraApi.jobs.getLabelZpl` (policy `cloud-only`). |
| `apps/local-server/src/printing` | Desktop transports + routes: `net`/`usb`/`serial`, `/api/printer/{print,test,profiles,discover}`. Profiles persist in SQLite (`packages/local-db` migration `0008` + `printer-profiles` repo). |
| `apps/web/src/features/printing` | `printLabel` orchestration, the "Imprimir Etiqueta (térmica)" action, a runtime-aware settings dialog, and the cloud transports (`browser-print.ts`, `web-usb.ts`, `web-serial.ts`). |

## Transport matrix

| Runtime | Transport | Where the bytes go |
|---|---|---|
| Desktop | Network | `net.Socket` → `host:9100` (zero deps; the robust default) |
| Desktop | USB | `usb` (node-usb): claim interface 0, bulk OUT |
| Desktop | Serial | `serialport`: open/write/drain/close |
| Cloud | Zebra Browser Print | local agent over `fetch` (`/available`, `/write`) |
| Cloud | WebUSB | `navigator.usb` (Chromium, HTTPS, per-device grant) |
| Cloud | Web Serial | `navigator.serial` (Chromium, HTTPS, per-device grant) |
| Any | PDF | presigned label PDF, `window.open` (fallback) |

The cloud path is a **priority chain** (`print-label.ts:resolveCloudSender`):
Browser Print → granted WebUSB → granted Web Serial → `NoCloudPrinterError`
(which opens the settings dialog to guide setup). Detection happens **on click**,
not on mount, so we never ping `localhost` on every page load.

## Key decisions

- **In-house ZPL builder, not a dependency.** The only healthy native-ZPL npm
  package (`jszpl`) is **GPL-3.0**, incompatible with this proprietary codebase;
  `node-zpl` is stale and drags `jimp`. A ~150-line builder is license-clean,
  dependency-light, fully unit-tested, and pure (runs everywhere).
- **ZPL is built server-side.** `verification_token` is not exposed in any web
  job DTO, so the QR payload (`https://verify.calibrafacil.com/v/{token}`) is built
  in `GET /:id/label.zpl` and the token never reaches the browser.
- **ZPL injection / accents are handled at the core.** `^` and `~` are ZPL command
  prefixes; arbitrary field text is emitted for `^FH` hex mode and `^CI28` (UTF-8),
  so Portuguese accents round-trip and user data (e.g. an asset tag) can't break out
  of a field. Exhaustively tested in `escape.test.ts`.
- **Network is the recommended default.** It needs no driver and no OS-specific
  permissions; USB/serial are offered but are best-effort per OS (see below).
- **Browser Print over plain `fetch`, not the SDK.** The base URL is
  protocol-matched (`https://localhost:9101` on HTTPS pages, `http://localhost:9100`
  otherwise) to avoid mixed-content blocking; HTTPS requires trusting the agent's
  self-signed cert once.
- **WebUSB/Web Serial are a no-install fallback, not primary.** Chromium-only,
  HTTPS-only, and they prompt for per-device permission (grants then persist per
  origin). Types come from `@types/w3c-web-usb` + `@types/w3c-web-serial`.

## Native-module packaging (USB + serial)

`usb` and `serialport` are native modules. They are added to **both**
`apps/local-server` and `apps/desktop` deps, marked `external` in
`apps/local-server/vite.config.ts` (a bundled `.cjs` can't contain a `.node`),
and unpacked from the asar via `apps/desktop/electron-builder.yml` `asarUnpack`.
They are imported **lazily** (`await import(...)`) so network printing never loads
them.

The important subtlety: the local-server runs as **plain Node** under
`ELECTRON_RUN_AS_NODE`, while electron-builder rebuilds native modules to
**Electron's ABI**. `better-sqlite3` is a node-gyp single-binding module, so it is
rebuilt back to the Node ABI post-package (`restoreNodeBetterSqliteBuild` in
`scripts/build-desktop-artifact.mjs`). **`usb` and `@serialport/bindings-cpp` are
N-API** modules shipping napi prebuilds, so `node-gyp-build` selects the napi
binary under either ABI — **no rebuild step needed** for them. They are allowlisted
in `pnpm-workspace.yaml` (`onlyBuiltDependencies` + `allowBuilds`); pnpm 11 hard-
fails otherwise.

### Per-OS USB notes

USB raw access is OS-specific — **prefer network (9100)**. See
`apps/local-server/src/printing/README.md` for the operational detail:

- **Linux** — a udev rule for the Zebra vendor id (`0a5f`); the transport also
  detaches the `usblp` kernel driver before claiming the interface.
- **Windows** — usually needs a WinUSB/Zadig driver swap; network or Browser Print
  is smoother.
- **macOS** — generally works if no print queue owns the device.

## Delivery (stacked PRs)

Each phase is independently shippable and was reviewed on its own PR.

| Phase | PR | Scope |
|---|---|---|
| 1 | #358 | Pure ZPL core, `label.zpl` endpoint, desktop **network** transport, SQLite profiles, web action. No native modules. |
| 2 | #359 | Cloud **Zebra Browser Print**. No native modules. |
| 3 | #360 | Desktop **USB + serial** + discovery; the native-module packaging. |
| 4 | #361 | Cloud **WebUSB + Web Serial** no-install fallback. |

## Verification & extension

- **Unit tests** — `packages/label-zpl` (exact ZPL at 203/300 dpi, escaping,
  injection); `packages/local-db` (profile round-trip); `apps/local-server`
  (network = a real `net` echo server; usb/serial = mocked call-sequences;
  discovery). Run with `TZ=UTC` + Node 22 to match CI.
- **Hardware** — transport call-sequences are unit-tested, but real printing must
  be validated on a device: each settings dialog has a **"Teste"** button that
  sends a diagnostic label. Tune QR/margin fit via the profile offsets and a
  visual check with [Labelary](https://labelary.com) on first print.
- **Adding a ZPL-compatible printer** (TSC, Godex… in ZPL mode) — works via the
  same transports; discovery filters USB to the Zebra vendor id, so other vendors
  are added by entering their vendor/product id (network needs only an IP).

### Printer-language portability (e.g. ZPL → TSPL)

The architecture is **language-agnostic at the transport layer but not yet at the
edges** — swapping in TSPL is *not* strictly "add a renderer, change nothing else".

Already agnostic (opaque byte pipes — no ZPL knowledge):

- `apps/local-server/src/printing/{network,usb,serial}-transport.ts` and the
  `sendToPrinter` dispatcher take a string and write bytes; they switch on
  `connection.type`, never on language.
- The cloud `sendZpl*` senders (`browser-print`, `web-usb`, `web-serial`) likewise
  just transmit bytes.
- The label **data model** (`LabelZplInput`: cert no., lab, asset tag, date,
  verify URL) and the layout intent are dialect-independent.

Coupled to ZPL today (change points outside the renderer):

- `packages/label-zpl` is the renderer — a sibling `label-tspl` (or a
  `LabelRenderer` interface with `zpl`/`tspl` implementations) would be the new
  rendering layer. ✅ intended.
- `apps/api` `GET /:id/label.zpl` imports the ZPL builder directly and the route /
  client method / contract literal are ZPL-named (`label.zpl`, `getLabelZpl`,
  `api-app.ts`). Picking a dialect needs the endpoint to negotiate language (or a
  second route).
- `PrinterProfile`/`PrinterConnection` (`packages/schemas`) have **no `language`
  field**, and `darkness` (0–30) maps to ZPL `~SD` (TSPL `DENSITY` is 0–15).
- `buildTestLabelZpl` (shared by the desktop + cloud "Teste") is ZPL.
- Naming (`getLabelZpl`, `printZplToLocalPrinter`, `data: zpl`) assumes ZPL.
- The cloud **Zebra Browser Print** path is Zebra-only *hardware-wise* — a TSC
  printer would use network/USB/serial, not Browser Print.

True language-agnosticism is a small, well-scoped refactor: introduce a
`LabelRenderer` interface + a `language` field on the printer profile, have the API
endpoint resolve the dialect, and rename the ZPL-specific identifiers to neutral
ones (`getLabelCommands`, `printRawToPrinter`, `data`). The transports and
local-server routes would not change.
