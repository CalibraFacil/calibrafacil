import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMountEffect } from '@/hooks/use-mount-effect'
import type { PlaceholderCatalogEntry, WysiwygVersionDetail } from '../types'
import { CertificateEditor } from './certificate-editor'
import { parseValidationIssues, type ValidationIssue } from './forms'
import {
  fetchPreviewStatus,
  useCreateWysiwygPreview,
  useCreateWysiwygVersion,
  usePublishWysiwygVersion,
  useSaveWysiwygDocument,
  useValidateWysiwygDocument,
} from './mutations'
import { ValidationChip } from './validation-chip'

const AUTOSAVE_DEBOUNCE_MS = 1500

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const SAVE_LABELS: Record<SaveState, string> = {
  idle: '',
  dirty: 'Alterações não salvas',
  saving: 'Salvando…',
  saved: 'Salvo',
  error: 'Falha ao salvar',
}

/**
 * The editor workbench (spec 02 §6.2 states): editing (autosave-debounced PUT,
 * dirty indicator) → validating → previewing (enqueue + poll) →
 * publish-confirm → published (read-only). Router-free by design — the page
 * adapter composes navigation around it, so this whole flow is jsdom-testable.
 */
export function EditorWorkbench({
  templateId,
  version,
  catalog,
}: {
  templateId: string
  version: WysiwygVersionDetail
  catalog: PlaceholderCatalogEntry[]
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState(version.status)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [documentSha, setDocumentSha] = useState(version.documentSha256)
  const [issues, setIssues] = useState<ValidationIssue[]>(
    parseValidationIssues(version.validationResult),
  )
  const [validatedOk, setValidatedOk] = useState(
    Boolean(
      version.validationResult &&
      Reflect.get(version.validationResult, 'ok') === true,
    ),
  )
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)

  const latestDocumentRef = useRef<Record<string, unknown>>(
    version.documentJson,
  )
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useMountEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
  })

  const editable = status === 'DRAFT'

  const saveMutation = useSaveWysiwygDocument(templateId, version.id)
  const validateMutation = useValidateWysiwygDocument(templateId, version.id)
  const publishMutation = usePublishWysiwygVersion(templateId, version.id)
  const previewMutation = useCreateWysiwygPreview(templateId, version.id)
  const forkMutation = useCreateWysiwygVersion(templateId)

  const previewQuery = useQuery({
    queryKey: [
      'certificate-templates',
      templateId,
      'wysiwyg-preview',
      previewId,
    ],
    queryFn: () => {
      if (previewId === null) throw new Error('unreachable')
      return fetchPreviewStatus(templateId, version.id, previewId)
    },
    enabled: previewId !== null,
    refetchInterval: (query) => {
      const previewStatus = query.state.data?.item.status
      return previewStatus === 'RENDERED' || previewStatus === 'FAILED'
        ? false
        : 1500
    },
  })

  const saveNow = async (): Promise<boolean> => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    setSaveState('saving')
    try {
      const response = await saveMutation.mutateAsync(latestDocumentRef.current)
      if (response.item) setDocumentSha(response.item.documentSha256)
      setSaveState('saved')
      setValidatedOk(false)
      return true
    } catch (error) {
      setSaveState('error')
      toast.error(
        error instanceof Error ? error.message : 'Falha ao salvar o modelo',
      )
      return false
    }
  }

  const handleDocumentChange = (documentJson: Record<string, unknown>) => {
    latestDocumentRef.current = documentJson
    setSaveState('dirty')
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      void saveNow()
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  const ensureSaved = async (): Promise<boolean> => {
    if (saveState === 'dirty' || saveState === 'error') return saveNow()
    return true
  }

  const handleValidate = async () => {
    if (!(await ensureSaved())) return
    try {
      const result = await validateMutation.mutateAsync()
      setIssues(result.issues ?? [])
      setValidatedOk(result.ok)
      if (result.status) setStatus(result.status)
      if (result.ok)
        toast.success('Documento validado — compilação de teste ok')
      else toast.error('Validação encontrou problemas')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao validar o modelo',
      )
    }
  }

  const handlePreview = async () => {
    if (!(await ensureSaved())) return
    try {
      const created = await previewMutation.mutateAsync()
      setPreviewId(created.item.id)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao solicitar prévia',
      )
    }
  }

  const handleFork = async () => {
    try {
      const created = await forkMutation.mutateAsync()
      toast.success(`Nova versão v${created.item.version} criada como rascunho`)
      // The list refetch flips the template's current version to the new
      // DRAFT; the page remounts the workbench (key={version.id}).
      await queryClient.invalidateQueries({
        queryKey: ['certificate-templates'],
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar nova versão',
      )
    }
  }

  const handlePublish = async () => {
    try {
      const published = await publishMutation.mutateAsync()
      setStatus(published.item.status)
      toast.success('Versão publicada — pronta para emissão')
      await queryClient.invalidateQueries({
        queryKey: ['certificate-templates'],
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao publicar a versão',
      )
    }
  }

  const publishBlocked =
    !editable ||
    saveState === 'dirty' ||
    saveState === 'saving' ||
    issues.length > 0 ||
    !validatedOk

  const previewStatus = previewQuery.data?.item.status ?? null
  const previewPdfUrl = previewQuery.data?.pdfUrl ?? null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          v{version.version} · {statusLabel(status)}
        </Badge>
        <span
          className="font-mono text-xs text-muted-foreground"
          title={documentSha}
        >
          {documentSha.slice(0, 12)}…
        </span>
        {saveState !== 'idle' && (
          <Badge
            variant={saveState === 'error' ? 'destructive' : 'outline'}
            data-testid="save-state"
          >
            {SAVE_LABELS[saveState]}
          </Badge>
        )}
        <span className="flex-1" />
        {previewStatus && (
          <span data-testid="preview-status">
            {previewStatus === 'RENDERED' && previewPdfUrl ? (
              <a
                href={previewPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-medium shadow-xs transition-[transform,background-color] hover:bg-muted/50 active:scale-[0.96]"
              >
                <span
                  className="size-1.5 rounded-full bg-emerald-500"
                  aria-hidden
                />
                Abrir prévia em PDF
              </a>
            ) : previewStatus === 'FAILED' ? (
              <span
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/5 px-3 text-xs font-medium text-destructive"
                title={previewQuery.data?.item.error ?? undefined}
              >
                Falha na prévia
              </span>
            ) : (
              <span className="inline-flex h-8 items-center gap-2 rounded-full border bg-background px-3 text-xs text-muted-foreground">
                <span
                  className="size-3 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent"
                  aria-hidden
                />
                Gerando prévia…
              </span>
            )}
          </span>
        )}
        {!editable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleFork()}
            disabled={forkMutation.isPending}
          >
            Nova versão
          </Button>
        )}
        {editable && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleValidate()}
              disabled={validateMutation.isPending}
            >
              Validar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handlePreview()}
              disabled={previewMutation.isPending}
            >
              Gerar prévia
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={publishBlocked}
              onClick={() => setPublishDialogOpen(true)}
            >
              Publicar
            </Button>
            <AlertDialog
              open={publishDialogOpen}
              onOpenChange={setPublishDialogOpen}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publicar esta versão?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A versão v{version.version} ({documentSha.slice(0, 12)}…)
                    ficará imutável e disponível para emissão de certificados.
                    Alterações futuras exigirão uma nova versão.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handlePublish()}>
                    Publicar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      <ValidationChip
        issues={issues}
        documentJson={latestDocumentRef.current}
      />

      {/* Shell reframe: full-width canvas — the sidebar column is gone;
          fields live in the toolbar palette + {{ autocomplete, config in the
          per-block popover. */}
      <CertificateEditor
        initialDocument={version.documentJson}
        catalog={catalog}
        issues={issues}
        editable={editable}
        onDocumentChange={handleDocumentChange}

      />
    </div>
  )
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Rascunho',
    VALIDATED: 'Validado',
    PUBLISHED: 'Publicado',
    ARCHIVED: 'Arquivado',
  }
  return labels[status] ?? status
}
