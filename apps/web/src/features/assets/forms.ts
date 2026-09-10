import {
  AssetStatusSchema,
  CreateAssetSchema,
  RegulatedIntervalSchema,
  UpdateAssetSchema,
  type AssetStatus,
  type CreateAssetInput,
  type MeasurementUnit,
  type MetrologyRegime,
  type RegulatedInterval,
  type UpdateAssetInput,
} from '@calibra-facil/schemas'
import {
  dominantKindForAssetType,
  MEASUREMENT_UNITS,
  unitsForKind,
  type SpecificationFieldLike,
} from '@calibra-facil/shared/units'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

/**
 * Unit options for the asset's base-unit picker, narrowed to the dominant
 * quantity kind of the selected asset type's field definition (e.g. a balance
 * → mg/g/kg, a paquímetro → length units). Falls back to every registry unit
 * when no field carries a recognizable unit.
 */
export function baseMeasurementUnitOptions(
  definition: SpecificationFieldLike[] | null | undefined,
): readonly MeasurementUnit[] {
  const kind = dominantKindForAssetType(definition)
  return kind ? unitsForKind(kind) : MEASUREMENT_UNITS
}

export const ASSET_FORM_STATUSES = AssetStatusSchema.options

// NOTE: the lab no longer authors a calibration periodicity / next-calibration
// date. Periodicity is the equipment owner's (customer's) decision, set in the
// client portal (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24 / OIML D 10). The old
// `buildCalibrationPeriodicityPresets` quick-select was removed for that reason.

export type AssetFormData = {
  customerId: number | null
  assetTypeId: number | null
  name: string
  manufacturer: string
  model: string
  serialNumber: string
  tag: string
  status: AssetStatus
  baseMeasurementUnit: MeasurementUnit | null
  lastCalibrationDate: Date | undefined
  // Installation/commissioning date. Anchors the legal-metrology verification
  // ceiling for regulated_interval.kind = 'max_months_from_install'.
  installedAt: Date | undefined
  comments: string
  // Legal-metrology regime (Track 2) — set by the lab. WHEN 'LEGAL', the flat regulated-*
  // fields are assembled into a RegulatedInterval (the verification periodicity fixed by
  // regulation). The customer-owned calibration interval is never authored here.
  metrologyRegime: MetrologyRegime
  regulatedKind: RegulatedInterval['kind']
  regulatedValueMonths: string
  regulatedAnchor: string
  regulationReference: string
  regulatedOperationalizedByDelegate: boolean
  regulatedTechnology: string
  regulatedNote: string
  specifications: Record<string, unknown>
}

export type AssetEditFormData = Omit<
  AssetFormData,
  'customerId' | 'assetTypeId' | 'baseMeasurementUnit'
>

export type AssetFormField = keyof AssetFormData | `spec_${string}`
export type AssetEditFormField = keyof AssetEditFormData | `spec_${string}`

export const METROLOGY_REGIMES = [
  'INDUSTRIAL',
  'LEGAL',
  'UNKNOWN',
] as const satisfies readonly MetrologyRegime[]

export const REGULATED_INTERVAL_KINDS = [
  'fixed_months',
  'max_months_from_install',
  'per_technology',
  'not_nationally_fixed',
] as const satisfies readonly RegulatedInterval['kind'][]

export const DEFAULT_REGULATED_FORM_FIELDS = {
  regulatedKind: 'fixed_months',
  regulatedValueMonths: '',
  regulatedAnchor: 'last_verification',
  regulationReference: '',
  regulatedOperationalizedByDelegate: false,
  regulatedTechnology: '',
  regulatedNote: '',
} satisfies Pick<
  AssetFormData,
  | 'regulatedKind'
  | 'regulatedValueMonths'
  | 'regulatedAnchor'
  | 'regulationReference'
  | 'regulatedOperationalizedByDelegate'
  | 'regulatedTechnology'
  | 'regulatedNote'
>

export type MetrologyRegimeFormValues = Pick<
  AssetFormData,
  | 'metrologyRegime'
  | 'regulatedKind'
  | 'regulatedValueMonths'
  | 'regulatedAnchor'
  | 'regulationReference'
  | 'regulatedOperationalizedByDelegate'
  | 'regulatedTechnology'
  | 'regulatedNote'
>

export const METROLOGY_REGIME_LABELS: Record<MetrologyRegime, string> = {
  INDUSTRIAL: 'Industrial (fora da metrologia legal)',
  LEGAL: 'Metrologia legal (Inmetro)',
  UNKNOWN: 'A determinar',
}

