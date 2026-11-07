/** Query keys of the label-printing feature. See `assets/keys.ts`. */
export const printingKeys = {
  profiles: ['printer-profiles'] as const,
  browserPrintAvailable: ['browser-print-available'] as const,
  browserPrintDevices: ['browser-print-devices'] as const,
  webUsbGranted: ['web-usb-granted'] as const,
  webSerialGranted: ['web-serial-granted'] as const,
}
