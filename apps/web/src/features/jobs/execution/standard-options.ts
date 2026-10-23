import type { MassCompositionProfileDto } from '@calibra-facil/client-runtime'
import { type CertifiedValueOption } from '@/components/method-runtime/table-input-renderer'
import { type MassCompositionOption } from '@/components/method-runtime/mass-composition-utils'
import type { StandardCertifiedValueOption } from '@/components/method-runtime/standard-value-utils'
import { type ReferenceStandard } from './types'

export function buildCertifiedValueOptions({
  standardsData,
  convertValueToDisplayUnit,
  displayUnitFor,
}: {
  standardsData: ReferenceStandard[]
  convertValueToDisplayUnit: (
    value: number,
    unit?: string | null,
  ) => number | unknown
  displayUnitFor: (unit?: string | null) => string | undefined
}): CertifiedValueOption[] {
  const options: CertifiedValueOption[] = []

  for (const standard of standardsData) {
    if (!standard.certifiedValues) continue

    for (const certifiedValue of standard.certifiedValues) {
      if (certifiedValue.compositionProfile) continue
      const displayValue = convertValueToDisplayUnit(
        certifiedValue.value,
        certifiedValue.unit,
      )
      const displayUncertainty = convertValueToDisplayUnit(
        certifiedValue.uncertainty,
        certifiedValue.unit,
      )
      const displayUnit =
        displayUnitFor(certifiedValue.unit) ?? certifiedValue.unit
      options.push({
        label: certifiedValue.nominal,
        value:
          typeof displayValue === 'number'
            ? displayValue
            : certifiedValue.value,
        uncertainty:
          typeof displayUncertainty === 'number'
            ? displayUncertainty
            : certifiedValue.uncertainty,
        unit: displayUnit,
        standardName: standard.name,
      })
    }
  }

  return options
}

/**
 * Discipline-agnostic per-row certified-value options. This is the core of
 * buildMassCompositionOptions WITHOUT the mass-only bits: no composition
 * profiles, no buoyancy, no `isMassMeasurementUnit`/mass-unit gating. Each
 * non-profile certifiedValue of each standard becomes one option carrying
 * { value, uncertainty, coverageFactor (falling back to standard.coverageFactor),
 * drift, unit }, converted to the asset display unit via the same generic
 * helpers. Used to fill `role:"standard_value"` columns for any quantity
 * (force/voltage/frequency/etc.).
 *
 * Kept fully separate from the mass path: buildMassCompositionOptions is left
 * byte-identical.
 */
export function buildStandardCertifiedValueOptions({
  standardsData,
  convertValueToDisplayUnit,
  displayUnitFor,
}: {
  standardsData: ReferenceStandard[]
  convertValueToDisplayUnit: (
    value: number,
    unit?: string | null,
  ) => number | unknown
  displayUnitFor: (unit?: string | null) => string | undefined
}): StandardCertifiedValueOption[] {
  const options: StandardCertifiedValueOption[] = []

  for (const standard of standardsData) {
    if (!standard.certifiedValues?.length) continue

    standard.certifiedValues.forEach((certifiedValue, certifiedValueIndex) => {
      // Composition profiles are a mass-only concept; skip them in the generic
      // path (one option fills one row).
      if (certifiedValue.compositionProfile === true) return

      const coverageFactor =
        certifiedValue.coverageFactor ?? standard.coverageFactor
      const drift = certifiedValue.drift ?? standard.drift
      const displayUnit =
        displayUnitFor(certifiedValue.unit) ?? certifiedValue.unit
      const displayValue = convertValueToDisplayUnit(
        certifiedValue.value,
        certifiedValue.unit,
      )
      const displayUncertainty = convertValueToDisplayUnit(
        certifiedValue.uncertainty,
        certifiedValue.unit,
      )
      const displayDrift =
        drift == null
          ? null
          : convertValueToDisplayUnit(drift, certifiedValue.unit)

      options.push({
        standardId: standard.id,
        standardName: standard.name,
        certificateNumber: standard.certificateNumber,
        certifiedValueIndex,
        nominal: certifiedValue.nominal,
        value:
          typeof displayValue === 'number'
            ? displayValue
            : certifiedValue.value,
        uncertainty:
          typeof displayUncertainty === 'number'
            ? displayUncertainty
            : certifiedValue.uncertainty,
        coverageFactor,
        drift: typeof displayDrift === 'number' ? displayDrift : null,
        unit: displayUnit,
        optionLabel: `${certifiedValue.nominal} - ${standard.name} (${standard.certificateNumber})`,
      })
    })
  }

  return options
}

