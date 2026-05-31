# Thermal Label Printing (ZPL + TSPL)

This document is the design record behind real thermal-printer support for
calibration labels (the `feat/thermal-label-printing*` branch stack). It explains
the architecture, the transport matrix, the key decisions and their rationale, the
native-module packaging, the printer-language abstraction, and how to verify/extend it.

## Problem

A calibration label used to be a 50×30 mm **PDF** (React `LabelHtml.tsx` →
Gotenberg) opened in a browser tab (`window.open`). That is unreliable on thermal
label printers: driver/media scaling, soft QR/barcodes, no exact media sizing. We
wanted **real** printing — printer-native commands sent straight to the printer —
from every runtime the product ships in (cloud web app + desktop/offline Electron),
in the printer's command language (**ZPL** for Zebra, **TSPL** for TSC), with the
PDF kept as a universal fallback.

## Shape

One **pure rendering core** (pluggable command languages) feeds runtime-selected
**transports**:

```
packages/label-rendering   pure, zero-dep. LabelRenderer interface →
                           zpl/ (^FH/^CI28, ^BQ QR) + tspl/ (CODEPAGE, QRCODE)
        │ used by
 apps/api  ── GET /api/jobs/:id/label-commands?lang= ──►  commands built server-side
   (verification token isn't in the general job DTO — only in this response)
        │ browser fetches the commands, then picks a transport by runtime:
 apps/web (features/printing/print-label.ts)
   ├─ desktop      → apps/local-server /api/printer/print → net | usb | serial
   ├─ cloud        → Zebra Browser Print agent
   │                 → granted WebUSB device
   │                 → granted Web Serial port
   └─ else         → PDF "Baixar Etiqueta QR" (window.open)  ← universal fallback
```

`packages/label-rendering` is pure (like `@calibra-facil/shared`), so it runs in
the API, the local-server, and the browser without pulling server runtime into the
frontend type graph — it respects the
[API/client contract boundary](./api-client-contract.md). The renderer is selected
per **printer profile** (`language: "zpl" | "tspl"`).

## Components

