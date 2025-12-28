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
  isSaving?: boolean
  isPublishing?: boolean
  isNew?: boolean
  isReadOnly?: boolean
}

const statusLabels: Record<MethodData['status'], string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

const statusVariants: Record<
  MethodData['status'],
  'default' | 'secondary' | 'outline'
> = {
  DRAFT: 'secondary',
  PUBLISHED: 'default',
  ARCHIVED: 'outline',
}

export function MethodBuilder({
  initialData,
  onSave,
  onPublish,
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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 p-4 border rounded-lg bg-card">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {isNew ? 'Novo Método' : method.name || 'Sem nome'}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant={statusVariants[method.status]}>
                {statusLabels[method.status]}
              </Badge>
              {!isNew && <span>Versão {method.version}</span>}
              {isDirty && (
                <span className="text-amber-600">Alterações não salvas</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isReadOnly && (
            <>
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={isSaving || !canSave}
              >
                {isSaving ? 'Salvando...' : 'Salvar Rascunho'}
              </Button>
              {onPublish && method.status === 'DRAFT' && (
                <Button
                  onClick={handlePublish}
                  disabled={isPublishing || !canPublish}
                >
                  {isPublishing ? 'Publicando...' : 'Publicar'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left Pane: Configuration */}
        <div className="w-1/2 overflow-y-auto border rounded-lg bg-card">
          <ConfigurationPanel
            method={method}
            onChange={updateMethod}
            disabled={isReadOnly}
          />
        </div>

        {/* Right Pane: Live Preview */}
        <div className="w-1/2 overflow-y-auto border rounded-lg bg-card">
          <PreviewPanel
            method={method}
            previewData={previewData}
            onPreviewDataChange={setPreviewData}
          />
        </div>
      </div>
    </div>
  )
}