export const REGULATED_KIND_LABELS: Record<RegulatedInterval['kind'], string> =
  {
    fixed_months: 'Período fixo (meses)',
    max_months_from_install: 'Limite a partir da instalação',
    per_technology: 'Por tecnologia',
    not_nationally_fixed: 'Sem periodicidade nacional fixa',
  }

export const REGULATED_ANCHOR_LABELS: Record<string, string> = {
  last_verification: 'Última verificação',
  calendar_year: 'Ano-calendário (até o fim do ano seguinte)',
  first_verification: 'Primeira verificação',
  install_year: 'Ano de instalação',
}

/** Short regime labels for the segmented picker; the long form stays as the description. */
export const METROLOGY_REGIME_SHORT_LABELS: Record<MetrologyRegime, string> = {
  INDUSTRIAL: 'Industrial',
  LEGAL: 'Metrologia legal',
  UNKNOWN: 'A determinar',
}

export function isMetrologyRegime(value: string): value is MetrologyRegime {
  return METROLOGY_REGIMES.some((regime) => regime === value)
}

export function isRegulatedKind(
  value: string,
): value is RegulatedInterval['kind'] {
  return REGULATED_INTERVAL_KINDS.some((kind) => kind === value)
}

// =============================================================================
// LEGAL-METROLOGY REGULATION CATALOG — auto-fill (deferred #3 of #423)
// =============================================================================

/**
 * A row of the GLOBAL legal-metrology regulation catalog (Portaria → default regulated-
 * interval shape), fetched from `/api/legal-metrology-regulations`. Selecting one pre-fills
 * the editable regime fields — a default the lab can still override (suggestion-only).
 * Spec: `specs/legal-metrology-catalog/spec.md`.
 */
export type LegalMetrologyRegulationCatalogEntry = {
  id: number
  category: string
  kind: RegulatedInterval['kind']
  valueMonths: number | null
  byTechnology: Record<string, number> | null
  anchor: string | null
  operationalizedByDelegate: boolean
  regulationReference: string
  provenance: 'primary' | 'secondary'
  note: string | null
}

/**
 * Caveat shown next to a SECONDARY catalog entry's auto-filled reference — its exact DOU
 * article still needs operator re-confirmation before it backs a compliance certificate
 * (REQ-CATALOG-005).
 */
export const REGULATION_CATALOG_SECONDARY_CAVEAT = '(verificar artigo no DOU)'

/** REQ-CATALOG-005: a catalog entry whose provenance is `secondary` triggers the caveat. */
export function isSecondaryRegulationProvenance(entry: {
  provenance: 'primary' | 'secondary'
}): boolean {
  return entry.provenance === 'secondary'
}

/**
 * REQ-CATALOG-004: derive the regime-field patch from a selected catalog entry. Populates
 * `regulatedKind`, the scalar `valueMonths` (where the kind carries one), `anchor`,
 * `regulationReference`, and `operationalizedByDelegate`. For `per_technology` the catalog
 * binds a per-technology MAP (not one period), so the technology + months are cleared for
 * the lab to pick from `byTechnology` (see `regulationTechnologyPatch`). The lab can still
 * override ANY field afterward — the patch is merged into the form, never locked.
 */
export function regulationCatalogToRegimePatch(
  entry: LegalMetrologyRegulationCatalogEntry,
): Partial<MetrologyRegimeFormValues> {
  const patch: Partial<MetrologyRegimeFormValues> = {
    metrologyRegime: 'LEGAL',
    regulatedKind: entry.kind,
    regulationReference: entry.regulationReference,
    regulatedOperationalizedByDelegate: entry.operationalizedByDelegate,
  }
  if (entry.anchor !== null) {
    patch.regulatedAnchor = entry.anchor
  }
  if (
    entry.kind === 'fixed_months' ||
    entry.kind === 'max_months_from_install'
  ) {
    patch.regulatedValueMonths =
      entry.valueMonths !== null ? String(entry.valueMonths) : ''
  }
  if (entry.kind === 'per_technology') {
    // The lab must pick which technology applies to THIS instrument; reset both so a
    // stale value from a previously-selected entry never leaks.
    patch.regulatedTechnology = ''
    patch.regulatedValueMonths = ''
  }
  if (entry.kind === 'not_nationally_fixed' && entry.note !== null) {
    patch.regulatedNote = entry.note
  }
  return patch
}

