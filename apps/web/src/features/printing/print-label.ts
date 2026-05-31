import {
  defaultRenderOptions,
  renderTestLabel,
  type PrinterLanguage,
} from '@calibra-facil/label-rendering'

import { calibraApi } from '@/utils/api'

import {
  isBrowserPrintAvailable,
  resolveBrowserPrintDevice,
  sendViaBrowserPrint,
  type BrowserPrintDevice,
} from './browser-print'
import { printToLocalPrinter } from './local-printer-client'
import { getGrantedWebSerialPort, sendViaWebSerial } from './web-serial'
import { getGrantedWebUsbPrinter, sendViaWebUsb } from './web-usb'

/** Thrown when no cloud thermal transport (Browser Print / WebUSB / Web Serial) is set up. */
export class NoCloudPrinterError extends Error {
  constructor() {
    super('Nenhuma impressora térmica disponível')
    this.name = 'NoCloudPrinterError'
  }
}

/**
 * Print a calibration label on a thermal printer (desktop runtime). Fetches the
 * printer commands from the cloud API in the printer's language (which holds the
 * verification token), then sends them to the desktop local-server. Throws with
 * a pt-BR message on failure so callers can toast it.
 */
export async function printJobLabel(
  jobId: string | number,
  options?: { language?: PrinterLanguage; profileId?: string; dpi?: 203 | 300 },
): Promise<void> {
  const commands = await calibraApi.jobs.getLabelCommands(jobId, {
    language: options?.language,
    dpi: options?.dpi,
  })
  const result = await printToLocalPrinter({
    commands,
    profileId: options?.profileId,
  })
  if (!result.success) {
    throw new Error(result.error ?? 'Falha ao imprimir etiqueta')
  }
}

type CommandSender = (commands: string) => Promise<void>

/**
 * Resolve the cloud thermal transport, in priority order: Zebra Browser Print
 * (best), then a granted WebUSB device, then a granted Web Serial port. Returns
 * null when none is set up.
 */
async function resolveCloudSender(): Promise<CommandSender | null> {
  if (await isBrowserPrintAvailable()) {
    const device = await resolveBrowserPrintDevice()
    if (device) {
      return (commands) => sendViaBrowserPrint(device, commands)
    }
  }
  const usbDevice = await getGrantedWebUsbPrinter()
  if (usbDevice) {
    return (commands) => sendViaWebUsb(usbDevice, commands)
  }
  const serialPort = await getGrantedWebSerialPort()
  if (serialPort) {
    return (commands) => sendViaWebSerial(serialPort, commands)
  }
  return null
}

/**
 * Print a calibration label in cloud runtime via the best available transport.
 * Cloud printers are assumed ZPL (Browser Print is Zebra; WebUSB/Web Serial
 * default to ZPL). Throws {@link NoCloudPrinterError} when nothing is configured
 * so the caller can guide setup.
 */
export async function printJobLabelCloud(
  jobId: string | number,
  options?: { dpi?: 203 | 300 },
): Promise<void> {
  const sender = await resolveCloudSender()
  if (!sender) {
    throw new NoCloudPrinterError()
  }
  const commands = await calibraApi.jobs.getLabelCommands(jobId, {
    language: 'zpl',
    dpi: options?.dpi,
  })
  await sender(commands)
}

const testCommands = () => renderTestLabel(defaultRenderOptions('zpl', 203))

/** Send a diagnostic test label to a Browser Print device. */
export async function printTestViaBrowserPrint(
  device: BrowserPrintDevice,
): Promise<void> {
  await sendViaBrowserPrint(device, testCommands())
}

/** Send a diagnostic test label to a granted WebUSB device. */
export async function printTestViaWebUsb(device: USBDevice): Promise<void> {
  await sendViaWebUsb(device, testCommands())
}

/** Send a diagnostic test label to a granted Web Serial port. */
export async function printTestViaWebSerial(port: SerialPort): Promise<void> {
  await sendViaWebSerial(port, testCommands())
}
