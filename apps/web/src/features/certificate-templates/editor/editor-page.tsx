import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { calibraApi } from '@/utils/api'
import type { WysiwygDocumentResponse } from '../types'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { isWysiwygEditorEnabled } from '../wysiwyg-flag'
import { EditorWorkbench } from './editor-workbench'
import {
  useEditorTemplateContext,
  usePlaceholderCatalog,
  useWysiwygDocument,
} from './queries'

const VERSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  VALIDATED: 'Validado',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

export function CertificateTemplateEditorPage({ slug }: { slug: string }) {
  const context = useEditorTemplateContext(slug)
  // API calls stay keyed by the numeric id; only the URL carries the slug.
  const templateId = context.template?.id != null ? String(context.template.id) : null
  // Version history: default follows the DRAFT-preferred resolution, but any
  // version can be opened (published ones render read-only).
  const [versionOverride, setVersionOverride] = useState<number | null>(null)
  const wysiwygVersions = context.template?.wysiwygVersions ?? []
  const activeVersionId =
    versionOverride !== null &&
    wysiwygVersions.some((candidate) => candidate.id === versionOverride)
      ? versionOverride
      : context.wysiwygVersionId
  const documentQuery = useWysiwygDocument(
    templateId ?? '',
    templateId !== null ? activeVersionId : null,
  )
  const catalogQuery = usePlaceholderCatalog()
  const queryClient = useQueryClient()
  const [discardNonce, setDiscardNonce] = useState(0)

  const draftVersion = wysiwygVersions.find(
    (candidate) => candidate.status === 'DRAFT',
  )
  const latestPublished =
    [...wysiwygVersions]
      .filter((candidate) => candidate.status === 'PUBLISHED')
      .sort((a, b) => b.version - a.version)[0] ?? null

  const discardMutation = useMutation({
    mutationFn: async () => {
      if (!templateId || !draftVersion || !latestPublished) {
        throw new Error('Não há rascunho ou versão publicada para restaurar')
      }
      const published =
        await calibraApi.certificateTemplates.getWysiwygDocument<WysiwygDocumentResponse>(
          templateId,
          latestPublished.id,
        )
      if (!published.item) throw new Error('Versão publicada indisponível')
      return calibraApi.certificateTemplates.saveWysiwygDocument(
        templateId,
        draftVersion.id,
        { documentJson: published.item.documentJson },
      )
    },
    onSuccess: async () => {
      toast.success(
        `Rascunho restaurado a partir da v${latestPublished?.version} publicada`,
      )
      await queryClient.invalidateQueries({
        queryKey: ['certificate-templates'],
      })
      setDiscardNonce((nonce) => nonce + 1)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao descartar rascunho',
      )
    },
  })

  if (!isWysiwygEditorEnabled()) {
    return (
      <EditorShell title="Editor de certificados">
        <p className="text-sm text-muted-foreground">
          O editor visual ainda não está habilitado neste ambiente.
        </p>
        <BackToListButton />
      </EditorShell>
    )
  }

  if (context.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!context.template) {
    return (
      <EditorShell title="Modelo não encontrado">
        <p className="text-sm text-muted-foreground">
          O modelo solicitado não existe ou não pertence a esta organização.
        </p>
        <BackToListButton />
      </EditorShell>
    )
  }

  if (templateId === null || context.wysiwygVersionId === null) {
    return (
      <EditorShell title={context.template.name}>
        <p className="text-sm text-muted-foreground">
          Este modelo usa o motor XLSX. O editor visual está disponível apenas
          para modelos criados no editor.
        </p>
        <BackToListButton />
      </EditorShell>
    )
  }

  const version = documentQuery.data?.item ?? null

  return (
    <EditorShell
      title={context.template.name}
      badges={
        <>
          <Badge variant="outline">Editor visual</Badge>
          {wysiwygVersions.length > 1 && (
            <NativeSelect
              aria-label="Histórico de versões"
              value={String(activeVersionId ?? '')}
              className="h-8 w-52 text-xs"
              onChange={(event) => {
                const parsed = Number(event.target.value)
                setVersionOverride(Number.isFinite(parsed) ? parsed : null)
              }}
            >
              {wysiwygVersions.map((wysiwygVersion) => (
                <NativeSelectOption
                  key={wysiwygVersion.id}
                  value={String(wysiwygVersion.id)}
                >
                  v{wysiwygVersion.version} ·{' '}
                  {VERSION_STATUS_LABELS[wysiwygVersion.status] ??
                    wysiwygVersion.status}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {draftVersion &&
            latestPublished &&
            activeVersionId === draftVersion.id && (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      disabled={discardMutation.isPending}
                    >
                      {discardMutation.isPending
                        ? 'Restaurando…'
                        : 'Descartar rascunho'}
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Descartar as alterações do rascunho?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      O conteúdo do rascunho v{draftVersion.version} será
                      substituído pelo da versão v{latestPublished.version}{' '}
                      publicada. Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => discardMutation.mutate()}
                    >
                      Descartar rascunho
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
        </>
      }
    >
      {documentQuery.isLoading || catalogQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : version ? (
        <div className="space-y-3">
          <EditorWorkbench
            key={`${version.id}:${discardNonce}`}
            templateId={templateId}
            version={version}
            catalog={catalogQuery.data?.items ?? []}
          />
          <BackToListButton />
        </div>
      ) : (
        <p className="text-sm text-destructive">
          Falha ao carregar o documento do modelo.
        </p>
      )}
    </EditorShell>
  )
}

function EditorShell({
  title,
  badges,
  children,
}: {
  title: string
  badges?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {badges}
      </div>
      {children}
    </div>
  )
}

function BackToListButton() {
  return (
    <Link
      to="/dashboard/certificate-templates"
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      Voltar aos modelos
    </Link>
  )
}
