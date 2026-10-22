import {
  assembleCertificateJobData,
  buildCertificateInput,
  certificateInputSha256,
  imageDataUrl,
  type CertificateInput,
  type CertificateJobSource,
} from "@calibra-facil/certificate-data";
import { getLogoKeyFromUrl } from "@calibra-facil/shared/storage-keys";
import { and, desc, eq } from "drizzle-orm";
import type { db } from "./db";
import {
  asset,
  calibrationJob,
  calibrationMethod,
  certificateInput,
  customer,
  member,
  memberVisualSignature,
  organization,
  serviceOrder,
  serviceOrderCertificateLink,
  user,
} from "./schema";

/**
 * Reads an image object (the lab logo, the approver's drawn signature) by its
 * storage key: the bytes, null when no object backs the key (or no storage is
 * configured), and a throw when storage failed. The caller owns the storage;
 * see apps/api/src/lib/certificate-input-images.ts.
 */
export type CertificateImageReader = (
  key: string,
) => Promise<Uint8Array | null>;

type JobRow = typeof calibrationJob.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Takes the row lock an approval serialises on and removes what an earlier,
 * unfinished approval of the same job left behind.
 *
 * The lock is `SELECT ... FOR UPDATE` on the job at the status the approval was
 * evaluated against, so a concurrent approval waits here and then matches
 * nothing (`false`: the caller reports `concurrent_approval`) instead of
 * colliding with the winner's frozen input.
 *
 * A `certificate_input` row can only exist for a job that is back in REVIEW if
 * its approval did not complete (a reverted dispatch, a render rejected by the
 * worker and approved again). The row documents nothing that was released, and
 * the immutability trigger lets it go only in that state — which is why this
 * runs BEFORE the status moves.
 */
export async function lockJobForApproval(
  tx: Transaction,
  params: {
    jobId: number;
    organizationId: string;
    status: JobRow["status"];
  },
): Promise<boolean> {
  const [locked] = await tx
    .select({ id: calibrationJob.id })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, params.jobId),
        eq(calibrationJob.organizationId, params.organizationId),
        eq(calibrationJob.status, params.status),
      ),
    )
    .limit(1)
    .for("update");
  if (!locked) return false;

  await discardUnreleasedCertificateInput(tx, params);
  return true;
}

/** Removes the frozen input of an approval that was reverted (job back in REVIEW). */
export async function discardUnreleasedCertificateInput(
  tx: Transaction,
  params: { jobId: number; organizationId: string },
): Promise<void> {
  await tx
    .delete(certificateInput)
    .where(
      and(
        eq(certificateInput.jobId, params.jobId),
        eq(certificateInput.organizationId, params.organizationId),
      ),
    );
}

/**
 * schema.ts types the job's method and asset snapshots with `string` where the
 * certificate's own types name a union (a method field's `quantityKind`, an
 * asset's `baseMeasurementUnit`), so the one is not assignable to the other
 * although the stored values are the same. A JSON copy is the identity on what
 * the document stores (it is serialised to JSON anyway) and needs no `as`.
 */
function certificateView<T>(snapshot: unknown): T {
  const copy: T = JSON.parse(JSON.stringify(snapshot));
  return copy;
}

/** An image object read BEFORE the approval transaction: the key it was read under, and its bytes (null: no object). */
export type PrefetchedImage = { key: string; bytes: Uint8Array | null };

/** The images a certificate embeds, read ahead of the approval transaction. */
export type PrefetchedImages = {
  logo: PrefetchedImage | null;
  signature: PrefetchedImage | null;
};

/**
 * The lab's logo or the approver's signature is not the one that was read before
 * the transaction (the lab uploaded another logo in between). Nothing was
 * written; the approval is retried.
 */
export class CertificateImagesChangedError extends Error {
  constructor(readonly slot: "logo" | "signature") {
    super(`The certificate ${slot} changed while the approval was prepared`);
    this.name = "CertificateImagesChangedError";
  }
}

/**
 * Reads the images a certificate embeds BEFORE the approval opens its
 * transaction and takes the job lock: object storage is network I/O and must
 * not run while a row is locked. The keys are the lab's logo and the approver's
 * drawn signature, resolved from the same rows the freeze re-reads under the
 * lock (`freezeCertificateInput` refuses the images if those keys moved).
 */
