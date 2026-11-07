import type {
  PrinterLanguage,
  SavePrinterProfileInput,
} from '@calibra-facil/schemas'
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
import { printingKeys } from './keys'

export function usePrinterProfiles(enabled: boolean) {
  return useQuery({
    queryKey: printingKeys.profiles,
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
      queryClient.invalidateQueries({ queryKey: printingKeys.profiles }),
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
      queryClient.invalidateQueries({ queryKey: printingKeys.profiles }),
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
    mutationFn: (input: {
      jobId: string | number
      language?: PrinterLanguage
      profileId?: string
    }) =>
      printJobLabel(input.jobId, {
        language: input.language,
        profileId: input.profileId,
      }),
  })
}

// ---------------------------------------------------------------------------
// Cloud runtime — Zebra Browser Print
// ---------------------------------------------------------------------------

export function useBrowserPrintAvailable(enabled: boolean) {
  return useQuery({
    queryKey: printingKeys.browserPrintAvailable,
    queryFn: isBrowserPrintAvailable,
    enabled,
    staleTime: 30_000,
  })
}

export function useBrowserPrintDevices(enabled: boolean) {
  return useQuery({
    queryKey: printingKeys.browserPrintDevices,
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

export function useWebUsbGrantedDevice(enabled: boolean) {
  return useQuery({
    queryKey: printingKeys.webUsbGranted,
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
      queryClient.invalidateQueries({ queryKey: printingKeys.webUsbGranted }),
  })
}

export function useTestWebUsb() {
  return useMutation({
    mutationFn: (device: USBDevice) => printTestViaWebUsb(device),
  })
}

export function useWebSerialGrantedPort(enabled: boolean) {
  return useQuery({
    queryKey: printingKeys.webSerialGranted,
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
      queryClient.invalidateQueries({
        queryKey: printingKeys.webSerialGranted,
      }),
  })
}

export function useTestWebSerial() {
  return useMutation({
    mutationFn: (port: SerialPort) => printTestViaWebSerial(port),
  })
}
