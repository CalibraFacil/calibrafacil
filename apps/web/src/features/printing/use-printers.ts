import type { SavePrinterProfileInput } from '@calibra-facil/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deletePrinterProfileById,
  fetchPrinterProfiles,
  printTestLabel,
  savePrinterProfile,
} from './local-printer-client'
import { printJobLabel } from './print-label'

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