export async function prefetchCertificateImages(
  executor: Pick<typeof db, "select">,
  params: { organizationId: string; approverId: string },
  readImage: CertificateImageReader,
): Promise<PrefetchedImages> {
  const [lab] = await executor
    .select({ logo: organization.logo })
    .from(organization)
    .where(eq(organization.id, params.organizationId))
    .limit(1);
  const [signature] = await executor
    .select({ r2Key: memberVisualSignature.r2Key })
    .from(memberVisualSignature)
    .innerJoin(member, eq(memberVisualSignature.memberId, member.id))
    .where(
      and(
        eq(member.userId, params.approverId),
        eq(member.organizationId, params.organizationId),
        eq(memberVisualSignature.organizationId, params.organizationId),
      ),
    )
    .limit(1);

  const logoKey = getLogoKeyFromUrl(lab?.logo ?? null);
  const signatureKey = signature?.r2Key ?? null;
  const [logoBytes, signatureBytes] = await Promise.all([
    logoKey ? readImage(logoKey) : null,
    signatureKey ? readImage(signatureKey) : null,
  ]);
  return {
    logo: logoKey ? { key: logoKey, bytes: logoBytes } : null,
    signature: signatureKey
      ? { key: signatureKey, bytes: signatureBytes }
      : null,
  };
}

/** The bytes prefetched for `key`; refuses a key other than the one that was read. */
function prefetchedBytes(
  slot: "logo" | "signature",
  prefetched: PrefetchedImage | null,
  key: string | null,
): Uint8Array | null {
  if ((prefetched?.key ?? null) !== key) {
    throw new CertificateImagesChangedError(slot);
  }
  return prefetched?.bytes ?? null;
}

/**
 * Reads, on the approval transaction, everything the certificate renders from
 * and puts it in the shape `assembleCertificateJobData` takes. Every read is
 * scoped by the job's organization.
 *
 * `job` is the row the approval just wrote (status, approver, approval instant,
 * scope override and environmental justification included): the document
 * describes the job AS APPROVED.
 */
