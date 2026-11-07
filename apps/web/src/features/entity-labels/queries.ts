import { queryOptions, useQuery } from '@tanstack/react-query'

import { apiRouteParam } from '@/lib/route-identifiers'
import { calibraApi } from '@/utils/api'
import { customerKeys } from '@/features/customers/keys'
import { assetKeys } from '@/features/assets/keys'
import { methodKeys } from '@/features/methods/keys'
import { jobKeys } from '@/features/jobs/keys'
import { serviceKeys } from '@/features/services/keys'
import { serviceOrderKeys } from '@/features/service-orders/keys'
import { standardKeys } from '@/features/standards/keys'
import { capaKeys, nonConformanceKeys } from '@/features/quality/keys'
import { competenceKeys } from '@/features/personnel/keys'

// A failed lookup is an error, not a label: it is not cached as "no label" for
// this long, and the breadcrumb falls back to its own text meanwhile.
const LABEL_STALE_TIME = 5 * 60 * 1000

type LabelHookInput = {
  enabled: boolean
  id: string
}

export function customerLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: customerKeys.label(id),
    queryFn: async () => {
      const customer = await calibraApi.customers.get({ params: { id } })
      return customer.name
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function assetLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: assetKeys.label(id),
    queryFn: async () => {
      const asset = await calibraApi.assets.get({ params: { id } })
      return asset.name ?? null
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function methodLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: methodKeys.label(id),
    queryFn: async () => {
      const method = await calibraApi.methods.get({ params: { id } })
      return method.name ?? null
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function jobLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: jobKeys.label(id),
    queryFn: async () => {
      const job = await calibraApi.jobs.get({
        params: { id: apiRouteParam(id) },
      })
      return job.jobId ?? null
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function serviceLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: serviceKeys.label(id),
    queryFn: async () => {
      const service = await calibraApi.services.get({ params: { id } })
      return service.name ?? null
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function serviceOrderLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: serviceOrderKeys.label(id),
    queryFn: async () => {
      const serviceOrder = await calibraApi.serviceOrders.get({
        params: { id },
      })
      return serviceOrder.serviceOrderNumber ?? null
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function standardLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: standardKeys.label(id),
    queryFn: async () => {
      const standard = await calibraApi.standards.get({ params: { id } })
      return standard.name ?? null
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function nonConformanceLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: nonConformanceKeys.label(id),
    queryFn: () =>
      calibraApi.entityLabels.getNonConformance({ params: { id } }),
    staleTime: LABEL_STALE_TIME,
  })
}

export function capaLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: capaKeys.label(id),
    queryFn: () => calibraApi.entityLabels.getCapa({ params: { id } }),
    staleTime: LABEL_STALE_TIME,
  })
}

export function competenceLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: competenceKeys.label(id),
    queryFn: () => calibraApi.entityLabels.getCompetence({ params: { id } }),
    staleTime: LABEL_STALE_TIME,
  })
}

export function useCustomerLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...customerLabelQueryOptions(id), enabled })
}

export function useAssetLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...assetLabelQueryOptions(id), enabled })
}

export function useMethodLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...methodLabelQueryOptions(id), enabled })
}

export function useJobLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...jobLabelQueryOptions(id), enabled })
}

export function useServiceLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...serviceLabelQueryOptions(id), enabled })
}

export function useServiceOrderLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...serviceOrderLabelQueryOptions(id), enabled })
}

export function useStandardLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...standardLabelQueryOptions(id), enabled })
}

export function useNonConformanceLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...nonConformanceLabelQueryOptions(id), enabled })
}

export function useCapaLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...capaLabelQueryOptions(id), enabled })
}

export function useCompetenceLabelData({ enabled, id }: LabelHookInput) {
  return useQuery({ ...competenceLabelQueryOptions(id), enabled })
}
