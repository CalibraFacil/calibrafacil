/**
 * UI-to-payload parsing for the "delete organization" dialog — the
 * schema-first `forms.ts` layer of this regulated action (records retention,
 * decision Q16). The payload is validated against `SoftDeleteOrganizationSchema`
 * (the same schema the API enforces) before it leaves the client.
 */
import {
  SOFT_DELETE_REASON_MIN_LENGTH,
  SoftDeleteOrganizationSchema,
  confirmationMatchesOrganizationName,
  type SoftDeleteOrganizationInput,
} from '@calibra-facil/schemas'

export type SoftDeleteOrganizationFormResult =
  | { ok: true; value: SoftDeleteOrganizationInput }
  | { ok: false; error: string }

export const CONFIRMATION_MISMATCH_MESSAGE =
  'O nome digitado não confere com o nome da organização'

export function parseSoftDeleteOrganizationForm(input: {
  organizationName: string
  confirmName: string
  reason: string
}): SoftDeleteOrganizationFormResult {
  if (
    !confirmationMatchesOrganizationName(
      input.confirmName,
      input.organizationName,
    )
  ) {
    return { ok: false, error: CONFIRMATION_MISMATCH_MESSAGE }
  }

  const parsed = SoftDeleteOrganizationSchema.safeParse({
    confirmName: input.confirmName,
    reason: input.reason,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: `Informe o motivo da exclusão (mínimo de ${SOFT_DELETE_REASON_MIN_LENGTH} caracteres)`,
    }
  }
  return { ok: true, value: parsed.data }
}
