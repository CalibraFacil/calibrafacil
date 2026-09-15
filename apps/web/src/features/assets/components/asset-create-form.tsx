import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

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
  listMissingAssetRequirements,
  parseAssetForm,
  type AssetFormData,
  type AssetFormField,
} from '@/features/assets/forms'
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
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
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

/** Inline "chip" surface for read-only facts inside the form (locked customer). */
const CHIP_CLASS =
  'inline-flex max-w-full items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]'

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

/** Accent-insensitive, case-insensitive text for the asset-type search. */
function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** DOM id of the input that owns a form field, so a failed submit can land on it. */
function fieldElementId(field: AssetFormField): string {
  if (field === 'customerId') return 'customer'
  if (field === 'assetTypeId') return 'assetType'
  if (isAssetSpecificationErrorField(field)) {
    return `spec-${field.slice('spec_'.length)}`
  }
  return field
}

function focusField(field: AssetFormField) {
  const element = document.getElementById(fieldElementId(field))
  if (!(element instanceof HTMLElement)) return
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element.focus({ preventScroll: true })
}

/**
 * Asset-creation form. One scrolling form, revealed by the instrument type:
 * the type drives which specifications, base-unit and regulation catalog
 * apply, so it comes first and the type-specific section appears once it is
 * chosen. Required fields are validated on submit (the footer shows what is
 * still missing as you go); the rarely-needed dates, status and notes sit
 * behind a disclosure so the common path stays short.
 *
 * Owns its state, validation and create mutation, but never navigates or
 * reads route/search params. The customer arrives via `defaultCustomerId`;
 * pass `lockCustomer` (with `lockedCustomerName`) to fix the owner — used when
 * opening from a Service Order. Render it on a dedicated page (`variant
 * "page"`) or inside a sheet/dialog (`variant "sheet"`).
 */
