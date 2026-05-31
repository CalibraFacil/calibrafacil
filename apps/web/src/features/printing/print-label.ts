import {
  buildTestLabelZpl,
  defaultRenderOptions,
} from '@calibra-facil/label-zpl'

import { calibraApi } from '@/utils/api'

import {
  isBrowserPrintAvailable,
  resolveBrowserPrintDevice,
  sendZplViaBrowserPrint,
  type BrowserPrintDevice,
} from './browser-print'
import { printZplToLocalPrinter } from './local-printer-client'
import { getGrantedWebSerialPort, sendZplViaWebSerial } from './web-serial'
import { getGrantedWebUsbPrinter, sendZplViaWebUsb } from './web-usb'

/** Thrown when no cloud thermal transport (Browser Print / WebUSB / Web Serial) is set up. */
export class NoCloudPrinterError extends Error {
  constructor() {
    super('Nenhuma impressora térmica disponível')
    this.name = 'NoCloudPrinterError'
  }
}

/**
 * Print a calibration label on a thermal printer (desktop runtime).
 *
 * Fetches native ZPL from the cloud API (which holds the verification token),
 * then sends it to the desktop local-server, which writes it to the printer.
 * Throws with a pt-BR message on failure so callers can toast it.
 */
export async function printJobLabel(
  jobId: string | number,
  options?: { profileId?: string; dpi?: 203 | 300 },
): Promise<void> {
  const zpl = await calibraApi.jobs.getLabelZpl(
    jobId,
    options?.dpi ? { dpi: options.dpi } : undefined,
  )
  const result = await printZplToLocalPrinter({
    zpl,
    profileId: options?.profileId,
  })
  if (!result.success) {
    throw new Error(result.error ?? 'Falha ao imprimir etiqueta')
  }
}

type ZplSender = (zpl: string) => Promise<void>

/**
 * Resolve the cloud thermal transport, in priority order: Zebra Browser Print
 * (best), then a previously-granted WebUSB device, then a granted Web Serial
 * port. Returns null when none is set up.
 */
async function resolveCloudSender(): Promise<ZplSender | null> {
  if (await isBrowserPrintAvailable()) {
    const device = await resolveBrowserPrintDevice()
    if (device) {
      return (zpl) => sendZplViaBrowserPrint(device, zpl)
    }
  }
  const usbDevice = await getGrantedWebUsbPrinter()
  if (usbDevice) {
    return (zpl) => sendZplViaWebUsb(usbDevice, zpl)
  }
  const serialPort = await getGrantedWebSerialPort()
  if (serialPort) {
    return (zpl) => sendZplViaWebSerial(serialPort, zpl)
  }
  return null
}

/**
 * Print a calibration label in cloud runtime via the best available transport.
 * Throws {@link NoCloudPrinterError} when nothing is configured so the caller
 * can guide setup.
 */
export async function printJobLabelCloud(
  jobId: string | number,
  options?: { dpi?: 203 | 300 },
): Promise<void> {
  const sender = await resolveCloudSender()
  if (!sender) {
    throw new NoCloudPrinterError()
  }
  const zpl = await calibraApi.jobs.getLabelZpl(
    jobId,
    options?.dpi ? { dpi: options.dpi } : undefined,
  )
  await sender(zpl)
}

const TEST_ZPL = () => buildTestLabelZpl(defaultRenderOptions(203))

/** Send a diagnostic test label to a Browser Print device. */
export async function printTestViaBrowserPrint(
  device: BrowserPrintDevice,
): Promise<void> {
  await sendZplViaBrowserPrint(device, TEST_ZPL())
}

/** Send a diagnostic test label to a granted WebUSB device. */
export async function printTestViaWebUsb(device: USBDevice): Promise<void> {
  await sendZplViaWebUsb(device, TEST_ZPL())
}

/** Send a diagnostic test label to a granted Web Serial port. */
export async function printTestViaWebSerial(port: SerialPort): Promise<void> {
  await sendZplViaWebSerial(port, TEST_ZPL())
}
