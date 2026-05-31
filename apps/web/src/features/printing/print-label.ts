import {
  buildTestLabelZpl,
  defaultRenderOptions,
} from '@calibra-facil/label-zpl'

import { calibraApi } from '@/utils/api'

import {
  sendZplViaBrowserPrint,
  type BrowserPrintDevice,
} from './browser-print'
import { printZplToLocalPrinter } from './local-printer-client'

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

/**
 * Print a calibration label via Zebra Browser Print (cloud runtime). Fetches
 * native ZPL from the cloud API, then hands it to the local Browser Print agent.
 */
export async function printJobLabelViaBrowserPrint(
  jobId: string | number,
  device: BrowserPrintDevice,
  options?: { dpi?: 203 | 300 },
): Promise<void> {
  const zpl = await calibraApi.jobs.getLabelZpl(
    jobId,
    options?.dpi ? { dpi: options.dpi } : undefined,
  )
  await sendZplViaBrowserPrint(device, zpl)
}

/** Send a diagnostic test label to a Browser Print device. */
export async function printTestViaBrowserPrint(
  device: BrowserPrintDevice,
): Promise<void> {
  await sendZplViaBrowserPrint(
    device,
    buildTestLabelZpl(defaultRenderOptions(203)),
  )
}
