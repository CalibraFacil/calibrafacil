/**
 * Zebra Browser Print integration — cloud-mode thermal printing.
 *
 * The lab installs Zebra's free Browser Print agent, which exposes a local HTTP
 * service. We talk to it with plain `fetch` (no SDK bundle). The agent listens
 * on http://localhost:9100 and https://localhost:9101; we must match the page's
 * protocol or the browser blocks it as mixed content — so an HTTPS app uses
 * :9101, which requires the user to trust the agent's self-signed certificate
 * once (visit https://localhost:9101 and accept it).
 *
 * API (reverse-engineered from Zebra's BrowserPrint SDK):
 *   GET  /available            -> { printer: Device[], ... }
 *   GET  /default?type=printer -> Device | ""
 *   POST /write                -> body { device: Device, data: string }
 */

export interface BrowserPrintDevice {
  name: string
  uid: string
  connection: string
  deviceType: string
  version: number
  provider: string
  manufacturer: string
}

const DETECT_TIMEOUT_MS = 2_000
const WRITE_TIMEOUT_MS = 15_000
const PREFERRED_DEVICE_KEY = 'calibra:browser-print-device'

export const BROWSER_PRINT_DOWNLOAD_URL =
  'https://www.zebra.com/us/en/products/software/barcode-printers/link-os/browser-print.html'

function agentBaseUrl(): string {
  const isHttps =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
  return isHttps ? 'https://localhost:9101' : 'http://localhost:9100'
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(Object.entries(value))
}

function toDevice(value: unknown): BrowserPrintDevice | null {
  const record = asRecord(value)
  const name = typeof record.name === 'string' ? record.name : null
  const uid = typeof record.uid === 'string' ? record.uid : null
  if (!name || !uid) {
    return null
  }
  return {
    name,
    uid,
    connection: typeof record.connection === 'string' ? record.connection : '',
    deviceType:
      typeof record.deviceType === 'string' ? record.deviceType : 'printer',
    version: typeof record.version === 'number' ? record.version : 0,
    provider: typeof record.provider === 'string' ? record.provider : '',
    manufacturer:
      typeof record.manufacturer === 'string' ? record.manufacturer : '',
  }
}

async function agentFetch(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DETECT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${agentBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

/** True if the Browser Print agent is reachable (installed + cert trusted). */
export async function isBrowserPrintAvailable(): Promise<boolean> {
  try {
    const response = await agentFetch('/available')
    return response.ok
  } catch {
    return false
  }
}

export async function listBrowserPrintDevices(): Promise<BrowserPrintDevice[]> {
  const response = await agentFetch('/available')
  if (!response.ok) {
    throw new Error('Não foi possível listar as impressoras do Browser Print')
  }
  const data: unknown = await response.json()
  const printers = asRecord(data).printer
  if (!Array.isArray(printers)) {
    return []
  }
  return printers
    .map(toDevice)
    .filter((device): device is BrowserPrintDevice => device !== null)
}

export async function getDefaultBrowserPrintDevice(): Promise<BrowserPrintDevice | null> {
  const response = await agentFetch('/default?type=printer')
  if (!response.ok) {
    return null
  }
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    const data: unknown = JSON.parse(text)
    return toDevice(data)
  } catch {
    return null
  }
}

export async function sendZplViaBrowserPrint(
  device: BrowserPrintDevice,
  zpl: string,
): Promise<void> {
  const response = await agentFetch(
    '/write',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device, data: zpl }),
    },
    WRITE_TIMEOUT_MS,
  )
  if (!response.ok) {
    throw new Error('Falha ao enviar a etiqueta para o Browser Print')
  }
}

export function getPreferredBrowserPrintDeviceUid(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage.getItem(PREFERRED_DEVICE_KEY)
  } catch {
    return null
  }
}

export function setPreferredBrowserPrintDeviceUid(uid: string | null): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    if (uid) {
      window.localStorage.setItem(PREFERRED_DEVICE_KEY, uid)
    } else {
      window.localStorage.removeItem(PREFERRED_DEVICE_KEY)
    }
  } catch {
    // Ignore storage failures (private mode, disabled storage).
  }
}

/**
 * Pick the device to print to: the user's saved preference if still present,
 * else the agent default, else the first available device.
 */
export async function resolveBrowserPrintDevice(): Promise<BrowserPrintDevice | null> {
  const devices = await listBrowserPrintDevices()
  if (devices.length === 0) {
    return null
  }

  const preferredUid = getPreferredBrowserPrintDeviceUid()
  const preferred = preferredUid
    ? devices.find((device) => device.uid === preferredUid)
    : undefined
  if (preferred) {
    return preferred
  }

  const defaultDevice = await getDefaultBrowserPrintDevice()
  if (
    defaultDevice &&
    devices.some((device) => device.uid === defaultDevice.uid)
  ) {
    return defaultDevice
  }

  return devices[0] ?? null
}
