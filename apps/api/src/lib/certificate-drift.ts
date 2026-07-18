import { createHash } from "node:crypto";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { issuedCertificateSnapshot } from "@calibra-facil/db/schema";

import { writeOrganizationAuditEvent } from "./audit";

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

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runCertificateDriftCheck(
  fetchArtifact: ArtifactFetcher,
  options: { sampleSize?: number } = {},
): Promise<DriftCheckResult> {
  const sampleSize = options.sampleSize ?? 25;
  const rows = await db
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
      await writeOrganizationAuditEvent({
        organizationId: row.organizationId,
        action: "certificate.drift_detected",
        entityType: "issued_certificate_snapshot",
        entityId: String(row.id),
        details: { artifact, kind, r2Key: key, expectedSha256: expected },
      });
    }
  }

  console.log(
    `[drift-check] checked=${result.checked} drifted=${result.drifted} missing=${result.missing}`,
  );
  return result;
}