/**
 * REQ-CATALOG-004 (per_technology): once the lab picks a technology from a `per_technology`
 * entry's `byTechnology` map, fill the technology + its regulated months.
 */
export function regulationTechnologyPatch(
  entry: LegalMetrologyRegulationCatalogEntry,
  technology: string,
): Partial<MetrologyRegimeFormValues> {
  const months = entry.byTechnology?.[technology]
  return {
    regulatedTechnology: technology,
    regulatedValueMonths: months !== undefined ? String(months) : '',
  }
}

type RegulatedFormFieldKey =
  | 'regulationReference'
  | 'regulatedValueMonths'
  | 'regulatedTechnology'
  | 'regulatedAnchor'

/**
 * Assemble the structured RegulatedInterval (Track 2) from the flat lab-form fields, or
 * null when the regime is not LEGAL. The result is validated by RegulatedIntervalSchema in
 * the parse step (so an empty reference / non-integer months surfaces as a field error).
 * Spec: REQ-MLR-062/063.
 */
export function buildRegulatedIntervalFromForm(
  data: MetrologyRegimeFormValues,
): RegulatedInterval | null {
  if (data.metrologyRegime !== 'LEGAL') return null
  const regulationReference = data.regulationReference.trim()
  const operationalizedByDelegate = data.regulatedOperationalizedByDelegate
  const valueMonths = Number(data.regulatedValueMonths)
  switch (data.regulatedKind) {
    case 'fixed_months':
      return {
        kind: 'fixed_months',
        valueMonths,
        anchor:
          data.regulatedAnchor === 'calendar_year'
            ? 'calendar_year'
            : 'last_verification',
        regulationReference,
        operationalizedByDelegate,
      }
    case 'max_months_from_install':
      return {
        kind: 'max_months_from_install',
        valueMonths,
        anchor: 'install_year',
        regulationReference,
        operationalizedByDelegate,
      }
    case 'per_technology':
      return {
        kind: 'per_technology',
        valueMonths,
        anchor:
          data.regulatedAnchor === 'first_verification'
            ? 'first_verification'
            : 'last_verification',
        technology: data.regulatedTechnology.trim(),
        regulationReference,
        operationalizedByDelegate,
      }
    case 'not_nationally_fixed':
      return {
        kind: 'not_nationally_fixed',
        regulationReference,
        operationalizedByDelegate,
        ...(data.regulatedNote.trim()
          ? { note: data.regulatedNote.trim() }
          : {}),
      }
  }
}

function regulatedFieldFor(
  path: PropertyKey | undefined,
): RegulatedFormFieldKey {
  switch (path) {
    case 'valueMonths':
      return 'regulatedValueMonths'
    case 'technology':
      return 'regulatedTechnology'
    case 'anchor':
      return 'regulatedAnchor'
    default:
      return 'regulationReference'
  }
}

/**
 * Reverse of buildRegulatedIntervalFromForm: derive the flat lab-form fields from a stored
 * asset's regime + regulated interval, to pre-fill the edit form.
 */
export function regulatedFormFieldsFromAsset(asset: {
  metrologyRegime?: 'INDUSTRIAL' | 'LEGAL' | 'UNKNOWN'
  regulatedInterval?: {
    kind: RegulatedInterval['kind']
    valueMonths?: number
    anchor?: string
    technology?: string
    regulationReference: string
    operationalizedByDelegate: boolean
    note?: string
  } | null
}): MetrologyRegimeFormValues {
  const metrologyRegime: MetrologyRegime = asset.metrologyRegime ?? 'INDUSTRIAL'
  const r = asset.regulatedInterval
  if (!r) {
    return { metrologyRegime, ...DEFAULT_REGULATED_FORM_FIELDS }
  }
  return {
    metrologyRegime,
    regulatedKind: r.kind,
    regulatedValueMonths: r.valueMonths != null ? String(r.valueMonths) : '',
    regulatedAnchor: r.anchor ?? 'last_verification',
    regulationReference: r.regulationReference,
    regulatedOperationalizedByDelegate: r.operationalizedByDelegate,
    regulatedTechnology: r.technology ?? '',
    regulatedNote: r.note ?? '',
  }
}

export type AssetSpecificationField = {
  key: string
  label: string
  type?: string
  required?: boolean
}

export type ParseAssetFormOptions = {
  requiresMassBaseUnit?: boolean
  specificationFields?: readonly AssetSpecificationField[]
}

