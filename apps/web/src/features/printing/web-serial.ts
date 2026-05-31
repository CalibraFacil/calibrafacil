/**
 * Web Serial no-install fallback (cloud runtime). Talks to a serial-attached (or
 * USB-CDC) printer from a Chromium browser without a Browser Print agent.
 * Requires HTTPS + a user gesture for the port-permission prompt; grants persist
 * per origin (navigator.serial.getPorts()).
 */

const DEFAULT_BAUD_RATE = 9600

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/** Prompt the user to pick a serial port (must run inside a user gesture). */
export async function requestWebSerialPort(): Promise<SerialPort | null> {
  if (!isWebSerialSupported()) {
    return null
  }
  try {
    return await navigator.serial.requestPort()
  } catch {
    return null
  }
}

/** A previously-granted port, if any — no prompt. */
export async function getGrantedWebSerialPort(): Promise<SerialPort | null> {
  if (!isWebSerialSupported()) {
    return null
  }
  try {
    const ports = await navigator.serial.getPorts()
    return ports[0] ?? null
  } catch {
    return null
  }
}

export async function sendViaWebSerial(
  port: SerialPort,
  commands: string,
  baudRate: number = DEFAULT_BAUD_RATE,
): Promise<void> {
  await port.open({ baudRate })
  try {
    const writable = port.writable
    if (!writable) {
      throw new Error('A porta serial não está disponível para escrita.')
    }
    const writer = writable.getWriter()
    try {
      await writer.write(new TextEncoder().encode(commands))
    } finally {
      writer.releaseLock()
    }
  } finally {
    await port.close().catch(() => {})
  }
}
