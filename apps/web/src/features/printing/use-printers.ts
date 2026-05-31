import type { SavePrinterProfileInput } from '@calibra-facil/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  isBrowserPrintAvailable,
  listBrowserPrintDevices,
  type BrowserPrintDevice,
} from './browser-print'
import {
  deletePrinterProfileById,
  discoverPrinters,
  fetchPrinterProfiles,
  printTestLabel,
  savePrinterProfile,
} from './local-printer-client'
import {
  printJobLabel,
  printJobLabelCloud,
  printTestViaBrowserPrint,
  printTestViaWebSerial,
  printTestViaWebUsb,
} from './print-label'
import {
  getGrantedWebSerialPort,
  isWebSerialSupported,
  requestWebSerialPort,
} from './web-serial'
import {
  getGrantedWebUsbPrinter,
  isWebUsbSupported,
  requestWebUsbPrinter,
} from './web-usb'

const PRINTER_PROFILES_KEY = ['printer-profiles']

export function usePrinterProfiles(enabled: boolean) {
  return useQuery({
    queryKey: PRINTER_PROFILES_KEY,
    queryFn: fetchPrinterProfiles,
    enabled,
    staleTime: 30_000,
  })
}

export function useSavePrinterProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SavePrinterProfileInput) => savePrinterProfile(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PRINTER_PROFILES_KEY }),
  })
}

export function useDiscoverPrinters() {
  return useMutation({ mutationFn: () => discoverPrinters() })
}

export function useDeletePrinterProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePrinterProfileById(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PRINTER_PROFILES_KEY }),
  })
}

export function usePrintTestLabel() {
  return useMutation({
    mutationFn: (profileId: string | undefined) =>
      printTestLabel({ profileId }),
  })
}

export function usePrintJobLabel() {
  return useMutation({
    mutationFn: (input: { jobId: string | number; profileId?: string }) =>
      printJobLabel(input.jobId, { profileId: input.profileId }),
  })
}

// ---------------------------------------------------------------------------
// Cloud runtime — Zebra Browser Print
// ---------------------------------------------------------------------------

const BROWSER_PRINT_AVAILABLE_KEY = ['browser-print-available']
const BROWSER_PRINT_DEVICES_KEY = ['browser-print-devices']

export function useBrowserPrintAvailable(enabled: boolean) {
  return useQuery({
    queryKey: BROWSER_PRINT_AVAILABLE_KEY,
    queryFn: isBrowserPrintAvailable,
    enabled,
    staleTime: 30_000,
  })
}

export function useBrowserPrintDevices(enabled: boolean) {
  return useQuery({
    queryKey: BROWSER_PRINT_DEVICES_KEY,
    queryFn: listBrowserPrintDevices,
    enabled,
    staleTime: 30_000,
  })
}

/** Print via the best available cloud transport (Browser Print → WebUSB → Web Serial). */
export function usePrintJobLabelCloud() {
  return useMutation({
    mutationFn: (input: { jobId: string | number }) =>
      printJobLabelCloud(input.jobId),
  })
}

export function useTestBrowserPrint() {
  return useMutation({
    mutationFn: (device: BrowserPrintDevice) =>
      printTestViaBrowserPrint(device),
  })
}

// ---------------------------------------------------------------------------
// Cloud runtime — no-install WebUSB / Web Serial fallback
// ---------------------------------------------------------------------------

const WEB_USB_GRANTED_KEY = ['web-usb-granted']
const WEB_SERIAL_GRANTED_KEY = ['web-serial-granted']

export function useWebUsbGrantedDevice(enabled: boolean) {
  return useQuery({
    queryKey: WEB_USB_GRANTED_KEY,
    queryFn: getGrantedWebUsbPrinter,
    enabled: enabled && isWebUsbSupported(),
    staleTime: 30_000,
  })
}

export function useConnectWebUsb() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => requestWebUsbPrinter(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: WEB_USB_GRANTED_KEY }),
  })
}

export function useTestWebUsb() {
  return useMutation({
    mutationFn: (device: USBDevice) => printTestViaWebUsb(device),
  })
}

export function useWebSerialGrantedPort(enabled: boolean) {
  return useQuery({
    queryKey: WEB_SERIAL_GRANTED_KEY,
    queryFn: getGrantedWebSerialPort,
    enabled: enabled && isWebSerialSupported(),
    staleTime: 30_000,
  })
}

export function useConnectWebSerial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => requestWebSerialPort(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: WEB_SERIAL_GRANTED_KEY }),
  })
}

export function useTestWebSerial() {
  return useMutation({
    mutationFn: (port: SerialPort) => printTestViaWebSerial(port),
  })
}
