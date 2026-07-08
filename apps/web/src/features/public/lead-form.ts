import {
  LeadSubmissionSchema,
  type LeadSubmissionInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type LeadFormData = {
  name: string
  email: string
  phone: string
  company: string
  segment: string
  message: string
}

export type LeadFormField = keyof LeadFormData

export const emptyLeadForm: LeadFormData = {
  name: '',
  email: '',
  phone: '',
  company: '',
  segment: '',
  message: '',
}

// Pure, testable parse of the marketing lead form. Attribution (UTM/referrer)
// and the honeypot are added by the component at submit time; here we only
// validate what the visitor typed.
export function parseLeadForm(
  data: LeadFormData,
): FeatureFormValidationResult<LeadSubmissionInput, LeadFormField> {
  const parsed = LeadSubmissionSchema.safeParse({
    name: data.name,
    email: data.email,
    phone: data.phone,
    company: data.company,
    segment: data.segment || 'outro',
    message: data.message,
  })

  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      'name',
      'email',
      'phone',
      'company',
      'segment',
      'message',
    ])
  }

  return { success: true, data: parsed.data }
}
