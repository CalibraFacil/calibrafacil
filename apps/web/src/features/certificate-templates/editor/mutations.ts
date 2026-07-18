import { useMutation } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import type { WysiwygVersionDetail } from '../types'
import type { ValidationIssue } from './forms'

/**
 * Persistence mutations for the wysiwyg editor (spec 02 §6.1/§6.2).
 * Thin wrappers over calibraApi so the workbench stays declarative and the
 * whole layer is mockable in jsdom tests via '@/utils/api'.
 */

export type SaveDocumentResponse = {
  item: {
    id: number
    version: number
    status: string
    documentSha256: string
    updatedAt: string | null
  } | null
}

export type ValidateDocumentResponse = {
  ok: boolean
  issues: ValidationIssue[]
  trialCompile?: { compiledHtmlSha256: string; compilerVersion: string }
  status?: string
}

export type PublishResponse = { item: WysiwygVersionDetail }

export type PreviewCreateResponse = {
  item: { id: number; status: string }
}

export type PreviewStatusResponse = {
  item: { id: number; status: string; error?: string | null }
  pdfUrl: string | null
}

export function useSaveWysiwygDocument(
  templateId: string,
  versionId: number | null,
) {
  return useMutation({
    mutationFn: async (input: {
      documentJson: Record<string, unknown>
      expectedDocumentSha256?: string
    }) => {
      if (versionId === null) throw new Error('Versão indisponível')
      return calibraApi.certificateTemplates.saveWysiwygDocument<SaveDocumentResponse>(
        templateId,
        versionId,
        input,
      )
    },
  })
}

export function useValidateWysiwygDocument(
  templateId: string,
  versionId: number | null,
) {
  return useMutation({
    mutationFn: async () => {
      if (versionId === null) throw new Error('Versão indisponível')
      return calibraApi.certificateTemplates.validateWysiwygDocument<ValidateDocumentResponse>(
        templateId,
        versionId,
      )
    },
  })
}

export function usePublishWysiwygVersion(
  templateId: string,
  versionId: number | null,
) {
  return useMutation({
    mutationFn: async () => {
      if (versionId === null) throw new Error('Versão indisponível')
      return calibraApi.certificateTemplates.publishXlsx<PublishResponse>(
        templateId,
        versionId,
      )
    },
  })
}

export function useCreateWysiwygPreview(
  templateId: string,
  versionId: number | null,
) {
  return useMutation({
    mutationFn: async () => {
      if (versionId === null) throw new Error('Versão indisponível')
      return calibraApi.certificateTemplates.createXlsxPreview<PreviewCreateResponse>(
        templateId,
        versionId,
        { sampleData: {} },
      )
    },
  })
}

export type ForkVersionResponse = {
  item: { id: number; version: number; status: string }
}

export function useCreateWysiwygVersion(templateId: string) {
  return useMutation({
    mutationFn: async () => {
      return calibraApi.certificateTemplates.createWysiwygVersion<ForkVersionResponse>(
        templateId,
      )
    },
  })
}

export async function fetchPreviewStatus(
  templateId: string,
  versionId: number,
  previewId: number,
): Promise<PreviewStatusResponse> {
  return calibraApi.certificateTemplates.getXlsxPreview<PreviewStatusResponse>(
    templateId,
    versionId,
    previewId,
  )
}
