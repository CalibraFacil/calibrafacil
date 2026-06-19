import { z } from 'zod'

import type { MethodSpec } from './components/method-spec-preview'

/**
 * Narrows the opaque catalog `spec` (`MethodTemplateCatalogEntry.spec`, served as
 * `unknown[]` from the API to keep `client-runtime` free of server-side method
 * types — see the DTO comment in `client-runtime/src/types.ts`) into the typed
 * `MethodSpec` the read-only spec preview renders. This is the "web layer narrows
 * them" step the DTO defers to: a zod parse, NOT an `as` cast.
 *
 * The shape mirrors only what `MethodSpecPreview` reads; field types are widened
 * (e.g. `type`/`operator`/`distribution` as `string`) and extra keys are stripped,
 * so it parses any compatible spec robustly.
 */
const nullableString = z.string().nullish()

const templateSpecSchema = z.object({
  dataFields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.string(),
        unit: nullableString,
        required: z.boolean().nullish(),
      }),
    )
    .default([]),
  formulas: z
    .array(
      z.object({
        outputKey: z.string(),
        label: nullableString,
        expression: z.string(),
        unit: nullableString,
        reporting: z.object({ role: nullableString }).nullish(),
      }),
    )
    .default([]),
  measurementModels: z
    .array(
      z.object({
        key: nullableString,
        label: nullableString,
        measurand: nullableString,
        expression: nullableString,
        outputUnit: nullableString,
      }),
    )
    .default([]),
  validations: z
    .array(
      z.object({
        leftExpression: z.string(),
        operator: z.string(),
        rightExpression: z.string(),
        severity: z.string(),
        message: nullableString,
      }),
    )
    .default([]),
  uncertaintyParams: z
    .array(
      z.object({
        name: z.string(),
        value: z.union([z.number(), z.string()]),
        distribution: z.string(),
        degreesOfFreedom: z.number().nullish(),
      }),
    )
    .default([]),
  certificateContent: z
    .object({
      procedureCode: nullableString,
      referenceStandards: z.array(z.string()).nullish(),
      sections: z.array(z.unknown()).nullish(),
    })
    .nullish(),
})

const EMPTY_SPEC: MethodSpec = {
  dataFields: [],
  formulas: [],
  measurementModels: [],
  validations: [],
  uncertaintyParams: [],
  certificateContent: null,
}

/**
 * Parse a catalog entry's `spec` into a typed `MethodSpec`. Defensive: a malformed
 * spec degrades to empty blocks rather than crashing the adoption wizard.
 */
export function parseTemplateSpec(spec: unknown): MethodSpec {
  const parsed = templateSpecSchema.safeParse(spec)
  return parsed.success ? parsed.data : EMPTY_SPEC
}

/** pt-BR labels for the catalog's discipline grouping headers. */
const DISCIPLINE_LABELS: Record<string, string> = {
  mass: 'Massa',
  force: 'Força',
  torque: 'Torque',
  voltage: 'Tensão (DC)',
  current: 'Corrente',
  resistance: 'Resistência',
  frequency: 'Frequência / RPM',
  volume: 'Volume',
  humidity: 'Umidade',
  temperature: 'Temperatura',
  pressure: 'Pressão',
}

export function disciplineLabel(discipline: string): string {
  return (
    DISCIPLINE_LABELS[discipline] ??
    discipline.charAt(0).toUpperCase() + discipline.slice(1)
  )
}

/**
 * Compact source sigla for chips/lines — e.g. "EURAMET cg-18" + "v4.0" → "cg-18
 * v4.0"; "UKAS LAB 14" → "LAB 14"; "EA-4/02" + "M:2022" → "EA-4/02". Derived from
 * the (already canonical, post-PR-A) `title`, so no `as`.
 */
export function shortSourceSigla(source: {
  title: string
  edition: string
}): string {
  const base = source.title.replace(/^(EURAMET|UKAS)\s+/i, '')
  return /^v\d/i.test(source.edition) ? `${base} ${source.edition}` : base
}
