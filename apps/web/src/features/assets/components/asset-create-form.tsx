import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FloppyDiskIcon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons'

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
  baseMeasurementUnitOptions,
  isAssetFormStatus,
  DEFAULT_REGULATED_FORM_FIELDS,
  isAssetSpecificationErrorField,
  parseAssetForm,
  type AssetFormData,
  type AssetFormField,
} from '@/features/assets/forms'
import {
  FormSectionNav,
  type FormNavSection,
} from '@/features/assets/components/form-section-nav'
import { MetrologyRegimeFields } from '@/features/assets/components/metrology-regime-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Field,
  FieldDescription,
  FieldError,
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
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
import { SpecificationsDisplay } from '@/components/specifications-display'
import { formatDate } from '@/features/assets/detail-model'
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  EccentricityIndicator,
  type EccentricityIndicatorPosition,
  isEccentricityIndicatorPosition,
  isWeighingScaleAssetType,
} from '@/components/eccentricity-indicator'
import { isMassAssetTypeDefinition, isMassUnit } from '@calibra-facil/shared'
import {
  dominantKindForAssetType,
  isMeasurementUnit,
} from '@calibra-facil/shared/units'
import type { CreateAssetInput } from '@calibra-facil/schemas'
import { cn } from '@/lib/utils'

/** The asset record returned by `assets.create` (used to auto-select it). */
export type CreatedAsset = Awaited<ReturnType<typeof calibraApi.assets.create>>

const statusLabels: Record<AssetFormData['status'], string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  MAINTENANCE: 'Em Manutenção',
  SCRAPPED: 'Descartado',
}

const PANEL_CLASS = 'p-4 sm:p-5'

/** Which wizard step owns each form field, so we can jump to the first error. */
const FIELD_STEP: Record<string, string> = {
  customerId: 'sec-vinculo',
  assetTypeId: 'sec-vinculo',
  name: 'sec-identificacao',
  tag: 'sec-identificacao',
  serialNumber: 'sec-identificacao',
  manufacturer: 'sec-identificacao',
  model: 'sec-identificacao',
  status: 'sec-identificacao',
  metrologyRegime: 'sec-identificacao',
  regulationReference: 'sec-identificacao',
  regulatedValueMonths: 'sec-identificacao',
  regulatedAnchor: 'sec-identificacao',
  regulatedTechnology: 'sec-identificacao',
  baseMeasurementUnit: 'sec-especificacoes',
  lastCalibrationDate: 'sec-calibracao',
  installedAt: 'sec-calibracao',
  comments: 'sec-observacoes',
}

function stepForField(field: string): string {
  if (field.startsWith('spec_')) return 'sec-especificacoes'
  return FIELD_STEP[field] ?? 'sec-vinculo'
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
  installedAt: undefined,
  comments: '',
  metrologyRegime: 'INDUSTRIAL',
  ...DEFAULT_REGULATED_FORM_FIELDS,
  specifications: {},
}

/**
 * Reusable asset-creation wizard. Owns its state, validation and create
 * mutation, but never navigates or reads route/search params. The customer
 * arrives via `defaultCustomerId`; pass `lockCustomer` (with `lockedCustomerName`)
 * to fix the owner — used when opening from a Service Order. Render it on a
 * dedicated page (`variant "page"`) or inside a sheet/dialog (`variant "sheet"`).
 */
