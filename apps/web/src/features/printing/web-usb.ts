/**
 * WebUSB no-install fallback (cloud runtime). Lets a Chromium browser talk to a
 * USB-attached Zebra printer with no Browser Print agent. Requires a secure
 * context (HTTPS) and a user gesture for the device-permission prompt; grants
 * persist per origin, so once connected the print path reuses the device via
 * navigator.usb.getDevices() without prompting again.
 *
 * Not supported in Firefox/Safari (feature-detected). On Windows the device may
 * need a WinUSB driver; if the OS print queue owns it, WebUSB can't claim it.
 */

const ZEBRA_VENDOR_ID = 0x0a5f

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

/** Prompt the user to pick a Zebra USB device (must run inside a user gesture). */
export async function requestWebUsbPrinter(): Promise<USBDevice | null> {
  if (!isWebUsbSupported()) {
    return null
  }
  try {
    return await navigator.usb.requestDevice({
      filters: [{ vendorId: ZEBRA_VENDOR_ID }],
    })
  } catch {
    // User cancelled the picker or no device available.
    return null
  }
}

/** A previously-granted device, if any — no prompt. */
export async function getGrantedWebUsbPrinter(): Promise<USBDevice | null> {
  if (!isWebUsbSupported()) {
    return null
  }
  try {
    const devices = await navigator.usb.getDevices()
    return (
      devices.find((device) => device.vendorId === ZEBRA_VENDOR_ID) ??
      devices[0] ??
      null
    )
  } catch {
    return null
  }
}

function findOutEndpoint(
  device: USBDevice,
): { interfaceNumber: number; endpointNumber: number } | null {
  const configuration = device.configuration
  if (!configuration) {
    return null
  }
  for (const usbInterface of configuration.interfaces) {
    for (const endpoint of usbInterface.alternate.endpoints) {
      if (endpoint.direction === 'out' && endpoint.type === 'bulk') {
        return {
          interfaceNumber: usbInterface.interfaceNumber,
          endpointNumber: endpoint.endpointNumber,
        }
      }
    }
  }
  return null
}

export async function sendViaWebUsb(
  device: USBDevice,
  commands: string,
): Promise<void> {
  await device.open()
  try {
    if (device.configuration === null) {
      await device.selectConfiguration(1)
    }
    const target = findOutEndpoint(device)
    if (!target) {
      throw new Error('A impressora USB não expôs um endpoint de saída.')
    }
    await device.claimInterface(target.interfaceNumber)
    try {
      // ZPL is ASCII (hex-escaped), so UTF-8 encoding is byte-identical.
      await device.transferOut(
        target.endpointNumber,
        new TextEncoder().encode(commands),
      )
    } finally {
      await device.releaseInterface(target.interfaceNumber).catch(() => {})
    }
  } finally {
    await device.close().catch(() => {})
  }
}