export function AssetCreateForm({
  defaultCustomerId = null,
  lockCustomer = false,
  lockedCustomerName,
  onSaved,
  onCancel,
  variant = 'page',
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
  const [assetTypeSearch, setAssetTypeSearch] = useState('')

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
  }, [lockCustomer, lockedCustomerName, formData.customerId, customersData])

  const selectedAssetType = useMemo(() => {
    if (!formData.assetTypeId || !assetTypesData?.data) return null
    return (
      assetTypesData.data.find((t) => t.id === formData.assetTypeId) || null
    )
  }, [formData.assetTypeId, assetTypesData])

  const filteredAssetTypes = useMemo(() => {
    const all = assetTypesData?.data ?? []
    const query = normalizeText(assetTypeSearch).trim()
    if (!query) return all
    return all.filter(
      (type) =>
        normalizeText(type.name).includes(query) ||
        normalizeText(type.slug).includes(query),
    )
  }, [assetTypesData?.data, assetTypeSearch])

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
    selectedAssetType !== null &&
    (offersBaseUnit ||
      visibleAssetTypeDefinition.length > 0 ||
      showEccentricityIndicator)

  const missingRequirements = useMemo(
    () =>
      listMissingAssetRequirements(formData, {
        requiresMassBaseUnit,
        specificationFields: selectedAssetType?.definition,
      }),
    [formData, requiresMassBaseUnit, selectedAssetType?.definition],
  )

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
      if (firstError) focusField(firstError.field)
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
    setAssetTypeSearch('')
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

  const namePlaceholder = selectedAssetType
    ? `Ex.: ${selectedAssetType.name}…`
    : 'Ex.: Balança analítica…'

  const assetTypeField = (
    <Field>
      <FieldLabel htmlFor="assetType">Tipo de instrumento *</FieldLabel>
      <Combobox
        value={formData.assetTypeId ? String(formData.assetTypeId) : ''}
        onValueChange={(value) => {
          handleAssetTypeChange(value ? Number(value) : null)
        }}
        disabled={isSaving || assetTypesLoading}
      >
        <ComboboxInput
          id="assetType"
          name="assetTypeId"
          placeholder={
            assetTypesLoading ? 'Carregando…' : 'Buscar tipo de instrumento…'
          }
          value={selectedAssetType?.name || assetTypeSearch}
          onChange={(e) => setAssetTypeSearch(e.target.value)}
          autoComplete="off"
          showClear={!!formData.assetTypeId}
          aria-invalid={Boolean(errors.assetTypeId)}
        />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxEmpty>Nenhum tipo encontrado</ComboboxEmpty>
            {filteredAssetTypes.map((type) => (
              <ComboboxItem key={type.id} value={String(type.id)}>
                {type.name}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>
        Define as especificações e o enquadramento do instrumento.
      </FieldDescription>
      {errors.assetTypeId && <FieldError>{errors.assetTypeId}</FieldError>}
    </Field>
  )

  return (
    <form
      onSubmit={handleSubmit}
      className={variant === 'sheet' ? 'flex min-h-0 flex-col' : 'space-y-6'}
    >
      <Panel className={PANEL_CLASS}>
        <div className="divide-y divide-foreground/10">
          <FormSection
            title="Instrumento"
            description={
              lockCustomer
                ? 'O tipo define quais especificações o instrumento carrega.'
                : 'Quem é o proprietário e que tipo de instrumento está sendo cadastrado.'
            }
            className="pb-6"
          >
            {lockCustomer ? (
              <div className="space-y-4">
                <div className={CHIP_CLASS}>
                  <HugeiconsIcon
                    icon={SquareLock02Icon}
                    className="size-3.5 shrink-0 text-muted-foreground/70"
                  />
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="truncate font-medium">
                    {selectedCustomerName || '—'}
                  </span>
                </div>
                {assetTypeField}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {assetTypeField}
                <Field>
                  <FieldLabel htmlFor="customer">Cliente *</FieldLabel>
                  <Combobox
                    value={
                      formData.customerId ? String(formData.customerId) : ''
                    }
                    onValueChange={(value) => {
                      updateField('customerId', value ? Number(value) : null)
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
                      aria-invalid={Boolean(errors.customerId)}
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
              </div>
            )}
          </FormSection>

          <FormSection
            title="Identificação"
            description="Como o instrumento aparece na OS, na etiqueta e no certificado."
            className="py-6"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="name">Nome do ativo *</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder={namePlaceholder}
                  disabled={isSaving}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.name)}
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
                  aria-invalid={Boolean(errors.tag)}
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
                  onChange={(e) => updateField('serialNumber', e.target.value)}
                  placeholder="Número de série do fabricante…"
                  className="font-mono"
                  disabled={isSaving}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.serialNumber)}
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
                  onChange={(e) => updateField('manufacturer', e.target.value)}
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
            </div>
          </FormSection>

          <AnimatePresence initial={false}>
            {hasSpecsSection ? (
              <motion.section
                key={selectedAssetType.id}
                initial={{ opacity: 0, transform: 'translateY(6px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                className="py-6"
              >
                <PanelHeader
                  title="Especificações técnicas"
                  description={`Dados de ${selectedAssetType.name.toLocaleLowerCase('pt-BR')} que acompanham o ativo nas calibrações e certificados.`}
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
                          <SelectTrigger
                            id="baseMeasurementUnit"
                            aria-invalid={Boolean(errors.baseMeasurementUnit)}
                          >
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
                          Usada em todo o ciclo do ativo; não pode ser alterada
                          após o cadastro.
                        </FieldDescription>
                        {errors.baseMeasurementUnit && (
                          <FieldError>{errors.baseMeasurementUnit}</FieldError>
                        )}
                      </Field>
                    </div>
                  ) : null}

                  {visibleAssetTypeDefinition.length > 0 ? (
                    <DynamicSpecsForm
                      definition={visibleAssetTypeDefinition}
                      value={formData.specifications}
                      onChange={(specs) => updateField('specifications', specs)}
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
                        offersBaseUnit || visibleAssetTypeDefinition.length > 0
                          ? undefined
                          : 'border-t-0 pt-0'
                      }
                    />
                  ) : null}
                </div>
              </motion.section>
            ) : null}
          </AnimatePresence>

          <FormSection
            title="Regime metrológico"
            description="Enquadramento legal do instrumento e, quando aplicável, a periodicidade de verificação fixada por regulamento."
            className="py-6"
          >
            <MetrologyRegimeFields
              values={formData}
              onChange={(patch) =>
                setFormData((prev) => ({ ...prev, ...patch }))
              }
              disabled={isSaving}
              errors={errors}
              assetTypeSlug={selectedAssetType?.slug}
            />
          </FormSection>

          <Collapsible className="group/details pt-6">
            <CollapsibleTrigger
              className={cn(
                '-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              )}
            >
              <div className="min-w-0 flex-1">
                <h2 className="text-balance text-base font-semibold sm:text-lg">
                  Mais detalhes
                </h2>
                <p className="mt-1 text-pretty text-sm text-muted-foreground">
                  Última calibração, instalação, status e observações.
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                opcional
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-open/details:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
              <div className="grid gap-4 pt-4 md:grid-cols-2">
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
                  <FieldDescription>
                    Usada no histórico e nos alertas de recalibração.
                  </FieldDescription>
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
                  {/* Próxima calibração (periodicidade) é definida pelo cliente
                      no portal, não pelo laboratório (§7.8.4.3 + ILAC-G24).
                      A data de instalação ancora a verificação legal de
                      instrumentos com periodicidade max_months_from_install. */}
                  <FieldDescription>
                    Âncora da verificação legal quando o regulamento conta a
                    partir da instalação.
                  </FieldDescription>
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
                      <SelectItem value="MAINTENANCE">Em Manutenção</SelectItem>
                      <SelectItem value="SCRAPPED">Descartado</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="comments">Observações</FieldLabel>
                  <Textarea
                    id="comments"
                    name="comments"
                    value={formData.comments}
                    onChange={(e) => updateField('comments', e.target.value)}
                    placeholder="Observações adicionais sobre o ativo…"
                    disabled={isSaving}
                    rows={3}
                  />
                </Field>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </Panel>

      <FormFooter
        variant={variant}
        isSaving={isSaving}
        missing={missingRequirements.map((item) => item.label)}
        onCancel={onCancel}
      />
    </form>
  )
}

function FormSection({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={className}>
      <PanelHeader title={title} description={description} />
      <div className="mt-4">{children}</div>
    </section>
  )
}

/**
 * Live readiness line: what is still required, in visual order. A hint, not a
 * gate — the submit button stays enabled and a failed submit lands on the
 * first offending field with an inline error.
 */
function ReadinessSummary({ missing }: { missing: string[] }) {
  if (missing.length === 0) {
    return (
      <p
        aria-live="polite"
        className="flex items-center gap-1.5 px-1 text-xs text-emerald-700 dark:text-emerald-400"
      >
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" />
        Pronto para criar
      </p>
    )
  }
  const shown = missing.slice(0, 3)
  const rest = missing.length - shown.length
  return (
    <p
      aria-live="polite"
      className="truncate px-1 text-xs tabular-nums text-muted-foreground"
    >
      <span className="font-medium text-foreground/80">
        {missing.length === 1
          ? 'Falta 1 campo obrigatório'
          : `Faltam ${missing.length} campos obrigatórios`}
      </span>
      {': '}
      {shown.join(', ')}
      {rest > 0 ? ` +${rest}` : ''}
    </p>
  )
}

function FormFooter({
  variant,
  isSaving,
  missing,
  onCancel,
}: {
  variant: 'page' | 'sheet'
  isSaving: boolean
  missing: string[]
  onCancel: () => void
}) {
  const buttons = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
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
            <HugeiconsIcon icon={FloppyDiskIcon} className="mr-2 size-4" />
            Criar ativo
          </>
        )}
      </Button>
    </>
  )

  if (variant === 'sheet') {
    return (
      <div className="sticky bottom-0 z-10 mt-6 flex flex-col gap-3 border-t border-foreground/10 bg-background/95 pt-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <ReadinessSummary missing={missing} />
        <div className="flex items-center justify-end gap-2">{buttons}</div>
      </div>
    )
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
      <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <ReadinessSummary missing={missing} />
        <div className="flex items-center justify-end gap-2">{buttons}</div>
      </div>
    </div>
  )
}
