import { z } from "zod";
import { isValidCnpj, normalizeCnpj } from "@calibra-facil/shared/cnpj";

// =============================================================================
// UNIT GOVERNANCE SCHEMAS (/api/units/admin)
// =============================================================================

export const CreateUnitSchema = z.object({
  name: z.string().trim().min(2, "Nome da unidade é obrigatório"),
});

/** A calibrating-body text field: blank clears it, null clears it, absent leaves it. */
const bodyText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

/**
 * Roadmap 2 C2: the unit as a distinct calibrating body (legal name, CNPJ,
 * address). A unit that declares a CNPJ is a distinct establishment: its block
 * is what the certificates it issues print as the calibrating body.
 */
export const CalibratingBodySchema = z.object({
  legalName: bodyText(200),
  // Stored normalised (digits, or the alphanumeric CNPJ's characters, no
  // punctuation); the certificate formats it on print.
  cnpj: bodyText(32)
    .refine((value) => !value || isValidCnpj(value), {
      message: "CNPJ inválido",
    })
    .transform((value) => (value ? normalizeCnpj(value) : value)),
  street: bodyText(200),
  number: bodyText(30),
  complement: bodyText(120),
  neighbourhood: bodyText(120),
  city: bodyText(120),
  state: bodyText(2),
  cep: bodyText(20),
});

export const UpdateUnitSchema = z.object({
  name: z.string().trim().min(2).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  calibratingBody: CalibratingBodySchema.optional(),
});

export const UpdateAssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      unitId: z.coerce.number().int().positive(),
      role: z.enum(["member", "technician", "unit_admin"]),
    }),
  ),
});

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["member", "operator", "technician", "admin"]),
});