export function isAssetFormStatus(value: unknown): value is AssetStatus {
  return (
    typeof value === 'string' &&
    ASSET_FORM_STATUSES.some((status) => status === value)
  )
}

export function isAssetSpecificationErrorField(
  field: string,
): field is `spec_${string}` {
  return field.startsWith('spec_')
}

export type AssetFormMissingRequirement = {
  field: AssetFormField
  label: string
}

/**
 * Live readiness for the create form: which REQUIRED inputs are still empty,
 * in visual order. Drives the footer summary ("Faltam: tipo, nome…") without
 * running the full parse on every keystroke. Mirrors the required rules in
 * `parseAssetForm` (customer, type, name, tag, serial, mass base unit and the
 * asset type's required specifications) — keep the two in sync.
 */
export function listMissingAssetRequirements(
  data: Pick<
    AssetFormData,
    | 'customerId'
    | 'assetTypeId'
    | 'name'
    | 'tag'
    | 'serialNumber'
    | 'baseMeasurementUnit'
    | 'specifications'
  >,
  options: ParseAssetFormOptions = {},
): AssetFormMissingRequirement[] {
  const missing: AssetFormMissingRequirement[] = []
  if (!(typeof data.assetTypeId === 'number' && data.assetTypeId > 0)) {
    missing.push({ field: 'assetTypeId', label: 'Tipo de instrumento' })
  }
  if (!(typeof data.customerId === 'number' && data.customerId > 0)) {
    missing.push({ field: 'customerId', label: 'Cliente' })
  }
  if (!data.name.trim()) missing.push({ field: 'name', label: 'Nome' })
  if (!data.tag.trim()) missing.push({ field: 'tag', label: 'Tag' })
  if (!data.serialNumber.trim()) {
    missing.push({ field: 'serialNumber', label: 'Número de série' })
  }
  if (options.requiresMassBaseUnit && !data.baseMeasurementUnit) {
    missing.push({ field: 'baseMeasurementUnit', label: 'Unidade base' })
  }
  for (const error of collectSpecificationErrors(
    data.specifications,
    options.specificationFields,
  )) {
    const field = options.specificationFields?.find(
      (candidate) => `spec_${candidate.key}` === error.field,
    )
    missing.push({ field: error.field, label: field?.label ?? error.field })
  }
  return missing
}