export async function loadCertificateJobSource(
  tx: Transaction,
  job: JobRow,
  images: PrefetchedImages,
): Promise<CertificateJobSource> {
  const organizationId = job.organizationId;

  const [lab] = await tx
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (!lab) throw new Error(`Organization ${organizationId} not found`);

  const [customerRow] = await tx
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, job.customerId),
        eq(customer.labOrganizationId, organizationId),
      ),
    )
    .limit(1);
  if (!customerRow) throw new Error(`Customer ${job.customerId} not found`);

  const [assetRow] = await tx
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.id, job.assetId),
        eq(asset.labOrganizationId, organizationId),
      ),
    )
    .limit(1);
  if (!assetRow) throw new Error(`Asset ${job.assetId} not found`);

  const [approver] = job.approvedBy
    ? await tx
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, job.approvedBy))
        .limit(1)
    : [];

  const [signature] = job.approvedBy
    ? await tx
        .select({
          r2Key: memberVisualSignature.r2Key,
          contentType: memberVisualSignature.contentType,
        })
        .from(memberVisualSignature)
        .innerJoin(member, eq(memberVisualSignature.memberId, member.id))
        .where(
          and(
            eq(member.userId, job.approvedBy),
            eq(member.organizationId, organizationId),
            eq(memberVisualSignature.organizationId, organizationId),
          ),
        )
        .limit(1)
    : [];

  const [original] = job.supersedesId
    ? await tx
        .select({
          jobId: calibrationJob.jobId,
          approvedAt: calibrationJob.approvedAt,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, job.supersedesId),
            eq(calibrationJob.organizationId, organizationId),
          ),
        )
        .limit(1)
    : [];

  const [serviceOrderLink] = await tx
    .select({
      inmetroRepairMarkNumber: serviceOrder.inmetroRepairMarkNumber,
      // The OS is opened when the item comes in over the counter, so opened_at
      // IS the §7.8.2.1(h) date of receipt.
      receivedAt: serviceOrder.openedAt,
      intakeCondition: serviceOrder.intakeCondition,
      accessories: serviceOrder.accessories,
    })
    .from(serviceOrderCertificateLink)
    .innerJoin(
      serviceOrder,
      and(
        eq(serviceOrder.id, serviceOrderCertificateLink.serviceOrderId),
        eq(serviceOrder.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(serviceOrderCertificateLink.certificateJobId, job.id),
        eq(serviceOrderCertificateLink.organizationId, organizationId),
      ),
    )
    .orderBy(desc(serviceOrderCertificateLink.linkedAt))
    .limit(1);

  const [method] = await tx
    .select({ accreditedScope: calibrationMethod.accreditedScope })
    .from(calibrationMethod)
    .where(
      and(
        eq(calibrationMethod.id, job.methodSnapshot.methodId),
        eq(calibrationMethod.organizationId, organizationId),
      ),
    )
    .limit(1);

  // The images were read before the transaction: only the keys are checked here.
  const logoKey = getLogoKeyFromUrl(lab.logo);
  const logoBytes = prefetchedBytes("logo", images.logo, logoKey);
  const signatureBytes = prefetchedBytes(
    "signature",
    images.signature,
    signature?.r2Key ?? null,
  );

  return {
    jobId: job.jobId,
    verificationToken: job.verificationToken,
    certificateName: job.certificateName,
    organizationId,
    organizationSlug: lab.slug,
    unitId: job.unitId,
    performedAt: job.performedAt,
    approvedAt: job.approvedAt,
    methodSnapshot: certificateView(job.methodSnapshot),
    methodAccreditedScopeCurrent: method?.accreditedScope ?? null,
    assetSnapshot: job.assetSnapshot
      ? certificateView(job.assetSnapshot)
      : null,
    standardsSnapshot: job.standardsSnapshot,
    environmentalSnapshot: job.environmentalSnapshot,
    calibrationLocationSnapshot: job.calibrationLocationSnapshot,
    calibrationPhaseSnapshot: job.calibrationPhaseSnapshot,
    data: job.data,
    results: job.results,
    scopeOverrideJustification: job.scopeOverrideJustification,
    methodDeviations: job.methodDeviations,
    supersedesId: job.supersedesId,
    supersededById: job.supersededById,
    amendmentNumber: job.amendmentNumber,
    amendmentReason: job.amendmentReason,
    lab: {
      name: lab.name,
      cnpj: lab.cnpj,
      accreditationNumber: lab.accreditationNumber,
      accreditationBody: lab.accreditationBody,
      accreditationActive: lab.accreditationActive,
      accreditationValidFrom: lab.accreditationValidFrom,
      accreditationValidUntil: lab.accreditationValidUntil,
      street: lab.street,
      number: lab.number,
      complement: lab.complement,
      neighbourhood: lab.neighbourhood,
      city: lab.city,
      state: lab.state,
      cep: lab.cep,
      phone: lab.phone,
      email: lab.email,
      website: lab.website,
      // A logo stored in the bucket becomes a data URI; anything else is kept as stored.
      logo: logoKey && logoBytes ? imageDataUrl(logoBytes, null) : lab.logo,
      technicalManagerName: lab.technicalManagerName,
      technicalManagerTitle: lab.technicalManagerTitle,
    },
    customer: {
      name: customerRow.name,
      taxId: customerRow.taxId,
      phone: customerRow.phone,
      email: customerRow.email,
      address: customerRow.address,
    },
    asset: {
      name: assetRow.name,
      serialNumber: assetRow.serialNumber,
      tag: assetRow.tag,
      model: assetRow.model,
      manufacturer: assetRow.manufacturer,
    },
    approver: {
      name: approver?.name ?? null,
      signatureDataUrl:
        signature && signatureBytes
          ? imageDataUrl(signatureBytes, signature.contentType)
          : null,
    },
    original: original
      ? { jobId: original.jobId, approvedAt: original.approvedAt }
      : null,
    serviceOrder: serviceOrderLink ?? null,
  };
}

/**
 * Builds the certificate input of the job just approved and stores it, on the
 * approval's own transaction: it commits or rolls back with the status change
 * and its audit row. Returns the hash the audit row records.
 */
export async function freezeCertificateInput(
  tx: Transaction,
  job: JobRow,
  images: PrefetchedImages,
): Promise<{ sha256: string; input: CertificateInput }> {
  const source = await loadCertificateJobSource(tx, job, images);
  const input = buildCertificateInput(assembleCertificateJobData(source));
  const sha256 = certificateInputSha256(input);

  await tx.insert(certificateInput).values({
    organizationId: job.organizationId,
    jobId: job.id,
    schemaVersion: input.schemaVersion,
    input,
    sha256,
    layoutKey: input.layout.key,
    layoutVersion: input.layout.version,
    engineVersion: input.engineVersion,
  });

  return { sha256, input };
}
