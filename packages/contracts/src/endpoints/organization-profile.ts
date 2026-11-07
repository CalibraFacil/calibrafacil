import { z } from "zod";
import { UpdateOrganizationProfileSchema } from "@calibra-facil/schemas";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory profile: CNPJ, accreditation claim, address, contacts and the
 * technical manager. Written only here (admin or owner). The response schema
 * is the wire body of `apps/api/src/routes/organization-profile.ts`.
 * Cloud-only.
 */

/** The laboratory profile as `PATCH /api/organization/profile` answers it. */
export const organizationProfileResponseSchema = z.object({
  cnpj: nullableString,
  accreditationNumber: nullableString,
  accreditationBody: nullableString,
  accreditationActive: z.boolean(),
  accreditationValidFrom: nullableString,
  accreditationValidUntil: nullableString,
  permissionariaAuthorizationNumber: nullableString,
  permissionariaAuthorizationState: nullableString,
  street: nullableString,
  number: nullableString,
  complement: nullableString,
  neighbourhood: nullableString,
  city: nullableString,
  state: nullableString,
  cep: nullableString,
  phone: nullableString,
  email: nullableString,
  website: nullableString,
  technicalManagerName: nullableString,
  technicalManagerTitle: nullableString,
});
export type OrganizationProfileResponse = z.infer<
  typeof organizationProfileResponseSchema
>;

export const organizationProfileEndpoints = {
  update: endpoint({
    method: "patch",
    path: "/api/organization/profile",
    body: UpdateOrganizationProfileSchema,
    response: organizationProfileResponseSchema,
    failure: "Falha ao atualizar o perfil do laboratório",
    policy: "cloud-only",
    desktopLabel: "Perfil do laboratório",
  }),
} as const satisfies EndpointGroup;
