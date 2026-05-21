import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type {
  TemplateListResponse,
  WorkbookAnalysis,
  XlsxAssignmentOption,
  XlsxBindingManifest,
  XlsxPreviewResponse,
  XlsxVersionSummary,
  XlsxWorkbenchState,
} from './types'

const ASSIGNMENT_OPTIONS_STALE_TIME_MS = 5 * 60 * 1000

export function certificateTemplatesQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-templates'],
    queryFn: () => calibraApi.certificateTemplates.list<TemplateListResponse>(),
  })
}

export function certificateTemplateMethodsQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-template-assignment-options', 'methods', 'cloud'],
    queryFn: async () => {
      const data = await calibraApi.methods.list({
        page: 1,
        limit: 100,
      })

      return data.data.map<XlsxAssignmentOption>((method) => ({
        id: method.id,
        label: method.name,
        detail: `v${method.version} · ${method.status}`,
      }))
    },
    staleTime: ASSIGNMENT_OPTIONS_STALE_TIME_MS,
  })
}

export function certificateTemplateServicesQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-template-assignment-options', 'services', 'cloud'],
    queryFn: async () => {
      const data = await calibraApi.services.list({
        page: 1,
        limit: 100,
      })

      return data.data.map<XlsxAssignmentOption>((service) => ({
        id: service.id,
        label: service.name,
        detail: service.methodName,
      }))
    },
    staleTime: ASSIGNMENT_OPTIONS_STALE_TIME_MS,
  })
}

export function certificateTemplateUnitsQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-template-assignment-options', 'units', 'cloud'],
    queryFn: async () => {
      const data = await calibraApi.units.getDashboardUnits()
      if (!data) return []

      return data.data.map<XlsxAssignmentOption>((unit) => ({
        id: unit.id,
        label: unit.name,
        detail: unit.role,
      }))
    },
    staleTime: ASSIGNMENT_OPTIONS_STALE_TIME_MS,
  })
}

export function certificateTemplateXlsxVersionQueryOptions({
  templateId,
  versionId,
}: {
  templateId: number | null | undefined
  versionId: number | null | undefined
}) {
  return queryOptions({
    queryKey: ['certificate-template-xlsx-version', templateId, versionId],
    queryFn: async () => {
      if (!templateId || !versionId) {
        throw new Error('Versão XLSX indisponível')
      }

      const data = await calibraApi.certificateTemplates.getXlsxVersion<{
        item: XlsxVersionSummary
        analysis: WorkbookAnalysis
        bindingManifest: XlsxBindingManifest
      }>(templateId, versionId)

      return {
        version: data.item,
        analysis: data.analysis,
        manifest: data.bindingManifest,
      } satisfies XlsxWorkbenchState
    },
  })
}

export function certificateTemplateXlsxPreviewQueryOptions({
  templateId,
  versionId,
  previewId,
}: {
  templateId: number | null | undefined
  versionId: number | null | undefined
  previewId: number | null | undefined
}) {
  return queryOptions({
    queryKey: [
      'certificate-template-xlsx-preview',
      templateId,
      versionId,
      previewId,
    ],
    queryFn: async () => {
      if (!templateId || !versionId || !previewId) {
        throw new Error('Prévia indisponível')
      }

      return calibraApi.certificateTemplates.getXlsxPreview<XlsxPreviewResponse>(
        templateId,
        versionId,
        previewId,
      )
    },
  })
}

export async function prewarmCertificateTemplates(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    certificateTemplatesQueryOptions(),
    certificateTemplateMethodsQueryOptions(),
    certificateTemplateServicesQueryOptions(),
    certificateTemplateUnitsQueryOptions(),
  ])
}

export function useCertificateTemplatesData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...certificateTemplatesQueryOptions(),
    enabled,
    refetchOnWindowFocus: false,
  })
}

export function useCertificateTemplateAssignmentOptions({
  enabled,
}: {
  enabled: boolean
}) {
  return {
    methodsQuery: useQuery({
      ...certificateTemplateMethodsQueryOptions(),
      enabled,
      refetchOnWindowFocus: false,
    }),
    servicesQuery: useQuery({
      ...certificateTemplateServicesQueryOptions(),
      enabled,
      refetchOnWindowFocus: false,
    }),
    unitsQuery: useQuery({
      ...certificateTemplateUnitsQueryOptions(),
      enabled,
      refetchOnWindowFocus: false,
    }),
  }
}

export function useCertificateTemplateXlsxVersionData({
  enabled,
  templateId,
  versionId,
}: {
  enabled: boolean
  templateId: number | null | undefined
  versionId: number | null | undefined
}) {
  return useQuery({
    ...certificateTemplateXlsxVersionQueryOptions({ templateId, versionId }),
    enabled,
    refetchOnWindowFocus: false,
  })
}

export function useCertificateTemplateXlsxPreviewData({
  enabled,
  templateId,
  versionId,
  previewId,
}: {
  enabled: boolean
  templateId: number | null | undefined
  versionId: number | null | undefined
  previewId: number | null | undefined
}) {
  return useQuery({
    ...certificateTemplateXlsxPreviewQueryOptions({
      templateId,
      versionId,
      previewId,
    }),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.item.status === 'PENDING' ? 3000 : false,
    refetchOnWindowFocus: false,
  })
}
