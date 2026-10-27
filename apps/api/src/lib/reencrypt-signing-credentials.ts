/**
 * Re-encrypt the laboratories' signing credentials under the CURRENT key
 * encryption key (roadmap 2 B4a, REQ-B4A-2). Behind
 * `apps/api/src/cli/reencrypt-signing-credentials.ts`.
 *
 * What it does, per `organization_signing_certificate` row:
 *   - a LEGACY row (the `enc:v1` P12 + password under the bare master key) becomes
 *     an envelope: a fresh data key per field, wrapped by the current KEK, AAD =
 *     organization + unit + serial;
 *   - an envelope sealed under a PREVIOUS KEK is re-sealed under the current one
 *     (a new data key too: after a suspected KEK leak the old data key must not
 *     survive);
 *   - a row already under the current KEK is left alone, so a second run changes
 *     nothing (idempotent).
 *
 * `dryRun` opens every credential (so it proves each one still decrypts) and
 * reports what it would change, writing nothing.
 *
 * It runs on the SYSTEM path (`systemDb`, the owner connection): it sweeps every
 * laboratory, which no organization-bound transaction can. Each row is updated in
 * its own transaction, guarded by the ciphertext it read (a concurrent re-seal or
 * a replacement wins and the row is reported `skipped`), with a platform-actor
 * row in `organization_compliance_audit_log` (no secrets) in the same transaction.
 * A row that cannot be opened is reported `failed` and left untouched; the sweep
 * goes on, and the caller exits non-zero.
 */
import { and, asc, eq } from "drizzle-orm";
import { systemDb } from "@calibra-facil/db";
import { organizationSigningCertificate } from "@calibra-facil/db/schema";
import {
  credentialNeedsRewrap,
  openSigningCredential,
  sealSigningCredential,
  type SigningKeyring,
} from "@calibra-facil/signing";

import { writeComplianceAuditEvent } from "./compliance-audit";

export type ReencryptOutcome = "rewrapped" | "unchanged" | "skipped" | "failed";

export type ReencryptRowReport = {
  id: number;
  organizationId: string;
  unitId: number;
  serialNumber: string;
  outcome: ReencryptOutcome;
  /** `legacy` or the previous KEK id the row was sealed under. */
  from: string;
  to: string;
  /** Set for `failed`: why the credential could not be opened (no secrets). */
  error?: string;
};

export type ReencryptSummary = {
  dryRun: boolean;
  currentKekId: string;
  total: number;
  rewrapped: number;
  unchanged: number;
  skipped: number;
  failed: number;
  rows: ReencryptRowReport[];
};

export async function reencryptSigningCredentials(options: {
  keyring: SigningKeyring;
  dryRun?: boolean;
}): Promise<ReencryptSummary> {
  const { keyring } = options;
  const dryRun = options.dryRun ?? false;

  const rows = await systemDb
    .select()
    .from(organizationSigningCertificate)
    .orderBy(asc(organizationSigningCertificate.id));

  const reports: ReencryptRowReport[] = [];
  for (const row of rows) {
    const stored = {
      encryptedP12: row.encryptedP12,
      encryptedPassword: row.encryptedPassword,
      passwordIv: row.passwordIv,
      kekId: row.kekId,
      formatVersion: row.custodyFormatVersion,
    };
    const base = {
      id: row.id,
      organizationId: row.organizationId,
      unitId: row.unitId,
      serialNumber: row.serialNumber,
      from: row.kekId ?? "legacy",
      to: keyring.currentId,
    };

    if (!credentialNeedsRewrap(stored, keyring)) {
      reports.push({ ...base, outcome: "unchanged" });
      continue;
    }

    const binding = {
      organizationId: row.organizationId,
      unitId: row.unitId,
      serialNumber: row.serialNumber,
    };
    let sealed;
    try {
      const opened = openSigningCredential(stored, binding, keyring);
      sealed = sealSigningCredential(
        { p12: opened.p12, password: opened.password },
        binding,
        keyring,
      );
    } catch (error) {
      reports.push({
        ...base,
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (dryRun) {
      reports.push({ ...base, outcome: "rewrapped" });
      continue;
    }

    const written = await systemDb.transaction(async (tx) => {
      // Guarded by the ciphertext that was read: a replacement or a concurrent
      // re-seal changed it, and this row is left for the next run.
      const updated = await tx
        .update(organizationSigningCertificate)
        .set({
          encryptedP12: sealed.encryptedP12,
          encryptedPassword: sealed.encryptedPassword,
          passwordIv: sealed.passwordIv,
          kekId: sealed.kekId,
          custodyFormatVersion: sealed.formatVersion,
        })
        .where(
          and(
            eq(organizationSigningCertificate.id, row.id),
            eq(
              organizationSigningCertificate.organizationId,
              row.organizationId,
            ),
            eq(organizationSigningCertificate.encryptedP12, row.encryptedP12),
            eq(
              organizationSigningCertificate.encryptedPassword,
              row.encryptedPassword,
            ),
          ),
        )
        .returning();
      if (updated.length === 0) return false;

      await writeComplianceAuditEvent(
        {
          organizationId: row.organizationId,
          unitId: row.unitId,
          action: "signing_credential.rewrapped",
          entityType: "organization_signing_certificate",
          entityId: String(row.id),
          changes: {
            before: {
              kekId: row.kekId,
              custodyFormatVersion: row.custodyFormatVersion,
            },
            after: {
              kekId: sealed.kekId,
              custodyFormatVersion: sealed.formatVersion,
            },
            serialNumber: row.serialNumber,
          },
          // The platform acted, not a user.
          performedBy: null,
        },
        tx,
      );
      return true;
    });
    reports.push({ ...base, outcome: written ? "rewrapped" : "skipped" });
  }

  const count = (outcome: ReencryptOutcome) =>
    reports.filter((report) => report.outcome === outcome).length;
  return {
    dryRun,
    currentKekId: keyring.currentId,
    total: reports.length,
    rewrapped: count("rewrapped"),
    unchanged: count("unchanged"),
    skipped: count("skipped"),
    failed: count("failed"),
    rows: reports,
  };
}