export function parseAssetForm(
  data: AssetFormData,
  options: ParseAssetFormOptions = {},
): FeatureFormValidationResult<CreateAssetInput, AssetFormField> {
  const fieldErrors: Array<{ field: AssetFormField; message: string }> = []

  const hasCustomerId =
    typeof data.customerId === 'number' && data.customerId > 0
  const hasAssetTypeId =
    typeof data.assetTypeId === 'number' && data.assetTypeId > 0
  const name = data.name.trim()
  const manufacturer = optionalText(data.manufacturer)
  const model = optionalText(data.model)
  const lastCalibrationDate = data.lastCalibrationDate?.toISOString()
  const installedAt = data.installedAt?.toISOString()
  const comments = optionalText(data.comments)
  const specifications =
    Object.keys(data.specifications).length > 0
      ? data.specifications
      : undefined

  if (!hasCustomerId) {
    fieldErrors.push({
      field: 'customerId',
      message: 'Cliente é obrigatório',
    })
  }

  if (!hasAssetTypeId) {
    fieldErrors.push({
      field: 'assetTypeId',
      message: 'Tipo de instrumento é obrigatório',
    })
  }

  if (!name) {
    fieldErrors.push({
      field: 'name',
      message: 'Nome é obrigatório',
    })
  }

  const regulatedInterval = buildRegulatedIntervalFromForm(data)
  if (data.metrologyRegime === 'LEGAL') {
    const regCheck = RegulatedIntervalSchema.safeParse(regulatedInterval)
    if (!regCheck.success) {
      for (const issue of regCheck.error.issues) {
        fieldErrors.push({
          field: regulatedFieldFor(issue.path[0]),
          message: issue.message,
        })
      }
    }
  }

  const parsed = CreateAssetSchema.safeParse({
    customerId: hasCustomerId ? data.customerId : 1,
    assetTypeId: hasAssetTypeId ? data.assetTypeId : 1,
    name: name || 'Ativo',
    serialNumber: data.serialNumber.trim(),
    tag: data.tag.trim(),
    status: data.status,
    baseMeasurementUnit: data.baseMeasurementUnit,
    metrologyRegime: data.metrologyRegime,
    ...(regulatedInterval ? { regulatedInterval } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
    ...(lastCalibrationDate ? { lastCalibrationDate } : {}),
    ...(installedAt ? { installedAt } : {}),
    ...(comments ? { comments } : {}),
    ...(specifications ? { specifications } : {}),
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'customerId',
      'assetTypeId',
      'name',
      'manufacturer',
      'model',
      'serialNumber',
      'tag',
      'status',
      'baseMeasurementUnit',
      'lastCalibrationDate',
      'installedAt',
      'comments',
      'specifications',
    ])
    if (!schemaErrors.success) {
      fieldErrors.push(...schemaErrors.fieldErrors)
    }
  }

  if (options.requiresMassBaseUnit && !data.baseMeasurementUnit) {
    fieldErrors.push({
      field: 'baseMeasurementUnit',
      message: 'Selecione a unidade base do instrumento',
    })
  }

  fieldErrors.push(
    ...collectSpecificationErrors(
      data.specifications,
      options.specificationFields,
    ),
  )

  if (fieldErrors.length > 0) {
    return {
      success: false,
      message: fieldErrors[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  return { success: true, data: parsed.data }
}

export function parseAssetEditForm(
  data: AssetEditFormData,
  options: ParseAssetFormOptions = {},
): FeatureFormValidationResult<UpdateAssetInput, AssetEditFormField> {
  const fieldErrors: Array<{ field: AssetEditFormField; message: string }> = []
  const name = data.name.trim()
  const manufacturer = optionalText(data.manufacturer)
  const model = optionalText(data.model)
  const lastCalibrationDate = data.lastCalibrationDate?.toISOString()
  const installedAt = data.installedAt?.toISOString()
  const comments = optionalText(data.comments)
  const specifications =
    Object.keys(data.specifications).length > 0
      ? data.specifications
      : undefined

  if (!name) {
    fieldErrors.push({
      field: 'name',
      message: 'Nome é obrigatório',
    })
  }

  const regulatedInterval = buildRegulatedIntervalFromForm(data)
  if (data.metrologyRegime === 'LEGAL') {
    const regCheck = RegulatedIntervalSchema.safeParse(regulatedInterval)
    if (!regCheck.success) {
      for (const issue of regCheck.error.issues) {
        fieldErrors.push({
          field: regulatedFieldFor(issue.path[0]),
          message: issue.message,
        })
      }
    }
  }

  const parsed = UpdateAssetSchema.safeParse({
    name: name || 'Ativo',
    serialNumber: data.serialNumber.trim(),
    tag: data.tag.trim(),
    status: data.status,
    metrologyRegime: data.metrologyRegime,
    ...(regulatedInterval ? { regulatedInterval } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
    ...(lastCalibrationDate ? { lastCalibrationDate } : {}),
    ...(installedAt ? { installedAt } : {}),
    ...(comments ? { comments } : {}),
    ...(specifications ? { specifications } : {}),
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'name',
      'manufacturer',
      'model',
      'serialNumber',
      'tag',
      'status',
      'lastCalibrationDate',
      'installedAt',
      'comments',
      'specifications',
    ])
    if (!schemaErrors.success) {
      fieldErrors.push(...schemaErrors.fieldErrors)
    }
  }

  fieldErrors.push(
    ...collectSpecificationErrors(
      data.specifications,
      options.specificationFields,
    ),
  )

  if (fieldErrors.length > 0) {
    return {
      success: false,
      message: fieldErrors[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  return { success: true, data: parsed.data }
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function isMissingSpecificationValue(
  value: unknown,
  field: AssetSpecificationField,
) {
  if (value === undefined || value === null || value === '') {
    return true
  }

  return (
    field.type === 'weighing_ranges' &&
    (!Array.isArray(value) || value.length === 0)
  )
}

function collectSpecificationErrors(
  specifications: Record<string, unknown>,
  fields: readonly AssetSpecificationField[] | undefined,
): Array<{ field: `spec_${string}`; message: string }> {
  const fieldErrors: Array<{ field: `spec_${string}`; message: string }> = []

  for (const field of fields ?? []) {
    if (!field.required) {
      continue
    }

    if (isMissingSpecificationValue(specifications[field.key], field)) {
      fieldErrors.push({
        field: `spec_${field.key}`,
        message: `${field.label} é obrigatório`,
      })
    }
  }

  return fieldErrors
}
