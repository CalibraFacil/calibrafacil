import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { organization } from "@calibra-facil/db/schema";
import { UpdateOrganizationProfileSchema } from "@calibra-facil/schemas";
import { writeOrganizationAuditEvent } from "../lib/audit";
import { writeComplianceAuditEvent } from "../lib/compliance-audit";
import { domainErrorResponse, invalid, notFound } from "../lib/domain-errors";
import { orgDb } from "../lib/org-db";
import {
  type AuthVariables,
  requireRole,
  withLabPermission,
} from "../middleware/permission";

/**
 * The laboratory profile (architecture review P0-1).
 *
 * CNPJ, the accreditation claim (CGCRE/RBC number, body, active toggle, vigência
 * window), the legal-metrology repair authorization, the address, the contacts
 * and the technical manager used to be written through Better Auth's
 * `organization/update`, where any field could be sent by any member that holds
 * `organization:update`. Every one of them is now `input: false` there and is
 * written only here: the role is checked on the server, the write is bound to the
 * member's own laboratory, and each change leaves an audit event naming the
 * fields (and the before/after of the accreditation claim).
 */
const PROFILE_COLUMNS = {
  cnpj: organization.cnpj,
  accreditationNumber: organization.accreditationNumber,
  accreditationBody: organization.accreditationBody,
  accreditationActive: organization.accreditationActive,
  accreditationValidFrom: organization.accreditationValidFrom,
  accreditationValidUntil: organization.accreditationValidUntil,
  permissionariaAuthorizationNumber:
    organization.permissionariaAuthorizationNumber,
  permissionariaAuthorizationState:
    organization.permissionariaAuthorizationState,
  street: organization.street,
  number: organization.number,
  complement: organization.complement,
  neighbourhood: organization.neighbourhood,
  city: organization.city,
  state: organization.state,
  cep: organization.cep,
  phone: organization.phone,
  email: organization.email,
  website: organization.website,
  technicalManagerName: organization.technicalManagerName,
  technicalManagerTitle: organization.technicalManagerTitle,
};

type ProfileField = keyof typeof PROFILE_COLUMNS;

/** The profile fields stored as plain text (null clears them). */
const TEXT_FIELDS = [
  "cnpj",
  "accreditationNumber",
  "accreditationBody",
  "permissionariaAuthorizationNumber",
  "permissionariaAuthorizationState",
  "street",
  "number",
  "complement",
  "neighbourhood",
  "city",
  "state",
  "cep",
  "phone",
  "email",
  "website",
  "technicalManagerName",
  "technicalManagerTitle",
] as const satisfies readonly ProfileField[];

/**
 * The fields that are the laboratory's identity and accreditation claim: the
 * audit event records their before and after (the others only by name).
 */
const CLAIM_FIELDS = [
  "cnpj",
  "accreditationNumber",
  "accreditationBody",
  "accreditationActive",
  "accreditationValidFrom",
  "accreditationValidUntil",
  "permissionariaAuthorizationNumber",
  "permissionariaAuthorizationState",
] as const satisfies readonly ProfileField[];

function auditValue(value: Date | string | boolean | null) {
  return value instanceof Date ? value.toISOString() : value;
}

function isoOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

export const organizationProfileRouter = new Hono<{
  Variables: AuthVariables;
}>().patch(
  "/profile",
  ...withLabPermission({ organization: ["update"] }),
  requireRole(["admin", "owner"]),
  zValidator("json", UpdateOrganizationProfileSchema),
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const input = c.req.valid("json");

    const set: Partial<typeof organization.$inferInsert> = {};
    for (const key of TEXT_FIELDS) {
      const value = input[key];
      if (value !== undefined) set[key] = value;
    }
    if (input.accreditationActive !== undefined) {
      set.accreditationActive = input.accreditationActive;
    }
    if (input.accreditationValidFrom !== undefined) {
      set.accreditationValidFrom = input.accreditationValidFrom
        ? new Date(input.accreditationValidFrom)
        : null;
    }
    if (input.accreditationValidUntil !== undefined) {
      set.accreditationValidUntil = input.accreditationValidUntil
        ? new Date(input.accreditationValidUntil)
        : null;
    }
    const fields = Object.keys(set).filter(
      (key): key is ProfileField => key in PROFILE_COLUMNS,
    );

    const outcome = await orgDb(member.organizationId).transaction(
      async (tx) => {
        const [before] = await tx
          .select(PROFILE_COLUMNS)
          .from(organization)
          .where(eq(organization.id, member.organizationId))
          .limit(1);
        if (!before) return null;
        if (fields.length === 0) return before;

        // The window must stay ordered once the change is merged with what is
        // stored (the schema checks it only when both bounds are sent).
        const from =
          set.accreditationValidFrom === undefined
            ? before.accreditationValidFrom
            : set.accreditationValidFrom;
        const until =
          set.accreditationValidUntil === undefined
            ? before.accreditationValidUntil
            : set.accreditationValidUntil;
        if (from && until && from.getTime() > until.getTime()) {
          return "invalid_window" as const;
        }

        const [after] = await tx
          .update(organization)
          .set(set)
          .where(eq(organization.id, member.organizationId))
          .returning(PROFILE_COLUMNS);
        if (!after) return null;

        await writeOrganizationAuditEvent(
          {
            organizationId: member.organizationId,
            actorUserId: session.user.id,
            actorMemberId: member.id,
            action: "organization.profile.updated",
            entityType: "organization",
            entityId: member.organizationId,
            details: {
              fields,
              claims: CLAIM_FIELDS.filter((field) =>
                fields.includes(field),
              ).map((field) => ({
                field,
                from: auditValue(before[field]),
                to: auditValue(after[field]),
              })),
            },
          },
          tx,
        );

        // B4a: the append-only compliance trail records the accreditation claim
        // (number, body, active toggle, vigência window = the seal's settings)
        // with before and after, in this same transaction.
        const changedClaims = CLAIM_FIELDS.filter((field) =>
          fields.includes(field),
        );
        if (changedClaims.length > 0) {
          await writeComplianceAuditEvent(
            {
              organizationId: member.organizationId,
              action: "accreditation.profile_changed",
              entityType: "organization",
              entityId: member.organizationId,
              changes: {
                fields: changedClaims,
                before: Object.fromEntries(
                  changedClaims.map((field) => [
                    field,
                    auditValue(before[field]),
                  ]),
                ),
                after: Object.fromEntries(
                  changedClaims.map((field) => [
                    field,
                    auditValue(after[field]),
                  ]),
                ),
              },
              performedBy: session.user.id,
              ipAddress: c.req.header("x-forwarded-for") ?? null,
            },
            tx,
          );
        }
        return after;
      },
    );

    if (outcome === "invalid_window") {
      return domainErrorResponse(
        c,
        invalid(
          "invalid_request",
          "O início da vigência não pode ser posterior ao fim",
        ),
      );
    }
    if (!outcome) {
      return domainErrorResponse(
        c,
        notFound("not_found", "Organização não encontrada"),
      );
    }

    return c.json({
      ...outcome,
      accreditationValidFrom: isoOrNull(outcome.accreditationValidFrom),
      accreditationValidUntil: isoOrNull(outcome.accreditationValidUntil),
    });
  },
);