export function AssetCreateForm({
  defaultCustomerId = null,
  lockCustomer = false,
  lockedCustomerName,
  onSaved,
  onCancel,
}: {
  defaultCustomerId?: number | null
  lockCustomer?: boolean
  lockedCustomerName?: string
  onSaved: (asset: CreatedAsset) => void
  onCancel: () => void
  variant?: 'page' | 'sheet'
}) {
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<AssetFormData>(() => ({
    ...initialFormData,
    customerId: defaultCustomerId ?? null,
  }))
  const [errors, setErrors] = useState<Partial<Record<AssetFormField, string>>>(
    {},
  )
  const [customerSearch, setCustomerSearch] = useState('')
  const [activeStep, setActiveStep] = useState('sec-vinculo')

  const { data: customersData, isLoading: customersLoading } =
    useNewAssetCustomersData(customerSearch)
  const { data: assetTypesData, isLoading: assetTypesLoading } =
    useAssetTypesData()

  const selectedCustomerName = useMemo(() => {
    if (lockCustomer) return lockedCustomerName ?? ''
    if (!formData.customerId || !customersData?.data) return ''
    const customer = customersData.data.find(
      (c) => c.id === formData.customerId,
    )
    return customer?.name || ''
  }, [
    lockCustomer,
    lockedCustomerName,
    formData.customerId,
    customersData?.data,
  ])

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
  // Any asset type with a recognizable measurable kind offers a base-unit
  // picker; mass types additionally *require* it (enforced below + by the API).
  const offersBaseUnit =
    requiresMassBaseUnit ||
    (selectedAssetType !== null &&
      dominantKindForAssetType(selectedAssetType.definition) !== null)
  const baseUnitOptions = useMemo(
    () => baseMeasurementUnitOptions(selectedAssetType?.definition),
    [selectedAssetType?.definition],
  )
  // The spec sub-forms below are mass-only; pass the base unit narrowed to mass.
  const activeMassUnit = isMassUnit(formData.baseMeasurementUnit)
    ? formData.baseMeasurementUnit
    : null
  const hasSpecsSection =
    offersBaseUnit ||
    visibleAssetTypeDefinition.length > 0 ||
    showEccentricityIndicator

  const createMutation = useMutation({
    mutationFn: (data: CreateAssetInput) => calibraApi.assets.create(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      onSaved(created)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const isSaving = createMutation.isPending

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
      const firstError = parsed.fieldErrors[0]
      if (firstError) {
        setActiveStep(stepForField(firstError.field))
      }
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

  // Reset specifications when the asset type changes
  const handleAssetTypeChange = (typeId: number | null) => {
    setFormData((prev) => ({
      ...prev,
      assetTypeId: typeId,
      baseMeasurementUnit: null,
      specifications: {},
    }))
    if (errors.assetTypeId) {
      setErrors((prev) => ({ ...prev, assetTypeId: undefined }))
    }
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

  const requiredSpecCount = visibleAssetTypeDefinition.filter(
    (field) => field.required,
  ).length
  const specsComplete =
    (!requiresMassBaseUnit || Boolean(formData.baseMeasurementUnit)) &&
    filledSpecificationCount >= requiredSpecCount

  const navSections: FormNavSection[] = [
    {
      id: 'sec-vinculo',
      label: 'Vínculo',
      complete: Boolean(formData.customerId && formData.assetTypeId),
    },
    {
      id: 'sec-identificacao',
      label: 'Identificação',
      complete: Boolean(
        formData.name.trim() &&
        formData.tag.trim() &&
        formData.serialNumber.trim(),
      ),
    },
    ...(hasSpecsSection
      ? [
          {
            id: 'sec-especificacoes',
            label: 'Especificações',
            complete: specsComplete,
          },
        ]
      : []),
    { id: 'sec-calibracao', label: 'Calibração', optional: true },
    { id: 'sec-observacoes', label: 'Observações', optional: true },
    {
      id: 'sec-revisao',
      label: 'Revisão',
      complete: Boolean(
        formData.customerId &&
        formData.assetTypeId &&
        formData.name.trim() &&
        formData.tag.trim() &&
        formData.serialNumber.trim() &&
        specsComplete,
      ),
    },
  ]

  // Wizard navigation — one step visible at a time, with transitions.
  const stepIds = navSections.map((section) => section.id)
  const activeStepId = stepIds.includes(activeStep) ? activeStep : stepIds[0]
  const activeIndex = stepIds.indexOf(activeStepId)
  const isFirstStep = activeIndex === 0
  const isLastStep = activeIndex === stepIds.length - 1
  const goToStep = (id: string) => setActiveStep(id)
  const goNext = () =>
    setActiveStep(stepIds[Math.min(activeIndex + 1, stepIds.length - 1)])
  const goBack = () => setActiveStep(stepIds[Math.max(activeIndex - 1, 0)])

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <FormSectionNav
          sections={navSections}
          activeId={activeStepId}
          onSelect={goToStep}
        />

        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStepId}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
              className="space-y-6"
            >
              {activeStepId === 'sec-vinculo' ? (
                <Panel className={PANEL_CLASS}>
                  <PanelHeader
                    eyebrow="Vínculo"
                    title="Cliente e tipo"
                    description="Definem o proprietário e as especificações técnicas do ativo."
                  />
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {lockCustomer ? (
                      <Field>
                        <FieldLabel>Cliente</FieldLabel>
                        <div className="rounded-xl bg-muted/40 p-3.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {selectedCustomerName || '—'}
                            </span>
                            <HugeiconsIcon
                              icon={SquareLock02Icon}
                              className="size-3.5 text-muted-foreground/60"
                            />
                          </div>
                        </div>
                        <FieldDescription>
                          O ativo será vinculado ao cliente da ordem de serviço.
                        </FieldDescription>
                      </Field>
                    ) : (
                      <Field>
                        <FieldLabel htmlFor="customer">Cliente *</FieldLabel>
                        <Combobox
                          value={
                            formData.customerId
                              ? String(formData.customerId)
                              : ''
                          }
                          onValueChange={(value) => {
                            updateField(
                              'customerId',
                              value ? Number(value) : null,
                            )
                          }}
                          disabled={isSaving}
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
                        {errors.customerId && (
                          <FieldError>{errors.customerId}</FieldError>
                        )}
                      </Field>
                    )}

                    <Field>
                      <FieldLabel htmlFor="assetType">
                        Tipo de instrumento *
                      </FieldLabel>
                      <Select
                        value={
                          formData.assetTypeId
                            ? String(formData.assetTypeId)
                            : ''
                        }
                        onValueChange={(value) => {
                          handleAssetTypeChange(value ? Number(value) : null)
                        }}
                        disabled={isSaving || assetTypesLoading}
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
                        Define as especificações técnicas do instrumento.
                      </FieldDescription>
                      {errors.assetTypeId && (
                        <FieldError>{errors.assetTypeId}</FieldError>
                      )}
                    </Field>
                  </div>
                </Panel>
              ) : null}

              {activeStepId === 'sec-identificacao' ? (
                <Panel className={PANEL_CLASS}>
                  <PanelHeader
                    eyebrow="Identificação"
                    title="Dados do instrumento"
                    description="Nome, rastreabilidade e estado operacional."
                  />
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="name">Nome do ativo *</FieldLabel>
                      <Input
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        placeholder="Ex.: Balança Analítica…"
                        disabled={isSaving}
                        autoComplete="off"
                      />
                      {errors.name && <FieldError>{errors.name}</FieldError>}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="tag">Tag / ID interno *</FieldLabel>
                      <Input
                        id="tag"
                        name="tag"
                        value={formData.tag}
                        onChange={(e) => updateField('tag', e.target.value)}
                        placeholder="Ex.: BAL-001…"
                        className="font-mono"
                        disabled={isSaving}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {errors.tag && <FieldError>{errors.tag}</FieldError>}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="serialNumber">
                        Número de série *
                      </FieldLabel>
                      <Input
                        id="serialNumber"
                        name="serialNumber"
                        value={formData.serialNumber}
                        onChange={(e) =>
                          updateField('serialNumber', e.target.value)
                        }
                        placeholder="Número de série do fabricante…"
                        className="font-mono"
                        disabled={isSaving}
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
                        disabled={isSaving}
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
                        disabled={isSaving}
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
                        disabled={isSaving}
                      >
                        <SelectTrigger id="status">
                          <span>{statusLabels[formData.status]}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Ativo</SelectItem>
                          <SelectItem value="INACTIVE">Inativo</SelectItem>
                          <SelectItem value="MAINTENANCE">
                            Em Manutenção
                          </SelectItem>
                          <SelectItem value="SCRAPPED">Descartado</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <MetrologyRegimeFields
                    values={formData}
                    onChange={(patch) =>
                      setFormData((prev) => ({ ...prev, ...patch }))
                    }
                    disabled={isSaving}
                    errors={errors}
                    assetTypeSlug={selectedAssetType?.slug}
                  />
                </Panel>
              ) : null}

              {activeStepId === 'sec-especificacoes' && hasSpecsSection ? (
                <Panel className={PANEL_CLASS}>
                  <PanelHeader
                    eyebrow="Características"
                    title="Especificações técnicas"
                    description="Dados que acompanham o ativo nas calibrações e certificados."
                  />
                  <div className="mt-4 space-y-6">
                    {offersBaseUnit ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="baseMeasurementUnit">
                            Unidade base do instrumento
                            {requiresMassBaseUnit ? ' *' : ''}
                          </FieldLabel>
                          <Select
                            value={formData.baseMeasurementUnit ?? ''}
                            onValueChange={(value) =>
                              updateField(
                                'baseMeasurementUnit',
                                isMeasurementUnit(value) ? value : null,
                              )
                            }
                            disabled={isSaving}
                          >
                            <SelectTrigger id="baseMeasurementUnit">
                              <span>
                                {formData.baseMeasurementUnit ||
                                  'Selecione a unidade…'}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              {baseUnitOptions.map((unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FieldDescription>
                            Usada em todo o ciclo do ativo; não pode ser
                            alterada após o cadastro.
                          </FieldDescription>
                          {errors.baseMeasurementUnit && (
                            <FieldError>
                              {errors.baseMeasurementUnit}
                            </FieldError>
                          )}
                        </Field>
                      </div>
                    ) : null}

                    {visibleAssetTypeDefinition.length > 0 ? (
                      <DynamicSpecsForm
                        definition={visibleAssetTypeDefinition}
                        value={formData.specifications}
                        onChange={(specs) =>
                          updateField('specifications', specs)
                        }
                        disabled={isSaving}
                        errors={specErrors}
                        activeMassUnit={activeMassUnit}
                      />
                    ) : null}

                    {showEccentricityIndicator ? (
                      <EccentricityIndicator
                        value={selectedIndicatorPosition}
                        onChange={updateIndicatorPosition}
                        disabled={isSaving}
                        className={
                          offersBaseUnit ||
                          visibleAssetTypeDefinition.length > 0
                            ? undefined
                            : 'border-t-0 pt-0'
                        }
                      />
                    ) : null}
                  </div>
                </Panel>
              ) : null}

              {activeStepId === 'sec-calibracao' ? (
                <Panel className={PANEL_CLASS}>
                  <PanelHeader
                    eyebrow="Programação"
                    title="Calibração"
                    description="Datas usadas para histórico e alertas de recalibração."
                  />
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="lastCalibrationDate">
                        Última calibração
                      </FieldLabel>
                      <DatePicker
                        id="lastCalibrationDate"
                        name="lastCalibrationDate"
                        value={formData.lastCalibrationDate}
                        onChange={(date) =>
                          updateField('lastCalibrationDate', date)
                        }
                        placeholder="Selecione a data…"
                        disabled={isSaving}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="installedAt">
                        Data de instalação
                      </FieldLabel>
                      <DatePicker
                        id="installedAt"
                        name="installedAt"
                        value={formData.installedAt}
                        onChange={(date) => updateField('installedAt', date)}
                        placeholder="Selecione a data…"
                        disabled={isSaving}
                      />
                    </Field>
                    {/* Próxima calibração (periodicidade) é definida pelo cliente
                        no portal, não pelo laboratório (§7.8.4.3 + ILAC-G24).
                        A data de instalação ancora a verificação legal de
                        instrumentos com periodicidade max_months_from_install. */}
                  </div>
                </Panel>
              ) : null}

              {activeStepId === 'sec-observacoes' ? (
                <Panel className={PANEL_CLASS}>
                  <PanelHeader eyebrow="Notas" title="Observações" />
                  <div className="mt-4">
                    <Field>
                      <FieldLabel htmlFor="comments" className="sr-only">
                        Observações
                      </FieldLabel>
                      <Textarea
                        id="comments"
                        name="comments"
                        value={formData.comments}
                        onChange={(e) =>
                          updateField('comments', e.target.value)
                        }
                        placeholder="Observações adicionais sobre o ativo…"
                        disabled={isSaving}
                        rows={3}
                      />
                    </Field>
                  </div>
                </Panel>
              ) : null}

              {activeStepId === 'sec-revisao' ? (
                <Panel className={PANEL_CLASS}>
                  <PanelHeader
                    eyebrow="Revisão"
                    title="Confira antes de criar"
                    description="Revise os dados do ativo. Volte a qualquer seção para ajustar."
                  />
                  <div className="mt-4 space-y-5">
                    <BlueprintGrid className="sm:grid-cols-2 lg:grid-cols-3">
                      <BlueprintField label="Cliente">
                        {selectedCustomerName || '—'}
                      </BlueprintField>
                      <BlueprintField label="Tipo de instrumento">
                        {selectedAssetType?.name || '—'}
                      </BlueprintField>
                      <BlueprintField label="Status">
                        {statusLabels[formData.status]}
                      </BlueprintField>
                      <BlueprintField label="Nome">
                        {formData.name || '—'}
                      </BlueprintField>
                      <BlueprintField label="Tag / ID interno" mono>
                        {formData.tag || '—'}
                      </BlueprintField>
                      <BlueprintField label="Número de série" mono>
                        {formData.serialNumber || '—'}
                      </BlueprintField>
                      <BlueprintField label="Fabricante">
                        {formData.manufacturer || '—'}
                      </BlueprintField>
                      <BlueprintField label="Modelo">
                        {formData.model || '—'}
                      </BlueprintField>
                      {offersBaseUnit ? (
                        <BlueprintField label="Unidade base" mono>
                          {formData.baseMeasurementUnit || '—'}
                        </BlueprintField>
                      ) : null}
                      <BlueprintField label="Última calibração" mono>
                        {formatDate(formData.lastCalibrationDate)}
                      </BlueprintField>
                    </BlueprintGrid>

                    {visibleAssetTypeDefinition.length > 0 ? (
                      <div>
                        <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Especificações técnicas
                        </p>
                        <SpecificationsDisplay
                          definition={visibleAssetTypeDefinition}
                          specifications={formData.specifications}
                          activeMassUnit={activeMassUnit}
                        />
                      </div>
                    ) : null}

                    {showEccentricityIndicator && selectedIndicatorPosition ? (
                      <EccentricityIndicator
                        value={selectedIndicatorPosition}
                        readOnly
                        className="border-t-0 pt-0"
                      />
                    ) : null}

                    {formData.comments.trim() ? (
                      <div>
                        <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Observações
                        </p>
                        <p className="whitespace-pre-wrap text-pretty text-sm leading-6 text-muted-foreground">
                          {formData.comments}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </Panel>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Sticky wizard bar */}
      <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur">
          <p className="px-1 font-mono text-xs tabular-nums text-muted-foreground">
            Passo {activeIndex + 1} de {stepIds.length}
          </p>
          <div className="flex items-center gap-2">
            {isFirstStep ? (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSaving}
                className={ACTION_BUTTON_CLASS}
              >
                Cancelar
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={goBack}
                disabled={isSaving}
                className={ACTION_BUTTON_CLASS}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
                Voltar
              </Button>
            )}
            {isLastStep ? (
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
                    Criar ativo
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={goNext}
                className={cn(ACTION_BUTTON_CLASS, 'min-w-28')}
              >
                Próximo
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="ml-2 size-4"
                />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
