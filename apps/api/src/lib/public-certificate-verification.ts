import { systemDb } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  calibrationMethod,
  customer,
  issuedCertificateSnapshot,
  organization,
  service,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { orgDb } from "./org-db";

/**
 * Lookups of the PUBLIC certificate verification routes (routes/verify.ts, no
 * session). The unguessable verification token IS the credential, and it yields
 * the laboratory that issued the certificate, so the lookup by token cannot be
 * bound to an organization yet: it runs on the SYSTEM path (`systemDb`, the
 * owner connection; P2-18a, tenant-sql-allowlist.ts "public-token"). The
 * amendment links that follow are bound to that laboratory
 * (`findPublicAmendmentLink`).
 */

/** A certificate is publicly verifiable once it has been approved. */
const PUBLICLY_VERIFIABLE = ["APPROVED", "SUPERSEDED"] as const;

/** The certificate with its customer, asset, service and laboratory, by token. */
export async function findCertificateByVerificationToken(token: string) {
  const [job] = await systemDb
    .select({
      id: calibrationJob.id,
      organizationId: calibrationJob.organizationId,
      jobId: calibrationJob.jobId,
      certificateName: calibrationJob.certificateName,
      status: calibrationJob.status,
      certificateUrl: calibrationJob.certificateUrl,
      performedAt: calibrationJob.performedAt,
      approvedAt: calibrationJob.approvedAt,
      // Digital signature metadata - ISO 17025 Clause 7.8.2.1(q)
      signatureMetadata: calibrationJob.signatureMetadata,
      // Amendment fields - ISO 17025 Clause 7.8.4.1
      supersedesId: calibrationJob.supersedesId,
      supersededById: calibrationJob.supersededById,
      amendmentNumber: calibrationJob.amendmentNumber,
      amendmentReason: calibrationJob.amendmentReason,
      supersededAt: calibrationJob.supersededAt,
      customerName: customer.name,
      assetName: asset.name,
      assetTag: asset.tag,
      serviceName: service.name,
      labName: organization.name,
      // Accreditation seal - frozen method flag with current-method fallback
      methodSnapshot: calibrationJob.methodSnapshot,
      scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
      serviceMethodAccreditedScope: calibrationMethod.accreditedScope,
      labAccreditationActive: organization.accreditationActive,
      labAccreditationValidFrom: organization.accreditationValidFrom,
      labAccreditationValidUntil: organization.accreditationValidUntil,
      labAccreditationNumber: organization.accreditationNumber,
    })
    .from(calibrationJob)
    .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
    .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
    .innerJoin(service, eq(calibrationJob.serviceId, service.id))
    .innerJoin(organization, eq(calibrationJob.organizationId, organization.id))
    .leftJoin(calibrationMethod, eq(service.methodId, calibrationMethod.id))
    .where(
      and(
        eq(calibrationJob.verificationToken, token),
        inArray(calibrationJob.status, [...PUBLICLY_VERIFIABLE]),
      ),
    )
    .limit(1);
  return job ?? null;
}

/**
 * The replacement / the original of an amendment, but only while it is itself
 * publicly verifiable (a still-draft replacement must not be linked from a
 * valid superseded certificate). Bound to the laboratory that issued the
 * certificate the token resolved to (an amendment is always issued by the
 * laboratory of its original), so a link can never point into another
 * laboratory's certificate.
 */
export async function findPublicAmendmentLink(
  organizationId: string,
  jobId: number,
) {
  const [linked] = await orgDb(organizationId).transaction((o) =>
    o
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        verificationToken: calibrationJob.verificationToken,
      })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.id, jobId),
          inArray(calibrationJob.status, [...PUBLICLY_VERIFIABLE]),
        ),
      )
      .limit(1),
  );
  return linked ?? null;
}

/** The signature evidence of the certificate behind a token. */
export async function findCertificateSignatureByToken(token: string) {
  const [job] = await systemDb
    .select({
      signatureMetadata: calibrationJob.signatureMetadata,
      signatureVerdict: calibrationJob.signatureVerdict,
      certificateUrl: calibrationJob.certificateUrl,
    })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.verificationToken, token),
        inArray(calibrationJob.status, [...PUBLICLY_VERIFIABLE]),
      ),
    )
    .limit(1);
  return job ?? null;
}

/** The recorded integrity hash of the certificate behind a token. */
export async function findCertificateIntegrityByToken(token: string) {
  const [job] = await systemDb
    .select({
      pdfSha256: issuedCertificateSnapshot.pdfSha256,
      signatureMetadata: calibrationJob.signatureMetadata,
    })
    .from(calibrationJob)
    .leftJoin(
      issuedCertificateSnapshot,
      eq(issuedCertificateSnapshot.jobId, calibrationJob.id),
    )
    .where(
      and(
        eq(calibrationJob.verificationToken, token),
        inArray(calibrationJob.status, [...PUBLICLY_VERIFIABLE]),
      ),
    )
    .limit(1);
  return job ?? null;
}

/** The stored document of the certificate behind a token. */
export async function findCertificateDownloadByToken(token: string) {
  const [job] = await systemDb
    .select({ certificateUrl: calibrationJob.certificateUrl })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.verificationToken, token),
        inArray(calibrationJob.status, [...PUBLICLY_VERIFIABLE]),
      ),
    )
    .limit(1);
  return job ?? null;
}
