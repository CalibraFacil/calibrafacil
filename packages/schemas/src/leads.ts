import { z } from "zod";

/**
 * On-site marketing lead capture (SEO / lead-gen track B). A public,
 * unauthenticated inbound form on the marketing site posts a lead here; it is
 * not org-scoped and never touches the RBAC layer.
 */

// TS union types for these live in `@calibra-facil/shared` (LeadSegment /
// LeadStatus); the Zod enums here are the runtime validation source, mirrored
// exactly as the repo does for other column enums (e.g. CommercialOfferStatus).
export const LeadSegmentSchema = z.enum(["lab", "oficina", "outro"]);

export const LeadStatusSchema = z.enum([
  "new",
  "contacted",
  "qualified",
  "disqualified",
]);

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().default("");

export const LeadSubmissionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: optionalText(40),
  company: optionalText(160),
  segment: LeadSegmentSchema.default("outro"),
  message: optionalText(2000),
  // Honeypot: a hidden field real users never see. Bots fill it; the API
  // accepts the request (so bots get no signal) but discards it. Kept lax here
  // and checked server-side rather than rejected at the schema boundary.
  website: optionalText(200),
  // Best-effort attribution captured client-side from the URL / referrer.
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  utmTerm: optionalText(200),
  utmContent: optionalText(200),
  referrer: optionalText(500),
});
export type LeadSubmissionInput = z.infer<typeof LeadSubmissionSchema>;
