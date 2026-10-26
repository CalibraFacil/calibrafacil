import { z } from "zod";

/**
 * The laboratory profile: CNPJ, the accreditation claim (CGCRE/RBC number, body,
 * active toggle, vigência window), the legal-metrology repair authorization, the
 * address, the contacts and the technical manager.
 *
 * These fields are written by the laboratory's own route
 * (`PATCH /api/organization/profile`), never through Better Auth's
 * `organization/update` (every one of them is `input: false` there): the route
 * checks the member's role and records an audit event.
 *
 * Semantics of a field in the body:
 *   - absent / `undefined`  the stored value is left as it is;
 *   - `null` or `""`        the stored value is cleared;
 *   - a string              the trimmed value is stored.
 * The vigência bounds are ISO-8601 instants (the web anchors a laboratory day at
 * its start or end); a value that is not a date is refused.
 */
const profileText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null));

const profileInstant = z
  .string()
  .trim()
  .nullish()
  .refine(
    (value) => !value || !Number.isNaN(new Date(value).getTime()),
    "Data inválida",
  )
  .transform((value) => (value === undefined ? undefined : value || null));

export const UpdateOrganizationProfileSchema = z.object({
  cnpj: profileText(32),
  accreditationNumber: profileText(64),
  accreditationBody: profileText(120),
  accreditationActive: z.boolean().optional(),
  accreditationValidFrom: profileInstant,
  accreditationValidUntil: profileInstant,
  permissionariaAuthorizationNumber: profileText(64),
  permissionariaAuthorizationState: profileText(2),
  street: profileText(200),
  number: profileText(32),
  complement: profileText(120),
  neighbourhood: profileText(120),
  city: profileText(120),
  state: profileText(64),
  cep: profileText(16),
  phone: profileText(40),
  email: profileText(254),
  website: profileText(254),
  technicalManagerName: profileText(160),
  technicalManagerTitle: profileText(160),
});

export type UpdateOrganizationProfileInput = z.input<
  typeof UpdateOrganizationProfileSchema
>;
export type ParsedOrganizationProfile = z.output<
  typeof UpdateOrganizationProfileSchema
>;