| Area                                 | What                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/label-rendering`           | The `LabelRenderer` interface + `renderLabel(data, options)`, `renderTestLabel(options)`, `getRenderer(language)`, `defaultRenderOptions(language, dpi)`. `zpl/` (native `^BQ` QR, `^FH`/`^CI28` escaping) and `tspl/` (`CODEPAGE UTF-8`, `QRCODE`, quote/newline escaping). DPI-driven layout (203 → 400×240, 300 → 591×354). |
| `packages/schemas/src/printing.ts`   | `PrinterLanguage` (`zpl`/`tspl`), `PrinterConnection` (discriminated union: `network` / `usb` / `serial`), `PrinterProfile` (carries `language`), `PrintLabelRequest` (`commands`), `PrintTestRequest`, `PrinterDiscoverResult`. Schema-first source of truth.                                                                 |
| `apps/api` `GET /:id/label-commands` | Renders commands server-side from the same data `fetchLabelData` uses (`?lang=zpl\|tspl&dpi=203\|300`). Exposed as `calibraApi.jobs.getLabelCommands` (policy `cloud-only`).                                                                                                                                                   |
| `apps/local-server/src/printing`     | Desktop transports + routes: `net`/`usb`/`serial`, `/api/printer/{print,test,profiles,discover}`. Profiles persist in SQLite (`packages/local-db` migration `0008` + `printer-profiles` repo).                                                                                                                                 |
| `apps/web/src/features/printing`     | `printLabel` orchestration, the "Imprimir Etiqueta (térmica)" action, a runtime-aware settings dialog, and the cloud transports (`browser-print.ts`, `web-usb.ts`, `web-serial.ts`).                                                                                                                                           |

## Transport matrix

| Runtime | Transport           | Where the bytes go                                         |
| ------- | ------------------- | ---------------------------------------------------------- |
| Desktop | Network             | `net.Socket` → `host:9100` (zero deps; the robust default) |
| Desktop | USB                 | `usb` (node-usb): claim interface 0, bulk OUT              |
| Desktop | Serial              | `serialport`: open/write/drain/close                       |
| Cloud   | Zebra Browser Print | local agent over `fetch` (`/available`, `/write`)          |
| Cloud   | WebUSB              | `navigator.usb` (Chromium, HTTPS, per-device grant)        |
| Cloud   | Web Serial          | `navigator.serial` (Chromium, HTTPS, per-device grant)     |
| Any     | PDF                 | presigned label PDF, `window.open` (fallback)              |

The cloud path is a **priority chain** (`print-label.ts:resolveCloudSender`):
Browser Print → granted WebUSB → granted Web Serial → `NoCloudPrinterError`
(which opens the settings dialog to guide setup). Detection happens **on click**,
not on mount, so we never ping `localhost` on every page load.

## Key decisions

- **In-house renderers, not a dependency.** The only healthy native-ZPL npm
  package (`jszpl`) is **GPL-3.0**, incompatible with this proprietary codebase;
  `node-zpl` is stale and drags `jimp`. The renderers are license-clean,
  dependency-light, fully unit-tested, and pure (run everywhere).
- **Commands are built server-side.** `verification_token` is not exposed in the
  general job DTO; the QR payload (`https://verify.calibrafacil.com/v/{token}`) is
  embedded only in the dedicated `label-commands` response (least exposure — the
  token isn't sprinkled across general job data).
- **Injection / accents are handled per renderer.** ZPL hex-escapes `^`/`~`/`_`
  via `^FH` + `^CI28`; TSPL strips CR/LF and neutralizes quotes/backslashes and
  sets `CODEPAGE UTF-8`. Either way user data (e.g. an asset tag) can't break out
  of a field. Exhaustively tested.
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

| Phase | PR   | Scope                                                                                                                                                                                 |
| ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #358 | Pure ZPL core, label-commands endpoint, desktop **network** transport, SQLite profiles, web action. No native modules.                                                                |
| 2     | #359 | Cloud **Zebra Browser Print**. No native modules.                                                                                                                                     |
| 3     | #360 | Desktop **USB + serial** + discovery; the native-module packaging.                                                                                                                    |
| 4     | #361 | Cloud **WebUSB + Web Serial** no-install fallback.                                                                                                                                    |
| 5     | #362 | **Printer-language abstraction** (`LabelRenderer`) + **TSPL** renderer; `language` per profile; neutral naming (`label-rendering`, `label-commands`, `getLabelCommands`, `commands`). |

## Verification & extension

- **Unit tests** — `packages/label-rendering` (exact ZPL **and** TSPL at 203/300
  dpi, escaping, injection, the renderer factory); `packages/local-db` (profile
  round-trip); `apps/local-server` (network = a real `net` echo server; usb/serial
  = mocked call-sequences; discovery). Run with `TZ=UTC` + Node 22 to match CI.
- **Hardware** — transport call-sequences are unit-tested, but real printing must
  be validated on a device: each settings dialog has a **"Teste"** button that
  sends a diagnostic label (in the profile's language). Tune QR/margin fit via the
  profile offsets and a visual check with [Labelary](https://labelary.com) (ZPL)
  on first print. TSPL fidelity (font sizing) is reasonable but not
  hardware-validated.
- **Adding a printer** — a ZPL/TSPL printer is just a profile with the right
  `language` (network needs only an IP; discovery filters USB to the Zebra vendor
  id, others by manual vendor/product id).

### Printer-language portability

The architecture is **language-agnostic** (delivered in Phase 5). Adding a command
language (e.g. EPL) is implementing one interface and registering it:

```ts
// packages/label-rendering/src/types.ts
interface LabelRenderer {
  readonly language: PrinterLanguage;
  renderLabel(input: LabelInput, options: LabelRenderOptions): string;
  renderTestLabel(options: LabelRenderOptions): string;
}
```

Add `epl/renderer.ts`, register it in `render.ts:RENDERERS`, and extend
`PrinterLanguageSchema`. Nothing else changes:

- **Transports are opaque byte pipes.** `{network,usb,serial}-transport.ts` + the
  `sendToPrinter` dispatcher, and the cloud `sendVia*` senders, take a `commands`
  string and transmit bytes — they switch on `connection.type`, never on language.
- **The data model + layout intent** (`LabelInput`) are dialect-independent; each
  renderer maps darkness/speed onto its own range (e.g. ZPL `~SD` 0–30 vs TSPL
  `DENSITY` 0–15).
- **The API negotiates language** via `?lang=` and the **printer profile carries
  `language`**, so the right dialect is chosen end to end. Identifiers are neutral
  (`label-rendering`, `getLabelCommands`, `printToLocalPrinter`, `commands`).

The one hardware caveat: **Zebra Browser Print** is Zebra-only — a TSC printer
uses network/USB/serial (all language-agnostic), not Browser Print.
