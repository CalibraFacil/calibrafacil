/**
 * Thin client for the desktop local-server thermal-printing routes
 * (`/api/printer/*`). Only meaningful in desktop runtime — the local-server is
 * what physically reaches the printer. Cloud thermal printing (Zebra Browser
 * Print) arrives in a later phase.
 */
import {
  PrinterDiscoverResultSchema,
  PrinterProfileSchema,
  PrintResultSchema,
  type PrinterDiscoverResult,
  type PrinterProfile,
  type PrintResult,
  type SavePrinterProfileInput,
} from '@calibra-facil/schemas'
import { z } from 'zod'

import { getDesktopLocalApiToken, getLocalApiBaseURL } from '@/utils/api'

async function localPrinterFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getDesktopLocalApiToken()
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  if (token) {
    headers.set('x-calibra-local-token', token)
  }
  return fetch(new URL(path, getLocalApiBaseURL()), {
    ...init,
    headers,
    credentials: 'include',
  })
}

const profilesResponseSchema = z.object({
  profiles: z.array(PrinterProfileSchema),
})
const profileResponseSchema = z.object({ profile: PrinterProfileSchema })

export async function fetchPrinterProfiles(): Promise<PrinterProfile[]> {
  const response = await localPrinterFetch('/api/printer/profiles')
  if (!response.ok) {
    throw new Error('Falha ao carregar impressoras')
  }
  const data: unknown = await response.json()
  return profilesResponseSchema.parse(data).profiles
}

export async function savePrinterProfile(
  input: SavePrinterProfileInput,
): Promise<PrinterProfile> {
  const response = await localPrinterFetch('/api/printer/profiles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new Error('Falha ao salvar impressora')
  }
  const data: unknown = await response.json()
  return profileResponseSchema.parse(data).profile
}

export async function discoverPrinters(): Promise<PrinterDiscoverResult> {
  const response = await localPrinterFetch('/api/printer/discover')
  if (!response.ok) {
    throw new Error('Falha ao detectar impressoras USB/serial')
  }
  const data: unknown = await response.json()
  return PrinterDiscoverResultSchema.parse(data)
}

export async function deletePrinterProfileById(id: string): Promise<void> {
  const response = await localPrinterFetch(
    `/api/printer/profiles/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
  if (!response.ok) {
    throw new Error('Falha ao remover impressora')
  }
}

async function readPrintResult(response: Response): Promise<PrintResult> {
  const data: unknown = await response.json().catch(() => null)
  const parsed = PrintResultSchema.safeParse(data)
  return parsed.success
    ? parsed.data
    : { success: false, error: 'Resposta inválida do servidor local' }
}

export async function printToLocalPrinter(input: {
  commands: string
  profileId?: string
}): Promise<PrintResult> {
  return readPrintResult(
    await localPrinterFetch('/api/printer/print', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
}

export async function printTestLabel(input: {
  profileId?: string
}): Promise<PrintResult> {
  return readPrintResult(
    await localPrinterFetch('/api/printer/test', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
}
