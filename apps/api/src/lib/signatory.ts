import { db } from "@calibra-facil/db";
import { authorizedSignatory, asset } from "@calibra-facil/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";

/**
 * Authorized-signatory enforcement for certificate approval.
 *
 * ISO/IEC 17025:2017 §6.2.6 — certificate sign-off must be done by personnel
 * authorized for that scope. This is DISTINCT from execution competence: a
 * quality/technical manager commonly signs across scopes without holding a
 * per-asset-type execution competence. See `authorized_signatory` in the schema.
 */

export interface SignatoryAuthorizationRecord {
  assetTypeId: number | null;
  expiresAt: Date | null;
}

/**
 * Pure rule: does any of the approver's ACTIVE authorizations cover this asset
 * type? An org-wide authorization (assetTypeId === null) covers every scope; an
 * expired authorization never counts.
 */
export function isAuthorizedToSign(
  records: SignatoryAuthorizationRecord[],
  assetTypeId: number | null,
  now: Date,
): boolean {
  return records.some((record) => {
    if (record.expiresAt && record.expiresAt < now) return false;
    if (record.assetTypeId === null) return true;
    return assetTypeId !== null && record.assetTypeId === assetTypeId;
  });
}

export interface SignatoryGateResult {
  ok: boolean;
  /** True when the org maintains a signatory roster (the gate is active). */
  enforced: boolean;
}

/**
 * Authorized-signatory gate for approval. Auto-detected: when the org has zero
 * ACTIVE signatory records the gate is a no-op (`ok: true, enforced: false`), so
 * orgs that don't use the roster are unaffected — mirroring the personnel
 * competence gate.
 */
export async function checkApproverIsAuthorizedSignatory(params: {
  organizationId: string;
  approverId: string;
  assetId: number;
}): Promise<SignatoryGateResult> {
  const [orgCount] = await db
    .select({ total: count() })
    .from(authorizedSignatory)
    .where(
      and(
        eq(authorizedSignatory.organizationId, params.organizationId),
        eq(authorizedSignatory.status, "ACTIVE"),
        isNull(authorizedSignatory.deletedAt),
      ),
    );

  if ((orgCount?.total ?? 0) === 0) {
    return { ok: true, enforced: false };
  }

  const [assetRow] = await db
    .select({ assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(eq(asset.id, params.assetId))
    .limit(1);

  const records = await db
    .select({
      assetTypeId: authorizedSignatory.assetTypeId,
      expiresAt: authorizedSignatory.expiresAt,
    })
    .from(authorizedSignatory)
    .where(
      and(
        eq(authorizedSignatory.organizationId, params.organizationId),
        eq(authorizedSignatory.userId, params.approverId),
        eq(authorizedSignatory.status, "ACTIVE"),
        isNull(authorizedSignatory.deletedAt),
      ),
    );

  return {
    ok: isAuthorizedToSign(records, assetRow?.assetTypeId ?? null, new Date()),
    enforced: true,
  };
}
