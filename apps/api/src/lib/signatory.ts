import { db } from "@calibra-facil/db";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
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

export type SignatoryGateResult =
  | {
      ok: true;
      /** True when the org maintains a signatory roster (the gate is active). */
      enforced: boolean;
    }
  | {
      ok: false;
      enforced: true;
      /**
       * `empty_roster`: the laboratory must keep a roster (accredited) and has no
       * active record, so nobody is authorized to sign. `not_authorized`: the
       * roster exists and does not name the approver for this instrument type.
       */
      reason: "empty_roster" | "not_authorized";
    };

/**
 * Authorized-signatory gate for approval.
 *
 * Optional for a laboratory that is not accredited: auto-detected, so when it
 * has zero ACTIVE signatory records the gate is a no-op (`ok: true, enforced:
 * false`) and orgs that don't use the roster are unaffected. MANDATORY for an
 * accredited laboratory (`mandatory: true`, roadmap 2 B5, decision Q45): an
 * empty roster means nobody is authorized to sign, so it fails CLOSED
 * (`empty_roster`) instead of letting every approver through.
 */
export async function checkApproverIsAuthorizedSignatory(
  params: {
    organizationId: string;
    approverId: string;
    assetId: number;
    /** The laboratory must keep a roster (it is accredited). Default: false. */
    mandatory?: boolean;
  },
  /** The org-bound handle of the caller's transaction (row-level security). */
  executor: Pick<OrgExecutor, "select"> = db,
): Promise<SignatoryGateResult> {
  const [orgCount] = await executor
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
    return params.mandatory
      ? { ok: false, enforced: true, reason: "empty_roster" }
      : { ok: true, enforced: false };
  }

  const [assetRow] = await executor
    .select({ assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(
      and(
        eq(asset.id, params.assetId),
        eq(asset.labOrganizationId, params.organizationId),
      ),
    )
    .limit(1);

  const records = await executor
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

  return isAuthorizedToSign(records, assetRow?.assetTypeId ?? null, new Date())
    ? { ok: true, enforced: true }
    : { ok: false, enforced: true, reason: "not_authorized" };
}
