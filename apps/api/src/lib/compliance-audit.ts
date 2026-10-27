import type { OrgDb } from "@calibra-facil/db/for-org";
import { organizationComplianceAuditLog } from "@calibra-facil/db/schema";

/**
 * Append-only audit of the laboratory's compliance configuration (roadmap 2 B4a,
 * ISO/IEC 17025 8.4): signing-credential create / replace / delete, the signing
 * policy, and the accreditation profile. One row per change with the actor and
 * the before/after values.
 *
 * It is written through the caller's org-bound transaction, so the row commits
 * (or rolls back) with the change it records. The table is append-only for the
 * application role (UPDATE/DELETE are revoked, and a trigger refuses them too).
 *
 * NO SECRETS: `changes` carries identifiers and settings only (serial number,
 * validity, flags, the accreditation number). {@link assertNoSecrets} refuses a
 * payload that names key material, so a future caller cannot log a P12, a
 * password or a key by accident.
 */

export type ComplianceAuditAction =
  | "signing_credential.created"
  | "signing_credential.default_replaced"
  | "signing_credential.deleted"
  | "signing_credential.rewrapped"
  | "signing_policy.unsigned_issuance_changed"
  | "signing_policy.require_signature_changed"
  | "accreditation.profile_changed"
  | "accreditation.scope_enforcement_changed";

export type ComplianceAuditEntry = {
  organizationId: string;
  unitId?: number | null;
  action: ComplianceAuditAction;
  entityType: string;
  entityId?: string | null;
  /** `{ before, after, ... }`: identifiers and settings, never secrets. */
  changes: Record<string, unknown>;
  /** The acting user; null when the platform acted (the re-encrypt CLI). */
  performedBy?: string | null;
  ipAddress?: string | null;
};

const SECRET_KEY =
  /p12|pkcs|passw|passphrase|secret|private|encrypted|ciphertext|master|kek|dek|token|iv$/i;

/** Throws when any key of the payload (at any depth) names secret material. */
export function assertNoSecrets(value: unknown, path = "changes"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, inner] of Object.entries(value)) {
    // `kekId` is the key's public label, not key material.
    if (key !== "kekId" && SECRET_KEY.test(key)) {
      throw new Error(
        `compliance audit: ${path}.${key} looks like secret material and must not be audited`,
      );
    }
    assertNoSecrets(inner, `${path}.${key}`);
  }
}

export async function writeComplianceAuditEvent(
  entry: ComplianceAuditEntry,
  executor: Pick<OrgDb, "insert">,
): Promise<void> {
  assertNoSecrets(entry.changes);
  await executor.insert(organizationComplianceAuditLog).values({
    organizationId: entry.organizationId,
    unitId: entry.unitId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: entry.changes,
    performedBy: entry.performedBy ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}
