import { queryOptions, useQuery } from '@tanstack/react-query'

import { apiRouteParam } from '@/lib/route-identifiers'
import { calibraApi } from '@/utils/api'

const LABEL_STALE_TIME = 5 * 60 * 1000

type EntityLabelData = {
  name?: string | null
  jobId?: string | null
}

type LabelHookInput = {
  enabled: boolean
  id: string
}

export function customerLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['customers', id, 'label'],
    queryFn: async () => {
      try {
        const customer = await calibraApi.customers.get<EntityLabelData>(id)
        return customer.name ?? null
      } catch {
        return null
      }
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function assetLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['assets', id, 'label'],
    queryFn: async () => {
      try {
        const asset = await calibraApi.assets.get<EntityLabelData>(id)
        return asset.name ?? null
      } catch {
        return null
      }
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function methodLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['methods', id, 'label'],
    queryFn: async () => {
      try {
        const method = await calibraApi.methods.get(id)
        return method.name ?? null
      } catch {
        return null
      }
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function jobLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['jobs', id, 'label'],
    queryFn: async () => {
      try {
        const job = await calibraApi.jobs.get<EntityLabelData>(
          apiRouteParam(id),
        )
        return job.jobId ?? null
      } catch {
        return null
      }
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function serviceLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['services', id, 'label'],
    queryFn: async () => {
      try {
        const service = await calibraApi.services.get(id)
        return service.name ?? null
      } catch {
        return null
      }
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function serviceOrderLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['service-orders', id, 'label'],
    queryFn: async () => {
      try {
        const serviceOrder = await calibraApi.serviceOrders.get(id)
        return serviceOrder.serviceOrderNumber ?? null
      } catch {
        return null
      }
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function standardLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['standards', id, 'label'],
    queryFn: async () => {
      try {
        const standard = await calibraApi.standards.get(id)
        return standard.name ?? null
      } catch {
        return null
      }
    },
    staleTime: LABEL_STALE_TIME,
  })
}

export function nonConformanceLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['non-conformance', id, 'label'],
    queryFn: () => calibraApi.entityLabels.getNonConformance(id),
    staleTime: LABEL_STALE_TIME,
  })
}

export function capaLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['capa', id, 'label'],
    queryFn: () => calibraApi.entityLabels.getCapa(id),
    staleTime: LABEL_STALE_TIME,
  })
}

export function competenceLabelQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['competence', id, 'label'],
    queryFn: () => calibraApi.entityLabels.getCompetence(id),
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
