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
  _slug: string,
) {
  return prewarmRouteQueries(queryClient, [
    certificateTemplatesQueryOptions(),
    placeholderCatalogQueryOptions(),
  ])
}

export type EditorTemplateContext = {
  isLoading: boolean
  template: TemplateItem | null
  /** The wysiwyg version the editor should open (DRAFT preferred). */
  wysiwygVersionId: number | null
  /** Server-side template-management permission (same flag the list uses). */
  canManage: boolean
}

/**
 * Which wysiwyg version the editor opens for a template: the DRAFT if one
 * exists (there is at most one), else the LATEST wysiwyg version (published,
 * read-only in the workbench). Falls back to currentXlsxVersion for API
 * responses that predate `wysiwygVersions` (deploy skew).
 */
export function resolveEditorWysiwygVersionId(
  template: TemplateItem | null,
): number | null {
  if (!template) return null
  const versions = template.wysiwygVersions ?? []
  const draft = versions.find((version) => version.status === 'DRAFT')
  if (draft) return draft.id
  const latest = versions[0]
  if (latest) return latest.id
  const currentVersion = template.currentXlsxVersion ?? null
  return currentVersion && currentVersion.engine === 'wysiwyg'
    ? currentVersion.id
    : null
}

/** Routes address templates by their org-scoped SLUG — never the numeric id. */
export function useEditorTemplateContext(slug: string): EditorTemplateContext {
  const listQuery = useQuery(certificateTemplatesQueryOptions())
  const list: TemplateListResponse | undefined = listQuery.data
  const template = list?.items.find((item) => item.slug === slug) ?? null

  return {
    isLoading: listQuery.isLoading,
    template,
    wysiwygVersionId: resolveEditorWysiwygVersionId(template),
    canManage: list?.canManage ?? false,
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
