import { z } from 'zod'

import {
  type FeatureFormValidationResult,
  zodFormError,
} from '@/shared/forms/validation'

export const PASSKEY_NAME_MAX_LENGTH = 64

type PasskeyNameField = 'name'
const PASSKEY_NAME_FIELDS: readonly PasskeyNameField[] = ['name']

export const passkeyNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe um nome para a passkey')
    .max(
      PASSKEY_NAME_MAX_LENGTH,
      `Use no máximo ${PASSKEY_NAME_MAX_LENGTH} caracteres`,
    ),
})

export interface PasskeyNamePayload {
  name: string
}

export function parsePasskeyNameForm(input: {
  name: string
}): FeatureFormValidationResult<PasskeyNamePayload, PasskeyNameField> {
  const parsed = passkeyNameSchema.safeParse(input)
  if (!parsed.success) {
    return zodFormError(parsed.error.issues, PASSKEY_NAME_FIELDS)
  }
  return { success: true, data: parsed.data }
}

const PASSKEY_DEFAULT_NAME_DATE = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
})

// Default label applied when a user creates a passkey without naming it (the
// one-click banner / "Adicionar passkey" button). Editable later in Settings.
export function defaultPasskeyName(now: Date): string {
  return `Passkey • ${PASSKEY_DEFAULT_NAME_DATE.format(now)}`
}
