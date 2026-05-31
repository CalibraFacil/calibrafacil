# Thermal printing (desktop / local-server)

The local-server sends native **ZPL** to Zebra-class label printers. Transports:

- **Network (TCP 9100)** — `net.Socket`, zero dependencies. The robust default;
  works on every OS without drivers.
- **USB** — `usb` (node-usb). Claims interface 0 and writes to the bulk OUT
  endpoint.
- **Serial** — `serialport`.

`usb` and `serialport` are native modules. They ship **N-API** prebuilds, so
`node-gyp-build` loads the correct binary under both the Node and Electron ABIs
— no rebuild step is needed (unlike `better-sqlite3`). They are listed in
`apps/local-server/vite.config.ts` `rollupOptions.external` and unpacked from the
asar via `apps/desktop/electron-builder.yml` `asarUnpack`.

## USB permissions

USB raw access is OS-specific; **prefer network (9100) when possible**.

- **Linux** — the user needs permission to claim the device. Install a udev rule
  (then replug the printer):

  ```
  # /etc/udev/rules.d/99-zebra.rules  — Zebra vendor id 0x0a5f
  SUBSYSTEM=="usb", ATTRS{idVendor}=="0a5f", MODE="0666", GROUP="plugdev"
  ```

  ```
  sudo udevadm control --reload-rules && sudo udevadm trigger
  ```

  On Linux the transport also detaches the kernel `usblp` driver automatically
  before claiming the interface.

- **Windows** — the default Zebra driver claims the device, so raw `usb` access
  usually needs a WinUSB/Zadig driver swap. Network printing is recommended.

- **macOS** — generally works without extra drivers, provided no print queue has
  claimed the device.
