import type { OrgDb } from "@calibra-facil/db/for-org";
import { asset, customer } from "@calibra-facil/db/schema";
import {
  RegulatedIntervalSchema,
  type CreateAssetInput,
} from "@calibra-facil/schemas";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { findAssetTypeById } from "./asset-types";
import {
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "./asset-measurement";
import { resolveAssetRegimeWrite } from "./asset-regime";
import { DomainError, invalid, notFound } from "./domain-errors";
import type { OrgContext } from "./org-context";
import { deriveRegulatedNextDate } from "./regulated-interval";

/**
 * The asset writes of a laboratory, shared by the lab routes
 * (`routes/assets.ts`) and the public API v2 (`routes/public-api-v2/assets-*.ts`).
 */

type AssetRow = typeof asset.$inferSelect;

/**
 * Throws 400 `asset_tag_conflict` when the laboratory already has an asset with
 * this tag. SEC-03a: scoped to the caller's org (join asset -> customer), so it
 * cannot read another tenant's assets. A SAME-org race that slips past it hits
 * the per-org unique (`asset_lab_org_tag_uidx`, 23505): the caller maps that
 * violation to the same refusal.
 */
export async function assertAssetTagFree(
  o: Pick<OrgDb, "select">,
  labOrganizationId: string,
  tag: string,
  message = "Tag já está em uso",
) {
  const [existing] = await o
    .select({ id: asset.id })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(
      and(
        eq(asset.tag, tag),
        eq(customer.labOrganizationId, labOrganizationId),
      ),
    )
    .limit(1);
  if (existing) throw invalid("asset_tag_conflict", message);
}

type CreateLabAssetOptions = {
  /**
   * The unit the asset belongs to, resolved once the customer, the type and the
   * tag have been checked (the lab passes its active unit; the public API
   * resolves it from the request or the key's single unit).
   */
  resolveUnitId: () => Promise<number>;
  /**
   * Refuse an input that leaves a required field of the asset type's
   * specification definition empty. The lab enforces it; the public API never
   * did and keeps its contract.
   */
  enforceRequiredSpecifications: boolean;
};

/**
 * Creates the laboratory's asset and its `create` audit row. Throws 404
 * `customer_not_found` / `asset_type_not_found`, 400 `asset_tag_conflict`,
 * `asset_base_measurement_unit_required` and (when enforced) `invalid_request`.
 *
 * The lab does NOT set the next-calibration date / interval: that periodicity
 * is the customer's decision, set in the portal (ISO/IEC 17025:2017 §7.8.4.3 +
 * ILAC-G24); the field is not part of the schema, so a client-sent value is
 * stripped, never persisted.
 */
export async function createLabAsset(
  ctx: OrgContext,
  input: CreateAssetInput,
  options: CreateLabAssetOptions,
) {
  const [foundCustomer] = await ctx.o
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, input.customerId),
        eq(customer.labOrganizationId, ctx.org),
      ),
    )
    .limit(1);
  if (!foundCustomer) {
    throw notFound("customer_not_found", "Cliente não encontrado");
  }

  // Global catalog (no organization column).
  const foundAssetType = await findAssetTypeById(input.assetTypeId, ctx.o);
  if (!foundAssetType) {
    throw notFound(
      "asset_type_not_found",
      "Tipo de instrumento não encontrado",
    );
  }

  await assertAssetTagFree(ctx.o, ctx.org, input.tag);

  const unitId = await options.resolveUnitId();
  const baseMeasurementUnitResult = resolveAssetBaseMeasurementUnit(
    foundAssetType,
    input.baseMeasurementUnit,
  );
  if (!baseMeasurementUnitResult.ok) {
    throw invalid(
      "asset_base_measurement_unit_required",
      baseMeasurementUnitResult.error,
    );
  }

  if (
    options.enforceRequiredSpecifications &&
    foundAssetType.definition &&
    input.specifications
  ) {
    for (const field of foundAssetType.definition) {
      if (!field.required) continue;
      const value = input.specifications[field.key];
      if (value === undefined || value === null || value === "") {
        throw invalid("invalid_request", `Campo obrigatório: ${field.label}`);
      }
    }
  }

  const lastCalibrationDate = input.lastCalibrationDate
    ? new Date(input.lastCalibrationDate)
    : null;
  // Installation date anchors the legal-metrology verification ceiling
  // (regulated_interval.kind = 'max_months_from_install'). (REQ-INSTALL-002/003)
  const installedAt = input.installedAt ? new Date(input.installedAt) : null;
  const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
    specifications: input.specifications || null,
    definition: foundAssetType.definition,
    baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
  });

  // Legal-metrology regime (Track 2): the regime + the regulation-fixed
  // verification periodicity, independent of the customer-owned calibration
  // interval (Track 1), which the lab never authors. (REQ-MLR-030/031/003)
  const regimeWrite = resolveAssetRegimeWrite({
    metrologyRegime: input.metrologyRegime,
    regulatedInterval: input.regulatedInterval,
    current: { metrologyRegime: "INDUSTRIAL", regulatedInterval: null },
  });
  const nextLegalVerificationDate = regimeWrite.regulatedInterval
    ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
        lastVerificationDate: lastCalibrationDate,
        firstVerificationDate: lastCalibrationDate,
        installDate: installedAt,
      }).date
    : null;

  const [created] = await ctx.o
    .insert(asset)
    .values({
      unitId,
      customerId: foundCustomer.id,
      // SEC-03b (#638): denormalize the lab org from the (already org-scoped)
      // customer so UNIQUE(lab_organization_id, tag) is enforced per org.
      labOrganizationId: foundCustomer.labOrganizationId,
      assetTypeId: input.assetTypeId,
      name: input.name,
      manufacturer: input.manufacturer || null,
      model: input.model || null,
      serialNumber: input.serialNumber,
      tag: input.tag,
      status: input.status || "ACTIVE",
      baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
      lastCalibrationDate,
      installedAt,
      comments: input.comments || null,
      specifications: normalizedSpecifications.specifications || null,
      metrologyRegime: regimeWrite.metrologyRegime,
      regulatedInterval: regimeWrite.regulatedInterval,
      nextLegalVerificationDate,
    })
    .returning();

  if (!created) {
    throw new DomainError({
      code: "asset_create_failed",
      status: 500,
      message: "Erro ao criar ativo",
    });
  }

  await ctx.audit("asset", created.id, {
    action: "create",
    changes: {
      asset: { old: null, new: created },
      unitConversions:
        normalizedSpecifications.conversions.length > 0
          ? normalizedSpecifications.conversions
          : undefined,
    },
  });

  return { created, assetType: foundAssetType };
}

