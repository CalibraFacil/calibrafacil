/**
 * UI-to-payload parsing for the "emitir sem assinatura digital" unit setting
 * (Q51): the reason typed by the admin is validated against
 * `UnsignedIssuanceSettingSchema` before it leaves the client, so the regulated
 * workflow never depends on a JSX handler.
 */
import {
  UNSIGNED_ISSUANCE_REASON_MIN_LENGTH,
  UnsignedIssuanceSettingSchema,
} from '@calibra-facil/schemas'

export { UNSIGNED_ISSUANCE_REASON_MIN_LENGTH }

export type UnsignedIssuanceFormResult =
  | { ok: true; payload: { enabled: true; reason: string } }
  | { ok: false; error: string }

export function buildUnsignedIssuancePayload(
  reason: string,
): UnsignedIssuanceFormResult {
  const parsed = UnsignedIssuanceSettingSchema.safeParse({
    enabled: true,
    reason,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        'Informe a justificativa para emitir sem assinatura digital',
    }
  }
  if (!parsed.data.enabled) {
    return { ok: false, error: 'Informe a justificativa' }
  }
  return {
    ok: true,
    payload: { enabled: true, reason: parsed.data.reason },
  }
}
