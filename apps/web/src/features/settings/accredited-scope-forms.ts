/**
 * UI-to-payload parsing for the accredited-scope (CMC) settings — the
 * schema-first `forms.ts` layer for this regulated workflow (#427): every
 * coercion the dialog needs lives here, testable, with the final payload
 * validated against `AccreditedScopeLineSchema` before it leaves the client.
 */
import { format } from 'date-fns'
import { AccreditedScopeLineSchema } from '@calibra-facil/schemas'
import type {
  AccreditedScopeLine,
  SaveAccreditedScopeLineInput,
} from '@calibra-facil/client-runtime'
import { QUANTITY_KIND_OPTIONS_PT, type QuantityKind } from '@calibra-facil/shared'
import { dateInputToIso } from '@/features/settings/organization-model'

export interface ScopeLineFormState {
  quantityKind: QuantityKind
  rangeMin: string
  rangeMax: string
  rangeUnit: string
  cmcType: 'fixed' | 'linear'
  cmcA: string
  cmcB: string
  cmcUnit: string
  description: string
  validFrom: Date | undefined
  validUntil: Date | undefined
}

export const emptyScopeLineForm: ScopeLineFormState = {
  quantityKind: 'mass',
  rangeMin: '',
  rangeMax: '',
  rangeUnit: 'g',
  cmcType: 'fixed',
  cmcA: '',
  cmcB: '',
  cmcUnit: 'g',
  description: '',
  validFrom: undefined,
  validUntil: undefined,
}

/** Numeric parse tolerating pt-BR comma decimals; null for anything else. */
function numberFromForm(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function toDateOrUndefined(
  value: string | Date | null,
): Date | undefined {
  if (value == null) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function canSaveScopeLine(form: ScopeLineFormState): boolean {
  return (
    numberFromForm(form.rangeMin) !== null &&
    numberFromForm(form.rangeMax) !== null &&
    numberFromForm(form.cmcA) !== null &&
    (form.cmcType === 'fixed' || numberFromForm(form.cmcB) !== null)
  )
}

export type ScopeLinePayloadResult =
  | { ok: true; payload: SaveAccreditedScopeLineInput }
  | { ok: false; error: string }

/**
 * Parse the dialog state into the save payload. Vigência bounds anchor like
 * the org-level window (#647): validFrom at start-of-day, validUntil at
 * END-of-day so the stated last day stays inside the window. The result is
 * validated against `AccreditedScopeLineSchema`, so a payload the server
 * would reject never leaves the client silently.
 */
export function buildScopeLinePayload(
  form: ScopeLineFormState,
  editingId: number | null,
): ScopeLinePayloadResult {
  const rangeMin = numberFromForm(form.rangeMin)
  const rangeMax = numberFromForm(form.rangeMax)
  const cmcA = numberFromForm(form.cmcA)
  const cmcB = form.cmcType === 'linear' ? numberFromForm(form.cmcB) : null
  if (
    rangeMin === null ||
    rangeMax === null ||
    cmcA === null ||
    (form.cmcType === 'linear' && cmcB === null)
  ) {
    return { ok: false, error: 'Preencha faixa e CMC com valores numéricos' }
  }

  const candidate = {
    id: editingId ?? undefined,
    quantityKind: form.quantityKind,
    rangeMin,
    rangeMax,
    rangeUnit: form.rangeUnit,
    cmcType: form.cmcType,
    cmcA,
    cmcB,
    cmcUnit: form.cmcUnit,
    description: form.description.trim() || null,
    validFrom: form.validFrom
      ? dateInputToIso(format(form.validFrom, 'yyyy-MM-dd'), 'start') || null
      : null,
    validUntil: form.validUntil
      ? dateInputToIso(format(form.validUntil, 'yyyy-MM-dd'), 'end') || null
      : null,
  }

  const parsed = AccreditedScopeLineSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? 'Dados inválidos na linha de escopo',
    }
  }
  return { ok: true, payload: parsed.data }
}

export function scopeLineToFormState(
  line: AccreditedScopeLine,
): ScopeLineFormState {
  const kind =
    QUANTITY_KIND_OPTIONS_PT.find(
      (option) => option.value === line.quantityKind,
    )?.value ?? 'mass'
  return {
    quantityKind: kind,
    rangeMin: String(line.rangeMin),
    rangeMax: String(line.rangeMax),
    rangeUnit: line.rangeUnit,
    cmcType: line.cmcType,
    cmcA: String(line.cmcA),
    cmcB: line.cmcB != null ? String(line.cmcB) : '',
    cmcUnit: line.cmcUnit,
    description: line.description ?? '',
    validFrom: toDateOrUndefined(line.validFrom),
    validUntil: toDateOrUndefined(line.validUntil),
  }
}

export function formatCmcExpression(line: AccreditedScopeLine): string {
  if (line.cmcType === 'linear') {
    return `${line.cmcA} ${line.cmcUnit} + ${line.cmcB ?? 0}·x`
  }
  return `${line.cmcA} ${line.cmcUnit}`
}

export function formatVigencia(line: AccreditedScopeLine): string | null {
  const from = toDateOrUndefined(line.validFrom)
  const until = toDateOrUndefined(line.validUntil)
  if (!from && !until) return null
  const fmt = (d: Date) => d.toLocaleDateString('pt-BR')
  if (from && until) return `${fmt(from)} a ${fmt(until)}`
  if (from) return `a partir de ${fmt(from)}`
  return until ? `até ${fmt(until)}` : null
}
