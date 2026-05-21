import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { parseAsInteger, useQueryState } from 'nuqs'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

import { calibraApi } from '@/utils/api'
import {
  useAssetTypesData,
  useNewAssetCustomersData,
} from '@/features/assets/queries'
import {
  isAssetFormStatus,
  isAssetSpecificationErrorField,
  parseAssetForm,
  type AssetFormData,
  type AssetFormField,
} from '@/features/assets/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { DynamicSpecsForm } from '@/components/dynamic-specs-form'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  type EccentricityIndicatorPosition,
  isEccentricityIndicatorPosition,
  isWeighingScaleAssetType,
} from '@/components/eccentricity-indicator'
import { isMassAssetTypeDefinition, isMassUnit } from '@calibra-facil/shared'
import type { CreateAssetInput } from '@calibra-facil/schemas'

const statusLabels: Record<AssetFormData['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

const initialFormData: AssetFormData = {
  customerId: null,
  assetTypeId: null,
  name: '',
  manufacturer: '',
  model: '',
  serialNumber: '',
  tag: '',
  status: 'ACTIVE',
  baseMeasurementUnit: null,
  lastCalibrationDate: undefined,
  nextCalibrationDate: undefined,
  comments: '',
  specifications: {},
}

export function NewAssetPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Read customerId from query params (e.g., /dashboard/assets/new?customerId=123)
  const [customerIdParam] = useQueryState('customerId', parseAsInteger)

  const [formData, setFormData] = useState<AssetFormData>(() => ({
    ...initialFormData,
    customerId: customerIdParam ?? null,
  }))
  const [errors, setErrors] = useState<Partial<Record<AssetFormField, string>>>(
    {},
  )
  const [customerSearch, setCustomerSearch] = useState('')

  // Fetch customers for the combobox
  const { data: customersData, isLoading: customersLoading } =
    useNewAssetCustomersData(customerSearch)

  // Fetch asset types for the dropdown
  const { data: assetTypesData, isLoading: assetTypesLoading } =
    useAssetTypesData()

  // Get the selected customer name
  const selectedCustomerName = useMemo(() => {
    if (!formData.customerId || !customersData?.data) return ''
    const customer = customersData.data.find(
      (c) => c.id === formData.customerId,
    )
    return customer?.name || ''
  }, [formData.customerId, customersData?.data])

  // Get the selected asset type
  const selectedAssetType = useMemo(() => {
    if (!formData.assetTypeId || !assetTypesData?.data) return null
    return (
      assetTypesData.data.find((t) => t.id === formData.assetTypeId) || null
    )
  }, [formData.assetTypeId, assetTypesData?.data])

  const visibleAssetTypeDefinition = useMemo(() => {
    return (
      selectedAssetType?.definition.filter(
        (field) => field.key !== ECCENTRICITY_INDICATOR_SPEC_KEY,
      ) ?? []
    )
  }, [selectedAssetType?.definition])

  const selectedIndicatorPosition = isEccentricityIndicatorPosition(
    formData.specifications[ECCENTRICITY_INDICATOR_SPEC_KEY],
  )
    ? formData.specifications[ECCENTRICITY_INDICATOR_SPEC_KEY]
    : null

  const showEccentricityIndicator =
    selectedAssetType !== null && isWeighingScaleAssetType(selectedAssetType)
  const requiresMassBaseUnit =
    selectedAssetType !== null &&
    isMassAssetTypeDefinition(selectedAssetType.definition, selectedAssetType)

  const createMutation = useMutation({
    mutationFn: (data: CreateAssetInput) => calibraApi.assets.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      toast.success('Ativo criado com sucesso!')
      navigate({ to: '/dashboard/assets' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    const parsed = parseAssetForm(formData, {
      requiresMassBaseUnit,
      specificationFields: selectedAssetType?.definition,
    })
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

  const updateField = <TKey extends keyof AssetFormData>(
    field: TKey,
    value: AssetFormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const updateIndicatorPosition = (
    position: EccentricityIndicatorPosition | null,
  ) => {
    const specifications = { ...formData.specifications }

    if (position) {
      specifications[ECCENTRICITY_INDICATOR_SPEC_KEY] = position
    } else {
      delete specifications[ECCENTRICITY_INDICATOR_SPEC_KEY]
    }

    updateField('specifications', specifications)
  }

  // Handle asset type change - reset specifications when type changes
  const handleAssetTypeChange = (typeId: number | null) => {
    setFormData((prev) => ({
      ...prev,
      assetTypeId: typeId,
      baseMeasurementUnit: null,
      specifications: {}, // Reset specifications when type changes
    }))
    // Clear type error
    if (errors.assetTypeId) {
      setErrors((prev) => ({ ...prev, assetTypeId: undefined }))
    }
    // Clear specification errors
    const specErrorKeys = Object.keys(errors).filter(
      isAssetSpecificationErrorField,
    )
    if (specErrorKeys.length > 0) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        for (const key of specErrorKeys) {
          delete newErrors[key]
        }
        return newErrors
      })
    }
  }

  // Get specification errors in the format expected by DynamicSpecsForm
  const specErrors = useMemo(() => {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(errors)) {
      if (key.startsWith('spec_') && value) {
        result[key.replace('spec_', '')] = value
      }
    }
    return result
  }, [errors])

  const filledSpecificationCount = useMemo(() => {
    return Object.values(formData.specifications).filter((value) => {
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null && value !== ''
    }).length
  }, [formData.specifications])

  const registrationSummary = [
    {
      label: 'Cliente',
      value: selectedCustomerName || 'Pendente',
      complete: Boolean(formData.customerId),
    },
    {
      label: 'Tipo',
      value: selectedAssetType?.name || 'Pendente',
      complete: Boolean(formData.assetTypeId),
    },
    {
      label: 'Identificação',
      value: formData.tag || formData.serialNumber || 'Pendente',
      complete: Boolean(formData.tag.trim() && formData.serialNumber.trim()),
    },
    {
      label: 'Especificações',
      value:
        visibleAssetTypeDefinition.length > 0
          ? `${filledSpecificationCount}/${visibleAssetTypeDefinition.length}`
          : 'Sem campos extras',
      complete:
        visibleAssetTypeDefinition.length === 0 ||
        filledSpecificationCount >=
          visibleAssetTypeDefinition.filter((field) => field.required).length,
    },
  ]

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Novo Ativo
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
            Cadastre o instrumento, vincule ao cliente e registre as
            especificações necessárias para calibração.
          </p>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form
          id="asset-registration-form"
          onSubmit={handleSubmit}
          className="min-w-0"
        >
          <FieldGroup className="gap-0 divide-y">
            <FormSection
              title="Vínculo"
              description="Cliente proprietário e tipo técnico do instrumento."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="customer">Cliente *</FieldLabel>
                  <Combobox
                    value={
                      formData.customerId ? String(formData.customerId) : ''
                    }
                    onValueChange={(value) => {
                      updateField('customerId', value ? Number(value) : null)
                    }}
                    disabled={createMutation.isPending}
                  >
                    <ComboboxInput
                      id="customer"
                      name="customerId"
                      placeholder="Buscar cliente…"
                      value={selectedCustomerName || customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      autoComplete="off"
                      showClear={!!formData.customerId}
                    />
                    <ComboboxContent>
                      <ComboboxList>
                        <ComboboxEmpty>
                          {customersLoading
                            ? 'Carregando…'
                            : 'Nenhum cliente encontrado'}
                        </ComboboxEmpty>
                        {customersData?.data?.map((customer) => (
                          <ComboboxItem
                            key={customer.id}
                            value={String(customer.id)}
                          >
                            {customer.name}
                            {customer.taxId && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {customer.taxId}
                              </span>
                            )}
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>
                    Selecione o cliente proprietário do ativo.
                  </FieldDescription>
                  {errors.customerId && (
                    <FieldError>{errors.customerId}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="assetType">
                    Tipo de Instrumento *
                  </FieldLabel>
                  <Select
                    value={
                      formData.assetTypeId ? String(formData.assetTypeId) : ''
                    }
                    onValueChange={(value) => {
                      handleAssetTypeChange(value ? Number(value) : null)
                    }}
                    disabled={createMutation.isPending || assetTypesLoading}
                  >
                    <SelectTrigger id="assetType">
                      <span>
                        {assetTypesLoading
                          ? 'Carregando…'
                          : selectedAssetType?.name || 'Selecione o tipo…'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {assetTypesData?.data?.map((type) => (
                        <SelectItem key={type.id} value={String(type.id)}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    O tipo define as especificações técnicas do instrumento.
                  </FieldDescription>
                  {errors.assetTypeId && (
                    <FieldError>{errors.assetTypeId}</FieldError>
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Identificação"
              description="Nome, rastreabilidade e estado operacional."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="name">Nome do Ativo *</FieldLabel>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Ex.: Balança Analítica…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  {errors.name && <FieldError>{errors.name}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="tag">Tag / ID Interno *</FieldLabel>
                  <Input
                    id="tag"
                    name="tag"
                    value={formData.tag}
                    onChange={(e) => updateField('tag', e.target.value)}
                    placeholder="Ex.: BAL-001…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <FieldDescription>
                    Identificador único do ativo no laboratório.
                  </FieldDescription>
                  {errors.tag && <FieldError>{errors.tag}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="serialNumber">
                    Número de Série *
                  </FieldLabel>
                  <Input
                    id="serialNumber"
                    name="serialNumber"
                    value={formData.serialNumber}
                    onChange={(e) =>
                      updateField('serialNumber', e.target.value)
                    }
                    placeholder="Número de série do fabricante…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {errors.serialNumber && (
                    <FieldError>{errors.serialNumber}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="manufacturer">Fabricante</FieldLabel>
                  <Input
                    id="manufacturer"
                    name="manufacturer"
                    value={formData.manufacturer}
                    onChange={(e) =>
                      updateField('manufacturer', e.target.value)
                    }
                    placeholder="Ex.: Mettler Toledo…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="model">Modelo</FieldLabel>
                  <Input
                    id="model"
                    name="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    placeholder="Ex.: XPE205…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="status">Status</FieldLabel>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => {
                      if (isAssetFormStatus(value)) {
                        updateField('status', value)
                      }
                    }}
                    disabled={createMutation.isPending}
                  >
                    <SelectTrigger id="status">
                      <span>{statusLabels[formData.status]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Ativo</SelectItem>
                      <SelectItem value="INACTIVE">Inativo</SelectItem>
                      <SelectItem value="MAINTENANCE">Em Manutenção</SelectItem>
                      <SelectItem value="SCRAPPED">Descartado</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FormSection>

            {(requiresMassBaseUnit ||
              visibleAssetTypeDefinition.length > 0 ||
              showEccentricityIndicator) && (
              <FormSection
                title="Especificações Técnicas"
                description="Dados que acompanham o ativo nas calibrações e certificados."
              >
                <div className="space-y-6">
                  {requiresMassBaseUnit && (
                    <Field>
                      <FieldLabel htmlFor="baseMeasurementUnit">
                        Unidade Base do Instrumento *
                      </FieldLabel>
                      <Select
                        value={formData.baseMeasurementUnit ?? ''}
                        onValueChange={(value) =>
                          updateField(
                            'baseMeasurementUnit',
                            isMassUnit(value) ? value : null,
                          )
                        }
                        disabled={createMutation.isPending}
                      >
                        <SelectTrigger id="baseMeasurementUnit">
                          <span>
                            {formData.baseMeasurementUnit ||
                              'Selecione a unidade…'}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kg">kg</SelectItem>
                          <SelectItem value="g">g</SelectItem>
                          <SelectItem value="mg">mg</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Esta unidade será usada em todo o ciclo do ativo e não
                        poderá ser alterada depois do cadastro.
                      </FieldDescription>
                      {errors.baseMeasurementUnit && (
                        <FieldError>{errors.baseMeasurementUnit}</FieldError>
                      )}
                    </Field>
                  )}

                  {visibleAssetTypeDefinition.length > 0 && (
                    <DynamicSpecsForm
                      definition={visibleAssetTypeDefinition}
                      value={formData.specifications}
                      onChange={(specs) => updateField('specifications', specs)}
                      disabled={createMutation.isPending}
                      errors={specErrors}
                      activeMassUnit={formData.baseMeasurementUnit}
                    />
                  )}

                  {showEccentricityIndicator && (
                    <EccentricityIndicator
                      value={selectedIndicatorPosition}
                      onChange={updateIndicatorPosition}
                      disabled={createMutation.isPending}
                    />
                  )}
                </div>
              </FormSection>
            )}

            <FormSection
              title="Calendário"
              description="Datas usadas para histórico e alertas de recalibração."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="lastCalibrationDate">
                    Última Calibração
                  </FieldLabel>
                  <DatePicker
                    id="lastCalibrationDate"
                    name="lastCalibrationDate"
                    value={formData.lastCalibrationDate}
                    onChange={(date) =>
                      updateField('lastCalibrationDate', date)
                    }
                    placeholder="Selecione a data…"
                    disabled={createMutation.isPending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="nextCalibrationDate">
                    Próxima Calibração
                  </FieldLabel>
                  <DatePicker
                    id="nextCalibrationDate"
                    name="nextCalibrationDate"
                    value={formData.nextCalibrationDate}
                    onChange={(date) =>
                      updateField('nextCalibrationDate', date)
                    }
                    placeholder="Selecione a data…"
                    disabled={createMutation.isPending}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Observações">
              <Field>
                <FieldLabel htmlFor="comments">Observações</FieldLabel>
                <Textarea
                  id="comments"
                  name="comments"
                  value={formData.comments}
                  onChange={(e) => updateField('comments', e.target.value)}
                  placeholder="Observações adicionais sobre o ativo…"
                  disabled={createMutation.isPending}
                  rows={3}
                />
              </Field>
            </FormSection>

            <div className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/assets' })}
                disabled={createMutation.isPending}
                className="active:scale-[0.96] transition-transform"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="active:scale-[0.96] transition-transform"
              >
                {createMutation.isPending ? 'Salvando…' : 'Criar Ativo'}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border-l pl-5">
            <h2 className="text-sm font-medium">Resumo do Cadastro</h2>
            <dl className="mt-4 space-y-4">
              {registrationSummary.map((item) => (
                <div key={item.label} className="space-y-1">
                  <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        item.complete ? 'bg-primary' : 'bg-muted-foreground/35'
                      }`}
                    />
                    {item.label}
                  </dt>
                  <dd className="min-w-0 truncate text-sm text-foreground">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground text-pretty">
              O ativo fica disponível para ordens de calibração assim que for
              criado.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-balance">{title}</h2>
        {description && (
          <p className="text-sm leading-5 text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
