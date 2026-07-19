import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type {
  TemplateListResponse,
  WorkbookAnalysis,
  XlsxBindingManifest,
  XlsxPreviewResponse,
  XlsxVersionSummary,
  XlsxWorkbenchState,
} from './types'

export function certificateTemplatesQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-templates'],
    queryFn: () => calibraApi.certificateTemplates.list<TemplateListResponse>(),
  })
}

/**
 * Every method of the org with its linked template (per-method certificate
 * templates, migration 0104) — powers the "Métodos que usam este modelo"
 * panel. Client-side filter by certificateTemplateId; 100 methods is far
 * above any current org's catalog.
 */
export function certificateTemplateMethodsQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-template-linked-methods', 'cloud'],
    queryFn: async () => {
      const data = await calibraApi.methods.list({
        page: 1,
        limit: 100,
      })

      return data.data.map((method) => ({
        id: method.id,
        name: method.name,
        version: method.version,
        status: method.status,
        certificateTemplateId: method.certificateTemplateId ?? null,
      }))
    },
    staleTime: 5 * 60 * 1000,
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
  ])
}

export function useCertificateTemplatesData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...certificateTemplatesQueryOptions(),
    enabled,
    refetchOnWindowFocus: false,
  })
}

export function useCertificateTemplateLinkedMethods({
  enabled,
}: {
  enabled: boolean
}) {
  return useQuery({
    ...certificateTemplateMethodsQueryOptions(),
    enabled,
    refetchOnWindowFocus: false,
  })
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