type AssetRegimeAnchors = Pick<
  AssetRow,
  | "metrologyRegime"
  | "regulatedInterval"
  | "lastCalibrationDate"
  | "installedAt"
>;

/**
 * The regime columns an asset update has to rewrite, or `null` when it touches
 * none of the inputs the legal-metrology regime depends on: the regime, the
 * regulated interval, the install anchor (a standalone `installedAt` change must
 * re-derive `next_legal_verification_date` for an install-anchored LEGAL asset)
 * and the last-calibration date (the stored proxy for the last-verification
 * anchor: without it an anchor-based regulated date goes stale after a
 * verification is recorded). Independent of Track 1 (the customer-owned
 * calibration interval). (REQ-MLR-030/031/032 + REQ-INSTALL-002)
 *
 * `lastCalibrationDate` and `installedAt` are `undefined` when the update does
 * not send them, `null` when it clears them.
 */
export function planAssetRegimeUpdate(
  existing: AssetRegimeAnchors,
  input: {
    metrologyRegime: AssetRow["metrologyRegime"] | undefined;
    regulatedInterval: Parameters<
      typeof resolveAssetRegimeWrite
    >[0]["regulatedInterval"];
    lastCalibrationDate: Date | null | undefined;
    installedAt: Date | null | undefined;
  },
) {
  const touched =
    input.metrologyRegime !== undefined ||
    input.regulatedInterval !== undefined ||
    input.installedAt !== undefined ||
    input.lastCalibrationDate !== undefined;
  if (!touched) return null;

  const parsedCurrent = RegulatedIntervalSchema.safeParse(
    existing.regulatedInterval,
  );
  const regimeWrite = resolveAssetRegimeWrite({
    metrologyRegime: input.metrologyRegime,
    regulatedInterval: input.regulatedInterval,
    current: {
      metrologyRegime: existing.metrologyRegime,
      regulatedInterval: parsedCurrent.success ? parsedCurrent.data : null,
    },
  });
  // The anchors are the sent values, else the stored ones; never fabricated
  // when absent. (REQ-INSTALL-002/003)
  const anchorDate =
    (input.lastCalibrationDate !== undefined
      ? input.lastCalibrationDate
      : existing.lastCalibrationDate) ?? null;
  const installAnchor =
    (input.installedAt !== undefined
      ? input.installedAt
      : existing.installedAt) ?? null;
  return {
    metrologyRegime: regimeWrite.metrologyRegime,
    regulatedInterval: regimeWrite.regulatedInterval,
    nextLegalVerificationDate: regimeWrite.regulatedInterval
      ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
          lastVerificationDate: anchorDate,
          firstVerificationDate: anchorDate,
          installDate: installAnchor,
        }).date
      : null,
  };
}

/**
 * Soft-deletes the asset (`deletedAt`) and records the `delete` audit row.
 * `scope` narrows the row the way the caller's access does (the lab's unit
 * scope, the portal user's linked customer); throws 404 `asset_not_found` when
 * the asset is not in it (or was deleted meanwhile).
 */
export async function deleteLabAsset(
  ctx: OrgContext,
  existing: AssetRow,
  scope?: SQL,
) {
  const [deleted] = await ctx.o
    .update(asset)
    .set({ deletedAt: new Date() })
    .where(and(eq(asset.id, existing.id), scope, isNull(asset.deletedAt)))
    .returning();
  if (!deleted) throw notFound("asset_not_found", "Ativo nao encontrado");

  // TODO: Check for active calibrations before deleting
  await ctx.audit("asset", existing.id, {
    action: "delete",
    changes: { asset: { old: existing, new: null } },
  });
}
