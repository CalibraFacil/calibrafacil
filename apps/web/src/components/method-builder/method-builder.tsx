import { useCallback, useMemo, useState } from 'react'
import { PreviewPanel } from './preview-panel'
import { ConfigurationPanel } from './configuration-panel'
import { defaultMethodData } from './types'

import type { MethodData } from './types'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface MethodBuilderProps {
  initialData?: MethodData
  onSave: (data: MethodData) => void
  onPublish?: (data: MethodData) => void
  onCancel?: () => void
  isSaving?: boolean
  isPublishing?: boolean
  isNew?: boolean
  isReadOnly?: boolean
}

const statusLabels: Record<MethodData['status'], string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Em aprovação',
  TECHNICAL_REVIEWED: 'Revisão técnica',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

const statusVariants: Record<
  MethodData['status'],
  'default' | 'secondary' | 'outline'
> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'outline',
  TECHNICAL_REVIEWED: 'outline',
  PUBLISHED: 'default',
  ARCHIVED: 'outline',
}

export function MethodBuilder({
  initialData,
  onSave,
  onPublish,
  onCancel,
  isSaving = false,
  isPublishing = false,
  isNew = false,
  isReadOnly = false,
}: MethodBuilderProps) {
  const [method, setMethod] = useState<MethodData>(
    initialData ?? defaultMethodData,
  )
  const [previewData, setPreviewData] = useState<Record<string, unknown>>({})
  const [isDirty, setIsDirty] = useState(false)

  const updateMethod = useCallback((updates: Partial<MethodData>) => {
    setMethod((prev) => ({ ...prev, ...updates }))
    setIsDirty(true)
  }, [])

  const handleSave = useCallback(() => {
    onSave(method)
    setIsDirty(false)
  }, [method, onSave])

  const handlePublish = useCallback(() => {
    if (onPublish) {
      onPublish(method)
    }
  }, [method, onPublish])

  const canPublish = useMemo(() => {
    return (
      method.status === 'DRAFT' &&
      method.name.trim().length >= 2 &&
      method.dataFields.length > 0 &&
      !isDirty
    )
  }, [method, isDirty])

  const canSave = useMemo(() => {
    return method.name.trim().length >= 2 && method.dataFields.length > 0
  }, [method])

  const methodSummary = [
    {
      label: 'Campos',
      value: method.dataFields.length,
      helper: 'Entradas',
    },
    {
      label: 'Fórmulas',
      value: method.formulas.length,
      helper: 'Cálculos',
    },
    {
      label: 'Critérios',
      value: method.validations.length,
      helper: 'Aceitação',
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col space-y-6">
      <header className="border-b pb-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariants[method.status]}>
                {statusLabels[method.status]}
              </Badge>
              {!isNew && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  Versão {method.version}
                </span>
              )}
              {isDirty && (
                <span className="text-sm font-medium text-amber-600">
                  Alterações não salvas
                </span>
              )}
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                {isNew ? 'Novo Método' : method.name || 'Método sem nome'}
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground text-pretty">
                Configure entradas, fórmulas e critérios de aceitação mantendo a
                pré-visualização ativa para validar o método antes da revisão.
              </p>
            </div>
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-3 xl:w-[360px]">
            {methodSummary.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-semibold tabular-nums">
                    {item.value}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.helper}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {!isReadOnly && (
            <>
              {onCancel && (
                <Button
                  variant="outline"
                  onClick={onCancel}
                  disabled={isSaving || isPublishing}
                  className="active:scale-[0.96] transition-transform"
                >
                  Cancelar
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={isSaving || !canSave}
                className="active:scale-[0.96] transition-transform"
              >
                {isSaving ? 'Salvando…' : 'Salvar Rascunho'}
              </Button>
              {onPublish && method.status === 'DRAFT' && (
                <Button
                  onClick={handlePublish}
                  disabled={isPublishing || !canPublish}
                  className="active:scale-[0.96] transition-transform"
                >
                  {isPublishing ? 'Enviando…' : 'Solicitar Aprovação'}
                </Button>
              )}
            </>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-8 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.05fr)]">
        <section className="min-h-0 overflow-y-auto pr-1">
          <ConfigurationPanel
            method={method}
            onChange={updateMethod}
            disabled={isReadOnly}
          />
        </section>

        <section className="min-h-0 overflow-y-auto border-l pl-6">
          <PreviewPanel
            method={method}
            previewData={previewData}
            onPreviewDataChange={setPreviewData}
          />
        </section>
      </div>
    </div>
  )
}
