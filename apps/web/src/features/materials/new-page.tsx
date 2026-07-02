import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { FloppyDiskIcon } from '@hugeicons/core-free-icons'
import type { CreateMaterialInput } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import {
  parseMaterialForm,
  type MaterialFormData,
  type MaterialFormField,
} from '@/features/materials/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

const initialFormData: MaterialFormData = {
  name: '',
  description: '',
  sku: '',
  unit: '',
  unitCostCents: '',
  unitPriceCents: '',
  controlsStock: false,
  isActive: true,
}

export function NewMaterialPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<MaterialFormData>(initialFormData)
  const [errors, setErrors] = useState<
    Partial<Record<MaterialFormField, string>>
  >({})

  const createMutation = useMutation({
    mutationFn: (data: CreateMaterialInput) =>
      calibraApi.materials.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] })
      toast.success('Material criado com sucesso!')
      navigate({ to: '/dashboard/materials' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const isSaving = createMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseMaterialForm(formData)
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
    createMutation.mutate(parsed.data)
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
          Novo material
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Cadastre uma peça ou material do catálogo para uso em ordens de
          serviço.
        </p>
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
              Materiais ativos ficam disponíveis para uso em ordens de serviço.
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
                className={cn(ACTION_BUTTON_CLASS, 'min-w-36')}
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
                    Criar material
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

/**
 * The material form body — shared field layout used by both new and edit pages
 * so the two stay visually and structurally identical.
 */
export function MaterialFormFields({
  formData,
  errors,
  disabled,
  updateField,
}: {
  formData: MaterialFormData
  errors: Partial<Record<MaterialFormField, string>>
  disabled: boolean
  updateField: <TKey extends keyof MaterialFormData>(
    field: TKey,
    value: MaterialFormData[TKey],
  ) => void
}) {
  return (
    <Panel className="divide-y divide-foreground/10">
      <FormBlock eyebrow="Identificação">
        <div className="space-y-5">
          <Field>
            <FieldLabel htmlFor="name">Nome do material *</FieldLabel>
            <Input
              id="name"
              name="name"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Ex.: Célula de carga 500kg"
              disabled={disabled}
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'name-error' : undefined}
            />
            {errors.name && (
              <FieldError id="name-error">{errors.name}</FieldError>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="description">Descrição</FieldLabel>
            <Textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Observações técnicas ou comerciais…"
              rows={3}
              disabled={disabled}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="sku">Código (SKU)</FieldLabel>
              <Input
                id="sku"
                name="sku"
                value={formData.sku}
                onChange={(e) => updateField('sku', e.target.value)}
                placeholder="Ex.: SC-500"
                disabled={disabled}
                autoComplete="off"
                aria-invalid={Boolean(errors.sku)}
                aria-describedby={errors.sku ? 'sku-error' : undefined}
              />
              {errors.sku && (
                <FieldError id="sku-error">{errors.sku}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="unit">Unidade</FieldLabel>
              <Input
                id="unit"
                name="unit"
                value={formData.unit}
                onChange={(e) => updateField('unit', e.target.value)}
                placeholder="un"
                disabled={disabled}
                autoComplete="off"
              />
              <FieldDescription>Em branco = "un".</FieldDescription>
            </Field>
          </div>
        </div>
      </FormBlock>

      <FormBlock eyebrow="Condições comerciais">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="unitCostCents">Custo</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <Input
                id="unitCostCents"
                name="unitCostCents"
                type="text"
                inputMode="decimal"
                value={formData.unitCostCents}
                onChange={(e) => updateField('unitCostCents', e.target.value)}
                placeholder="120,50"
                className="pl-10 font-mono tabular-nums"
                disabled={disabled}
                aria-invalid={Boolean(errors.unitCostCents)}
                aria-describedby={
                  errors.unitCostCents
                    ? 'unitCostCents-error'
                    : 'unitCostCents-description'
                }
              />
            </div>
            <FieldDescription id="unitCostCents-description">
              Custo unitário de aquisição. Em branco = não informado.
            </FieldDescription>
            {errors.unitCostCents && (
              <FieldError id="unitCostCents-error">
                {errors.unitCostCents}
              </FieldError>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="unitPriceCents">Preço</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <Input
                id="unitPriceCents"
                name="unitPriceCents"
                type="text"
                inputMode="decimal"
                value={formData.unitPriceCents}
                onChange={(e) => updateField('unitPriceCents', e.target.value)}
                placeholder="199,90"
                className="pl-10 font-mono tabular-nums"
                disabled={disabled}
                aria-invalid={Boolean(errors.unitPriceCents)}
                aria-describedby={
                  errors.unitPriceCents
                    ? 'unitPriceCents-error'
                    : 'unitPriceCents-description'
                }
              />
            </div>
            <FieldDescription id="unitPriceCents-description">
              Preço de venda unitário. Em branco = "Sob consulta".
            </FieldDescription>
            {errors.unitPriceCents && (
              <FieldError id="unitPriceCents-error">
                {errors.unitPriceCents}
              </FieldError>
            )}
          </Field>
        </div>
      </FormBlock>

      <FormBlock eyebrow="Disponibilidade">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
            <div className="min-w-0 space-y-0.5">
              <FieldLabel htmlFor="controlsStock" className="text-sm">
                Controla estoque
              </FieldLabel>
              <p className="text-xs text-muted-foreground">
                Habilita o controle de saldo em estoque para este material.
              </p>
            </div>
            <Switch
              id="controlsStock"
              checked={formData.controlsStock}
              onCheckedChange={(checked) =>
                updateField('controlsStock', checked)
              }
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
            <div className="min-w-0 space-y-0.5">
              <FieldLabel htmlFor="isActive" className="text-sm">
                Material ativo
              </FieldLabel>
              <p className="text-xs text-muted-foreground">
                Materiais inativos ficam ocultos para novos itens de OS.
              </p>
            </div>
            <Switch
              id="isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => updateField('isActive', checked)}
              disabled={disabled}
            />
          </div>
        </div>
      </FormBlock>
    </Panel>
  )
}

/** A hairline-divided section inside the single material form card. */
function FormBlock({
  eyebrow,
  children,
}: {
  eyebrow: string
  children: ReactNode
}) {
  return (
    <section className="p-4 sm:p-5">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {eyebrow}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  )
}
