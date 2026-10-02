import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  calibrationMethod,
  customer,
  organization,
  organizationSigningCertificate,
  referenceStandard,
} from "@calibra-facil/db/schema";

/**
 * What a laboratory still has to do before it can issue its first certificate.
 *
 * Every step is derived from live domain state, never from a stored flag. A
 * flag goes stale the moment the record behind it changes, and a checklist that
 * says "done" about something a lab has since archived is worse than no
 * checklist: it tells them they can proceed when they cannot. Deriving also
 * makes two people onboarding the same laboratory correct for free, because
 * there is no per-user progress to reconcile.
 *
 * A step un-checking itself is therefore correct behaviour. If the only
 * published method is archived, publishing a method genuinely is outstanding
 * again.
 */

export type ActivationStepId =
  | "organizationProfile"
  | "methodPublished"
  | "referenceStandard"
  | "signingCertificate"
  | "customer"
  | "firstCertificate";

export type ActivationChecklist = {
  steps: Array<{ id: ActivationStepId; done: boolean }>;
  /** True once every step is done, including the first issued certificate. */
  complete: boolean;
};

async function exists(query: Promise<Array<{ id: unknown }>>) {
  const rows = await query;
  return rows.length > 0;
}

/**
 * The organization fields a certificate needs on its face. Deliberately not
 * every ISO 17025 field: accreditation and technical manager are real, but a
 * laboratory in implementation legitimately has neither yet, and blocking the
 * checklist on them would call a correct state incomplete.
 */
function organizationProfileIsComplete(row: {
  name: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
}) {
  return [row.name, row.cnpj, row.email, row.phone, row.city, row.state].every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

export async function getActivationChecklist(
  organizationId: string,
): Promise<ActivationChecklist> {
  const [org] = await db
    .select({
      name: organization.name,
      cnpj: organization.cnpj,
      email: organization.email,
      phone: organization.phone,
      city: organization.city,
      state: organization.state,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const [
    methodPublished,
    referenceStandardRegistered,
    signingCertificate,
    customerCreated,
    certificateIssued,
  ] = await Promise.all([
    exists(
      db
        .select({ id: calibrationMethod.id })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.organizationId, organizationId),
            eq(calibrationMethod.status, "PUBLISHED"),
          ),
        )
        .limit(1),
    ),
    // Only a standard a calibration could actually use. Job creation rejects a
    // non-ACTIVE or expired standard, so counting one here would tick the step
    // while the first calibration stays blocked, which is the exact lie the
    // derived checklist exists to avoid.
    exists(
      db
        .select({ id: referenceStandard.id })
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.organizationId, organizationId),
            isNull(referenceStandard.deletedAt),
            eq(referenceStandard.status, "ACTIVE"),
            gt(referenceStandard.nextCalibrationDate, new Date()),
          ),
        )
        .limit(1),
    ),
    // The same conditions the worker selects a signing certificate by. An
    // inactive, revoked, non-default or expired certificate would tick this
    // step and then fail at generation with nothing to sign the laudo.
    exists(
      db
        .select({ id: organizationSigningCertificate.id })
        .from(organizationSigningCertificate)
        .where(
          and(
            eq(organizationSigningCertificate.organizationId, organizationId),
            eq(organizationSigningCertificate.isActive, true),
            eq(organizationSigningCertificate.isDefault, true),
            isNull(organizationSigningCertificate.revokedAt),
            gt(organizationSigningCertificate.validUntil, new Date()),
          ),
        )
        .limit(1),
    ),
    exists(
      db
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.labOrganizationId, organizationId))
        .limit(1),
    ),
    exists(
      db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.organizationId, organizationId),
            eq(calibrationJob.status, "APPROVED"),
          ),
        )
        .limit(1),
    ),
  ]);

  const steps: ActivationChecklist["steps"] = [
    {
      id: "organizationProfile",
      done: Boolean(org && organizationProfileIsComplete(org)),
    },
    { id: "methodPublished", done: methodPublished },
    { id: "referenceStandard", done: referenceStandardRegistered },
    { id: "signingCertificate", done: signingCertificate },
    { id: "customer", done: customerCreated },
    { id: "firstCertificate", done: certificateIssued },
  ];

  return { steps, complete: steps.every((step) => step.done) };
}
