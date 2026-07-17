import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import { certificateTemplatesQueryOptions } from '../queries'
import type {
  PlaceholderCatalogResponse,
  TemplateItem,
  TemplateListResponse,
  WysiwygDocumentResponse,
} from '../types'

const CATALOG_STALE_TIME_MS = 30 * 60 * 1000

export function placeholderCatalogQueryOptions() {
  return queryOptions({
    queryKey: ['certificate-templates', 'placeholder-catalog'],
    queryFn: () =>
      calibraApi.certificateTemplates.getPlaceholderCatalog<PlaceholderCatalogResponse>(),
    staleTime: CATALOG_STALE_TIME_MS,
  })
}

export function wysiwygDocumentQueryOptions(
  templateId: string | number,
  versionId: string | number,
) {
  return queryOptions({
    queryKey: [
      'certificate-templates',
      String(templateId),
      'wysiwyg-document',
      String(versionId),
    ],
    queryFn: () =>
      calibraApi.certificateTemplates.getWysiwygDocument<WysiwygDocumentResponse>(
        templateId,
        versionId,
      ),
  })
}

export function loadCertificateTemplateEditorData(
  queryClient: QueryClient,
  _templateId: string,
) {
  return prewarmRouteQueries(queryClient, [
    certificateTemplatesQueryOptions(),
    placeholderCatalogQueryOptions(),
  ])
}

export type EditorTemplateContext = {
  isLoading: boolean
  template: TemplateItem | null
  /** The template's current version id when (and only when) it is wysiwyg. */
  wysiwygVersionId: number | null
}

export function useEditorTemplateContext(
  templateId: string,
): EditorTemplateContext {
  const listQuery = useQuery(certificateTemplatesQueryOptions())
  const list: TemplateListResponse | undefined = listQuery.data
  const numericId = Number.parseInt(templateId, 10)
  const template = list?.items.find((item) => item.id === numericId) ?? null
  const currentVersion = template?.currentXlsxVersion ?? null
  const wysiwygVersionId =
    currentVersion && currentVersion.engine === 'wysiwyg'
      ? currentVersion.id
      : null

  return {
    isLoading: listQuery.isLoading,
    template,
    wysiwygVersionId,
  }
}

export function useWysiwygDocument(
  templateId: string,
  versionId: number | null,
) {
  return useQuery({
    ...wysiwygDocumentQueryOptions(templateId, versionId ?? 0),
    enabled: versionId !== null,
  })
}

export function usePlaceholderCatalog() {
  return useQuery(placeholderCatalogQueryOptions())
}
