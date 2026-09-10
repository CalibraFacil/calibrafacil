import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  FloppyDiskIcon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'
import type { CreateServiceInput } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import {
  usePublishedMethodsData,
  useServiceAssetTypesData,
} from '@/features/services/queries'
import {
  parseServiceForm,
  type ServiceFormData,
  type ServiceFormField,
} from '@/features/services/forms'
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
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { ACTION_BUTTON_CLASS, Panel } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

const initialFormData: ServiceFormData = {
  name: '',
  description: '',
  methodId: null,
  assetTypeId: null,
  price: '',
  tat: '',
  isActive: true,
}

export function NewServicePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<ServiceFormData>(initialFormData)
  const [errors, setErrors] = useState<
    Partial<Record<ServiceFormField, string>>
  >({})
  const [isAssetTypeLocked, setIsAssetTypeLocked] = useState(false)

  const { data: methodsData, isLoading: methodsLoading } =
    usePublishedMethodsData()
  const { data: assetTypesData, isLoading: assetTypesLoading } =
    useServiceAssetTypesData()

  const selectedMethod = useMemo(() => {
    if (!formData.methodId || !methodsData?.data) return null
    return methodsData.data.find((m) => m.id === formData.methodId) ?? null
  }, [formData.methodId, methodsData?.data])

  const selectedAssetType = useMemo(() => {
    if (!formData.assetTypeId || !assetTypesData?.data) return null
    return (
      assetTypesData.data.find((at) => at.id === formData.assetTypeId) ?? null
    )
  }, [formData.assetTypeId, assetTypesData?.data])

  const selectedMethodName = selectedMethod?.name || ''
  const selectedAssetTypeName = selectedAssetType?.name || ''

  const createMutation = useMutation({
    mutationFn: (data: CreateServiceInput) => calibraApi.services.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      toast.success('Serviço criado com sucesso!')
      navigate({ to: '/dashboard/services' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const isSaving = createMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseServiceForm(formData)
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

  const updateField = <TKey extends keyof ServiceFormData>(
    field: TKey,
    value: ServiceFormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const updateMethodId = (methodId: number | null) => {
    const method = methodsData?.data?.find((m) => m.id === methodId)
    setIsAssetTypeLocked(!!method?.assetTypeId)
    setFormData((prev) => ({
      ...prev,
      methodId,
      assetTypeId: method?.assetTypeId ?? prev.assetTypeId,
    }))
    if (errors.methodId || errors.assetTypeId) {
      setErrors((prev) => ({
        ...prev,
        methodId: undefined,
        assetTypeId: undefined,
      }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="min-w-0 space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Novo serviço
        </h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          Cadastre um item do catálogo, vincule a um método publicado e defina
          as condições usadas em ordens de serviço.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <ServiceFormFields
          formData={formData}
          errors={errors}
          disabled={isSaving}
          methods={methodsData?.data ?? []}
          assetTypes={assetTypesData?.data ?? []}
          methodsLoading={methodsLoading}
          assetTypesLoading={assetTypesLoading}
          isAssetTypeLocked={isAssetTypeLocked}
          selectedMethodName={selectedMethodName}
          selectedAssetTypeName={selectedAssetTypeName}
          updateField={updateField}
          updateMethodId={updateMethodId}
        />

        <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
          <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="px-1 text-pretty text-xs text-muted-foreground">
              Serviços ativos ficam disponíveis para orçamentos e ordens.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/services' })}
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
                    Criar serviço
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
 * The service form body — shared field layout used by both new and edit pages so
 * the two stay visually and structurally identical.
 */
export function ServiceFormFields({
  formData,
  errors,
  disabled,
  methods,
  assetTypes,
  methodsLoading,
  assetTypesLoading,
  isAssetTypeLocked,
  selectedMethodName,
  selectedAssetTypeName,
  updateField,
  updateMethodId,
}: {
  formData: ServiceFormData
  errors: Partial<Record<ServiceFormField, string>>
  disabled: boolean
  methods: Array<{ id: number; name: string; assetTypeName: string | null }>
  assetTypes: Array<{ id: number; name: string }>
  methodsLoading: boolean
  assetTypesLoading: boolean
  isAssetTypeLocked: boolean
  selectedMethodName: string
  selectedAssetTypeName: string
  updateField: <TKey extends keyof ServiceFormData>(
    field: TKey,
    value: ServiceFormData[TKey],
  ) => void
  updateMethodId: (methodId: number | null) => void
}) {
  return (
    <Panel className="divide-y divide-foreground/10">
      <FormBlock title="Identificação">
        <div className="space-y-5">
          <Field>
            <FieldLabel htmlFor="name">Nome do serviço *</FieldLabel>
            <Input
              id="name"
              name="name"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Ex.: Calibração de Balança Digital 0-220g"
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
              placeholder="Escopo, observações comerciais ou condições técnicas…"
              rows={3}
              disabled={disabled}
            />
          </Field>
        </div>
      </FormBlock>

      <FormBlock title="Método e instrumento">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="method">Método de calibração</FieldLabel>
            <Combobox
              value={formData.methodId ? String(formData.methodId) : ''}
              onValueChange={(value) =>
                updateMethodId(value ? Number(value) : null)
              }
              disabled={disabled}
            >
              <ComboboxInput
                id="method"
                name="methodId"
                placeholder="Selecionar método…"
                value={selectedMethodName}
                autoComplete="off"
                showClear={Boolean(formData.methodId)}
              />
              <ComboboxContent>
                <ComboboxList>
                  <ComboboxEmpty>
                    {methodsLoading
                      ? 'Carregando…'
                      : 'Nenhum método publicado encontrado'}
                  </ComboboxEmpty>
                  {methods.map((method) => (
                    <ComboboxItem key={method.id} value={String(method.id)}>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{method.name}</span>
                        {method.assetTypeName && (
                          <span className="truncate text-xs text-muted-foreground">
                            {method.assetTypeName}
                          </span>
                        )}
                      </div>
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <FieldDescription>
              Apenas métodos publicados são exibidos.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="assetType">
              Tipo de instrumento
              {isAssetTypeLocked && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  definido pelo método
                </span>
              )}
            </FieldLabel>
            <Combobox
              value={formData.assetTypeId ? String(formData.assetTypeId) : ''}
              onValueChange={(value) =>
                updateField('assetTypeId', value ? Number(value) : null)
              }
              disabled={disabled || isAssetTypeLocked}
            >
              <ComboboxInput
                id="assetType"
                name="assetTypeId"
                placeholder="Selecionar tipo…"
                value={selectedAssetTypeName}
                autoComplete="off"
                disabled={isAssetTypeLocked}
                showClear={Boolean(formData.assetTypeId)}
              />
              <ComboboxContent>
                <ComboboxList>
                  <ComboboxEmpty>
                    {assetTypesLoading
                      ? 'Carregando…'
                      : 'Nenhum tipo encontrado'}
                  </ComboboxEmpty>
                  {assetTypes.map((assetType) => (
                    <ComboboxItem
                      key={assetType.id}
                      value={String(assetType.id)}
                    >
                      {assetType.name}
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {isAssetTypeLocked ? (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <HugeiconsIcon
                  icon={InformationCircleIcon}
                  className="size-3"
                />
                Acompanha o método selecionado.
              </p>
            ) : (
              <FieldDescription>
                Filtra serviços ao criar uma ordem de serviço.
              </FieldDescription>
            )}
          </Field>
        </div>
      </FormBlock>

      <FormBlock title="Condições comerciais">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="price">Preço</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <Input
                id="price"
                name="price"
                type="text"
                inputMode="decimal"
                value={formData.price}
                onChange={(e) => updateField('price', e.target.value)}
                placeholder="150,00"
                className="pl-10 font-mono tabular-nums"
                disabled={disabled}
                aria-invalid={Boolean(errors.price)}
                aria-describedby={
                  errors.price ? 'price-error' : 'price-description'
                }
              />
            </div>
            <FieldDescription id="price-description">
              Em branco = "Sob consulta".
            </FieldDescription>
            {errors.price && (
              <FieldError id="price-error">{errors.price}</FieldError>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="tat">Prazo</FieldLabel>
            <div className="relative">
              <Input
                id="tat"
                name="tat"
                type="number"
                min="1"
                value={formData.tat}
                onChange={(e) => updateField('tat', e.target.value)}
                placeholder="5"
                className="pr-14 font-mono tabular-nums"
                disabled={disabled}
                aria-invalid={Boolean(errors.tat)}
                aria-describedby={errors.tat ? 'tat-error' : 'tat-description'}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                dias
              </span>
            </div>
            <FieldDescription id="tat-description">
              Tempo de execução estimado.
            </FieldDescription>
            {errors.tat && <FieldError id="tat-error">{errors.tat}</FieldError>}
          </Field>
        </div>
      </FormBlock>

      <FormBlock title="Disponibilidade">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
          <div className="min-w-0 space-y-0.5">
            <FieldLabel htmlFor="isActive" className="text-sm">
              Serviço ativo
            </FieldLabel>
            <p className="text-xs text-muted-foreground">
              Serviços inativos ficam ocultos para clientes.
            </p>
          </div>
          <Switch
            id="isActive"
            checked={formData.isActive}
            onCheckedChange={(checked) => updateField('isActive', checked)}
            disabled={disabled}
          />
        </div>
      </FormBlock>
    </Panel>
  )
}

/** A hairline-divided section inside the single service form card. */
function FormBlock({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="p-4 sm:p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  )
}