export function buildMassCompositionOptions({
  standardsData,
  convertValueToDisplayUnit,
  displayUnitFor,
}: {
  standardsData: ReferenceStandard[]
  convertValueToDisplayUnit: (
    value: number,
    unit?: string | null,
  ) => number | unknown
  displayUnitFor: (unit?: string | null) => string | undefined
}): MassCompositionOption[] {
  const individualOptions: MassCompositionOption[] = []
  const profileOptions = new Map<string, MassCompositionOption>()

  for (const standard of standardsData) {
    if (!standard.certifiedValues?.length) continue

    standard.certifiedValues.forEach((certifiedValue, certifiedValueIndex) => {
      const coverageFactor =
        certifiedValue.coverageFactor ?? standard.coverageFactor
      const drift = certifiedValue.drift ?? standard.drift
      const isProfile = certifiedValue.compositionProfile === true
      const profileKey = certifiedValue.profileKey ?? certifiedValue.nominal
      const displayUnit =
        displayUnitFor(certifiedValue.unit) ?? certifiedValue.unit
      const displayValue = convertValueToDisplayUnit(
        certifiedValue.value,
        certifiedValue.unit,
      )
      const displayUncertainty = convertValueToDisplayUnit(
        certifiedValue.uncertainty,
        certifiedValue.unit,
      )
      const displayMaxError =
        certifiedValue.maxError == null
          ? null
          : convertValueToDisplayUnit(
              certifiedValue.maxError,
              certifiedValue.unit,
            )
      const displayDrift =
        drift == null
          ? null
          : convertValueToDisplayUnit(drift, certifiedValue.unit)
      const displayBuoyancy =
        certifiedValue.buoyancy == null
          ? null
          : convertValueToDisplayUnit(
              certifiedValue.buoyancy,
              certifiedValue.unit,
            )

      if (isProfile) {
        const key = `${profileKey}:${displayUnit}`
        const existing = profileOptions.get(key)
        const existingIds = existing?.standardIds ?? []
        const standardIds = Array.from(new Set([...existingIds, standard.id]))

        profileOptions.set(key, {
          standardId: standardIds[0] ?? standard.id,
          standardIds,
          standardName: 'Perfil de composição',
          certificateNumber: 'Rastreabilidade via padrões selecionados',
          certifiedValueIndex,
          nominal: certifiedValue.nominal,
          authentication: certifiedValue.authentication,
          value:
            typeof displayValue === 'number'
              ? displayValue
              : certifiedValue.value,
          uncertainty:
            typeof displayUncertainty === 'number'
              ? displayUncertainty
              : certifiedValue.uncertainty,
          unit: displayUnit,
          coverageFactor,
          maxError:
            typeof displayMaxError === 'number' ? displayMaxError : null,
          drift: typeof displayDrift === 'number' ? displayDrift : null,
          buoyancy:
            typeof displayBuoyancy === 'number' ? displayBuoyancy : null,
          compositionProfile: true,
          profileKey,
          profileClass: certifiedValue.profileClass ?? null,
          profileQuantityAvailable:
            certifiedValue.profileQuantityAvailable ?? null,
          optionLabel: `${profileKey} - perfil de composição`,
        })
        return
      }

      individualOptions.push({
        standardId: standard.id,
        standardName: standard.name,
        certificateNumber: standard.certificateNumber,
        certifiedValueIndex,
        nominal: certifiedValue.nominal,
        authentication: certifiedValue.authentication,
        value:
          typeof displayValue === 'number'
            ? displayValue
            : certifiedValue.value,
        uncertainty:
          typeof displayUncertainty === 'number'
            ? displayUncertainty
            : certifiedValue.uncertainty,
        unit: displayUnit,
        coverageFactor,
        maxError: typeof displayMaxError === 'number' ? displayMaxError : null,
        drift: typeof displayDrift === 'number' ? displayDrift : null,
        buoyancy: typeof displayBuoyancy === 'number' ? displayBuoyancy : null,
        optionLabel: `${certifiedValue.nominal} - ${standard.name} (${standard.certificateNumber})`,
      })
    })
  }

  return [...individualOptions, ...profileOptions.values()]
}

const MASS_PROFILE_CLASS_RE = /\b([EFM][12])\b/i

/** Derive the mass class (M1/M2/F1/…) from a standard's model label. */
export function classOfStandard(standard: {
  model?: string | null
}): string | null {
  const match = standard.model?.match(MASS_PROFILE_CLASS_RE)
  return match ? match[1].toUpperCase() : null
}

/**
 * Reconstitute the composition-profile buildup entries onto each standard's
 * certifiedValues from the normalized mass_composition_profile catalog (profiles
 * no longer live in certified_values). Each standard receives the catalog
 * profiles of its own class, in the legacy CertifiedValue shape — so
 * buildMassCompositionOptions and its standardIds aggregation stay byte-identical
 * to the pre-normalization behavior.
 */
export function attachCompositionProfiles(
  standards: ReferenceStandard[],
  profiles: MassCompositionProfileDto[],
): ReferenceStandard[] {
  if (!profiles.length) return standards
  const byClass = new Map<
    string,
    NonNullable<ReferenceStandard['certifiedValues']>
  >()
  for (const profile of profiles) {
    const list = byClass.get(profile.profileClass) ?? []
    list.push({
      nominal: profile.nominal,
      value: profile.value,
      uncertainty: profile.uncertainty,
      unit: profile.unit,
      maxError: profile.maxError,
      drift: profile.drift,
      buoyancy: profile.buoyancy,
      coverageFactor: profile.coverageFactor,
      compositionProfile: true,
      profileKey: profile.profileKey,
      profileClass: profile.profileClass,
      profileQuantityAvailable: profile.quantityAvailable,
    })
    byClass.set(profile.profileClass, list)
  }
  return standards.map((standard) => {
    const cls = classOfStandard(standard)
    const classProfiles = cls ? byClass.get(cls) : undefined
    if (!classProfiles?.length) return standard
    const real = (standard.certifiedValues ?? []).filter(
      (value) => value.compositionProfile !== true,
    )
    return { ...standard, certifiedValues: [...real, ...classProfiles] }
  })
}
