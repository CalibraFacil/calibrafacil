import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isWysiwygEditorEnabled } from '../wysiwyg-flag'
import { EditorWorkbench } from './editor-workbench'
import {
  useEditorTemplateContext,
  usePlaceholderCatalog,
  useWysiwygDocument,
} from './queries'

export function CertificateTemplateEditorPage({ slug }: { slug: string }) {
  const context = useEditorTemplateContext(slug)
  // API calls stay keyed by the numeric id; only the URL carries the slug.
  const templateId = context.template?.id != null ? String(context.template.id) : null
  const documentQuery = useWysiwygDocument(
    templateId ?? '',
    templateId !== null ? context.wysiwygVersionId : null,
  )
  const catalogQuery = usePlaceholderCatalog()

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
      badges={<Badge variant="outline">Editor visual</Badge>}
    >
      {documentQuery.isLoading || catalogQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : version ? (
        <div className="space-y-3">
          <EditorWorkbench
            key={version.id}
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
