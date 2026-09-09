import {
  SelfServeSignupSchema,
  type SelfServeSignupInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type SignUpFormData = {
  name: string
  email: string
  labName: string
  cnpj: string
  phone: string
}

export type SignUpFormField = keyof SignUpFormData

export const emptySignUpForm: SignUpFormData = {
  name: '',
  email: '',
  labName: '',
  cnpj: '',
  phone: '',
}

/**
 * Pure parse of the self-serve sign-up form. The corporate-domain rule and the
 * CNPJ check live in the shared schema, so the browser refuses exactly what the
 * API refuses, with the same wording — no second, drifting copy of the policy.
 */
export function parseSignUpForm(
  data: SignUpFormData,
  extras: {
    planId: SelfServeSignupInput['planId']
    billingCycle: SelfServeSignupInput['billingCycle']
    website: string
  },
): FeatureFormValidationResult<SelfServeSignupInput, SignUpFormField> {
  const parsed = SelfServeSignupSchema.safeParse({
    name: data.name,
    email: data.email,
    labName: data.labName,
    cnpj: data.cnpj,
    phone: data.phone,
    planId: extras.planId,
    billingCycle: extras.billingCycle,
    website: extras.website,
  })

  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      'name',
      'email',
      'labName',
      'cnpj',
      'phone',
    ])
  }

  return { success: true, data: parsed.data }
}
