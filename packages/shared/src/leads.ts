/**
 * Marketing lead capture (SEO / lead-gen track B). Column enum types for the
 * `leads` table. These prospects are NOT tenants and never touch the RBAC
 * layer. The matching Zod schemas live in `@calibra-facil/schemas`.
 */

export type LeadSegment = "lab" | "oficina" | "outro";

export type LeadStatus = "new" | "contacted" | "qualified" | "disqualified";
