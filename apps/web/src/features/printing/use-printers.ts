import type { SavePrinterProfileInput } from '@calibra-facil/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  isBrowserPrintAvailable,
  listBrowserPrintDevices,
  resolveBrowserPrintDevice,
  type BrowserPrintDevice,
} from './browser-print'
import {
  deletePrinterProfileById,
  fetchPrinterProfiles,
  printTestLabel,
  savePrinterProfile,
} from './local-printer-client'
import {
  printJobLabel,
  printJobLabelViaBrowserPrint,
  printTestViaBrowserPrint,
} from './print-label'

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

export function usePrintJobLabelViaBrowserPrint() {
  return useMutation({
    mutationFn: async (input: {
      jobId: string | number
      device?: BrowserPrintDevice
    }) => {
      const device = input.device ?? (await resolveBrowserPrintDevice())
      if (!device) {
        throw new Error('Nenhuma impressora encontrada no Browser Print')
      }
      await printJobLabelViaBrowserPrint(input.jobId, device)
    },
  })
}

export function useTestBrowserPrint() {
  return useMutation({
    mutationFn: (device: BrowserPrintDevice) =>
      printTestViaBrowserPrint(device),
  })
}
