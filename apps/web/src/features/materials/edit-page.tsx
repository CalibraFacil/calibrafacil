import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { FloppyDiskIcon } from '@hugeicons/core-free-icons'
import type { UpdateMaterialInput } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import { useMaterialDetailData } from '@/features/materials/queries'
import {
  parseMaterialEditForm,
  type MaterialFormData,
  type MaterialFormField,
} from '@/features/materials/forms'
import type { MaterialDetail } from '@/features/materials/types'
import { MaterialFormFields } from '@/features/materials/new-page'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

export function EditMaterialPage({ id }: { id: string }) {
  const {
    data: materialData,
    isLoading: materialLoading,
    error: materialError,
  } = useMaterialDetailData(id)

  if (materialLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-7 w-52" />
        </div>
        {Array.from({ length: 2 }).map((_section, index) => (
          <Skeleton key={index} className="h-40 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (materialError || !materialData) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          {materialError
            ? `Erro ao carregar material: ${materialError.message}`
            : 'Material não encontrado.'}
        </p>
      </Panel>
    )
  }

  return <EditMaterialForm key={materialData.id} materialData={materialData} />
}

function EditMaterialForm({ materialData }: { materialData: MaterialDetail }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<MaterialFormData>({
    name: materialData.name,
    description: materialData.description || '',
    sku: materialData.sku || '',
    unit: materialData.unit,
    unitCostCents:
      materialData.unitCostCents !== null
        ? (materialData.unitCostCents / 100).toFixed(2).replace('.', ',')
        : '',
    unitPriceCents:
      materialData.unitPriceCents !== null
        ? (materialData.unitPriceCents / 100).toFixed(2).replace('.', ',')
        : '',
    controlsStock: materialData.controlsStock,
    isActive: materialData.isActive,
  })
  const [errors, setErrors] = useState<
    Partial<Record<MaterialFormField, string>>
  >({})

  const updateMutation = useMutation({
    mutationFn: (data: UpdateMaterialInput) =>
      calibraApi.materials.update(materialData.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] })
      queryClient.invalidateQueries({
        queryKey: ['materials', String(materialData.id)],
      })
      toast.success('Material atualizado com sucesso!')
      navigate({ to: '/dashboard/materials' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const isSaving = updateMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseMaterialEditForm(formData)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((error) => [error.field, error.message]),
        ),
      )
      toast.error(parsed.message)
      return
    }

    setErrors({})
    updateMutation.mutate(parsed.data)
  }

  const updateField = <TKey extends keyof MaterialFormData>(
    field: TKey,
    value: MaterialFormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Peças e materiais
        </p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Editar material
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <MaterialFormFields
          formData={formData}
          errors={errors}
          disabled={isSaving}
          updateField={updateField}
        />

        <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
          <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="px-1 text-pretty text-xs text-muted-foreground">
              As alterações substituem os dados atuais do material.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/materials' })}
                disabled={isSaving}
                className={ACTION_BUTTON_CLASS}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className={cn(ACTION_BUTTON_CLASS, 'min-w-40')}
              >
                {isSaving ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Salvando…
                  </>
                ) : (
                  <>
                    <HugeiconsIcon
                      icon={FloppyDiskIcon}
                      className="mr-2 size-4"
                    />
                    Salvar alterações
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
