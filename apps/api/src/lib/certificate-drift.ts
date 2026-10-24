import { createHash } from "node:crypto";
import { desc, isNotNull } from "drizzle-orm";
import { systemDb } from "@calibra-facil/db";
import { issuedCertificateSnapshot } from "@calibra-facil/db/schema";

import { writeOrganizationAuditEvent } from "./audit";
import { orgDb } from "./org-db";

/**
 * Certificate drift detection: re-hash the STORED PDF of recent
 * issued-certificate snapshots and
 * compare against the hashes frozen at issuance. Reproducibility stops being
 * forensic-only — silent artifact corruption/tampering surfaces as an audit
 * event instead of at the next audit.
 *
 * Read-only over regulated records: nothing is ever rewritten; a mismatch is
 * REPORTED (org-level audit event `certificate.drift_detected`), never
 * "repaired".
 */

export type ArtifactFetcher = (
  bucket: "certificates",
  key: string,
) => Promise<Uint8Array | null>;

export type DriftCheckResult = {
  checked: number;
  drifted: number;
  missing: number;
  details: Array<{
    snapshotId: number;
    organizationId: string;
    artifact: "pdf";
    kind: "hash_mismatch" | "object_missing";
  }>;
};

/**
 * Thrown at the END of a sweep in which some audit writes failed: every other
 * finding was still recorded, and `result` is what the sweep found, so the cron
 * reports the failure without losing the findings (a failing laboratory never
 * hides another laboratory's drift).
 */
export class DriftAuditWriteError extends Error {
  constructor(
    readonly result: DriftCheckResult,
    readonly failures: ReadonlyArray<{ snapshotId: number; error: unknown }>,
  ) {
    super(
      `certificate drift: ${failures.length} audit event(s) could not be written (snapshots ${failures.map((failure) => failure.snapshotId).join(", ")})`,
    );
    this.name = "DriftAuditWriteError";
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runCertificateDriftCheck(
  fetchArtifact: ArtifactFetcher,
  options: { sampleSize?: number } = {},
): Promise<DriftCheckResult> {
  const sampleSize = options.sampleSize ?? 25;
  // System path (P2-18j): the sweep re-hashes the newest snapshots of EVERY
  // laboratory (a platform integrity job, no request names one), so this one
  // statement lists them across laboratories; the audit event of each finding
  // is written in a transaction that names that snapshot's laboratory.
  const rows = await systemDb
    .select({
      id: issuedCertificateSnapshot.id,
      organizationId: issuedCertificateSnapshot.organizationId,
      pdfR2Key: issuedCertificateSnapshot.pdfR2Key,
      pdfSha256: issuedCertificateSnapshot.pdfSha256,
    })
    .from(issuedCertificateSnapshot)
    .where(isNotNull(issuedCertificateSnapshot.pdfR2Key))
    .orderBy(desc(issuedCertificateSnapshot.id))
    .limit(sampleSize);

  const failures: Array<{ snapshotId: number; error: unknown }> = [];
  const result: DriftCheckResult = {
    checked: 0,
    drifted: 0,
    missing: 0,
    details: [],
  };

  for (const row of rows) {
    const artifacts: Array<{
      artifact: "pdf";
      key: string | null;
      expected: string | null;
    }> = [{ artifact: "pdf", key: row.pdfR2Key, expected: row.pdfSha256 }];
    for (const { artifact, key, expected } of artifacts) {
      if (!key || !expected) continue;
      result.checked += 1;
      const bytes = await fetchArtifact("certificates", key);
      const kind =
        bytes === null
          ? "object_missing"
          : sha256Hex(bytes) === expected
            ? null
            : "hash_mismatch";
      if (kind === null) continue;
      if (kind === "object_missing") result.missing += 1;
      else result.drifted += 1;
      result.details.push({
        snapshotId: row.id,
        organizationId: row.organizationId,
        artifact,
        kind,
      });
      // The storage read above ended before this transaction opens. One failing
      // write (that laboratory's) must not drop the findings of the others.
      try {
        await orgDb(row.organizationId).transaction((tx) =>
          writeOrganizationAuditEvent(
            {
              organizationId: row.organizationId,
              action: "certificate.drift_detected",
              entityType: "issued_certificate_snapshot",
              entityId: String(row.id),
              details: { artifact, kind, r2Key: key, expectedSha256: expected },
            },
            tx,
          ),
        );
      } catch (error) {
        failures.push({ snapshotId: row.id, error });
        console.error(
          `[drift-check] audit event for snapshot ${row.id} (laboratory ${row.organizationId}) failed`,
          error,
        );
      }
    }
  }

  console.log(
    `[drift-check] checked=${result.checked} drifted=${result.drifted} missing=${result.missing}`,
  );
  if (failures.length > 0) throw new DriftAuditWriteError(result, failures);
  return result;
}
