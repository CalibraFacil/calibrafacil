import {
  LeadSubmissionSchema,
  type LeadSubmissionInput,
} from "@calibra-facil/schemas";

import {
  zodFormError,
  type FeatureFormValidationResult,
} from "./forms/validation";

export type LeadFormData = {
  name: string;
  email: string;
  phone: string;
  company: string;
  segment: string;
  message: string;
};

export type LeadFormField = keyof LeadFormData;

export const emptyLeadForm: LeadFormData = {
  name: "",
  email: "",
  phone: "",
  company: "",
  segment: "",
  message: "",
};

// Where the public lead endpoint lives (the cloud API — a separate origin).
export const LEADS_ENDPOINT = "https://api.calibrafacil.com/api/public/leads";

// Pure, testable parse of the marketing lead form. Attribution (UTM/referrer)
// and the honeypot are added by the component at submit time.
export function parseLeadForm(
  data: LeadFormData,
): FeatureFormValidationResult<LeadSubmissionInput, LeadFormField> {
  const parsed = LeadSubmissionSchema.safeParse({
    name: data.name,
    email: data.email,
    phone: data.phone,
    company: data.company,
    segment: data.segment || "outro",
    message: data.message,
  });

  if (!parsed.success) {
    return zodFormError(parsed.error.issues, [
      "name",
      "email",
      "phone",
      "company",
      "segment",
      "message",
    ]);
  }

  return { success: true, data: parsed.data };
}
