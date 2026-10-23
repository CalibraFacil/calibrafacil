import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  customer,
} from "@calibra-facil/db/schema";
import { RegulatedIntervalSchema } from "@calibra-facil/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { resolveAssetRegimeWrite } from "../../lib/asset-regime";
import { deriveRegulatedNextDate } from "../../lib/regulated-interval";
import { deriveNextCalibrationDate } from "../../lib/portal-asset-interval";
import { asRecord, getNumber } from "./helpers";
import { normalizeAssetSpecificationsFromInput } from "../../lib/asset-measurement";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
  buildStaleDesktopBaseConflict,
  detectStaleDesktopBase,
} from "./desktop-event-support";
import {
  findDesktopSyncRemoteEntityId,
  writeDesktopSyncAudit,
} from "./desktop-sync-support";
import { DesktopUpdateAssetSchema } from "./desktop-schemas";
import { parseSyncDate } from "./snapshot-parsers";

export async function applyUpdateLocalAsset(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const mappedRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  const remoteEntityId =
    typeof mappedRemoteEntityId === "number"
      ? mappedRemoteEntityId
      : getNumber(payload, "remoteId");

  if (remoteEntityId === null) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Ativo desktop ainda nao possui ID remoto para atualizar.",
    };
  }

  const parseResult = DesktopUpdateAssetSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop asset update event is invalid.",
    };
  }

  const values = parseResult.data;
  const [existingAsset] = await db
    .select({
      id: asset.id,
      customerId: asset.customerId,
      name: asset.name,
      manufacturer: asset.manufacturer,
      model: asset.model,
      serialNumber: asset.serialNumber,
      tag: asset.tag,
      status: asset.status,
      baseMeasurementUnit: asset.baseMeasurementUnit,
      lastCalibrationDate: asset.lastCalibrationDate,
      nextCalibrationDate: asset.nextCalibrationDate,
      calibrationIntervalMonths: asset.calibrationIntervalMonths,
      comments: asset.comments,
      specifications: asset.specifications,
      metrologyRegime: asset.metrologyRegime,
      regulatedInterval: asset.regulatedInterval,
      installedAt: asset.installedAt,
      updatedAt: asset.updatedAt,
      assetTypeDefinition: assetType.definition,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
    .where(
      and(
        eq(asset.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
        isNull(asset.deletedAt),
      ),
    )
    .limit(1);

  if (!existingAsset) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Ativo nao encontrado para atualizacao desktop.",
    };
  }

  // REL-01 slice 2: refuse to blind-overwrite a cloud asset that advanced since
  // the desktop pulled its base (REQ-REL-SYNC-201). Legacy/null base applies as
  // today (REQ-REL-SYNC-203); equal/unchanged applies (REQ-REL-SYNC-202).
  const assetStaleBase = detectStaleDesktopBase({
    baseUpdatedAt: input.event.baseUpdatedAt,
    serverUpdatedAt: existingAsset.updatedAt,
  });
  if (assetStaleBase.diverged) {
    return buildStaleDesktopBaseConflict({
      entity: "asset",
      id: existingAsset.id,
      serverUpdatedAtIso: assetStaleBase.serverUpdatedAtIso,
      baseUpdatedAt: assetStaleBase.baseUpdatedAt,
      remoteFields: {
        tag: existingAsset.tag,
        name: existingAsset.name,
        serialNumber: existingAsset.serialNumber,
        manufacturer: existingAsset.manufacturer,
        model: existingAsset.model,
        status: existingAsset.status,
      },
    });
  }

  if (values.tag && values.tag !== existingAsset.tag) {
    // SEC-03b (#638): tag uniqueness is per lab org — scope this rename check to
    // the caller's org (join asset -> customer), same pattern as
    // applyCreateLocalAsset above. Unscoped, this both over-rejected a legitimate
    // rename to a tag only ANOTHER lab holds (the DB composite unique would allow
    // it) and re-exposed the cross-tenant existence oracle on the desktop-rename
    // path.
    //
    // Race note: a same-org duplicate rename that slips past this check (a true
    // concurrent race) would hit the DB composite unique (asset_lab_org_tag_uidx)
    // and throw 23505 from the .update() below. That error propagates up to
    // applyDesktopSyncEvent's outer try/catch, which already turns ANY thrown
    // error into a structured `{ ok: false, code: "DESKTOP_SYNC_APPLY_FAILED",
    // reason }` rejected-event result -- never a 500, never a crashed batch --
    // so no additional isUniqueViolation mapping is added here. This mirrors
    // applyCreateLocalAsset, which relies on the same generic catch for its own
    // DB-level race and was not given an explicit 23505 mapping either.
    const [duplicateTag] = await db
      .select({ id: asset.id })
      .from(asset)
      .innerJoin(customer, eq(asset.customerId, customer.id))
      .where(
        and(
          eq(asset.tag, values.tag),
          eq(customer.labOrganizationId, input.memberData.organizationId),
          isNull(asset.deletedAt),
        ),
      )
      .limit(1);

    if (duplicateTag && duplicateTag.id !== existingAsset.id) {
      return {
        ok: false,
        code: "TAG_ALREADY_EXISTS",
        reason: "Tag ja esta em uso",
      };
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (values.name !== undefined) updateData.name = values.name;
  if (values.manufacturer !== undefined)
    updateData.manufacturer = values.manufacturer || null;
  if (values.model !== undefined) updateData.model = values.model || null;
  if (values.serialNumber !== undefined)
    updateData.serialNumber = values.serialNumber;
  if (values.tag !== undefined) updateData.tag = values.tag;
  if (values.status !== undefined) updateData.status = values.status;
  if (values.lastCalibrationDate !== undefined) {
    const lastCalibrationDate = parseSyncDate(values.lastCalibrationDate);
    updateData.lastCalibrationDate = lastCalibrationDate;
    // The desktop never authors `nextCalibrationDate` (customer-owned, §7.8.4.3);
    // mirror the cloud asset-update route: next = last + customer interval,
    // null when no interval has been set (REQ-INTERVAL-003).
    updateData.nextCalibrationDate =
      existingAsset.calibrationIntervalMonths === null
        ? null
        : deriveNextCalibrationDate(
            lastCalibrationDate,
            existingAsset.calibrationIntervalMonths,
          );
  }
  if (values.comments !== undefined)
    updateData.comments = values.comments || null;
  // Track-2 install anchor (only persisted when the desktop event provides it).
  const installedAtUpdate =
    values.installedAt !== undefined
      ? parseSyncDate(values.installedAt)
      : undefined;
  if (installedAtUpdate !== undefined) {
    updateData.installedAt = installedAtUpdate;
  }
  // Legal-metrology regime (mirrors the cloud asset-update route): recompute the regime +
  // next_legal_verification_date when the desktop event touches the regime, the regulated
  // interval, the install anchor, OR the last-calibration date (the stored proxy for the
  // last-verification anchor). Keeps the regime columns mutually consistent
  // (REQ-MLR-030/031/032 + REQ-INSTALL-002).
  if (
    values.metrologyRegime !== undefined ||
    values.regulatedInterval !== undefined ||
    installedAtUpdate !== undefined ||
    values.lastCalibrationDate !== undefined
  ) {
    const parsedCurrent = RegulatedIntervalSchema.safeParse(
      existingAsset.regulatedInterval,
    );
    const regimeWrite = resolveAssetRegimeWrite({
      metrologyRegime: values.metrologyRegime,
      regulatedInterval: values.regulatedInterval,
      current: {
        metrologyRegime: existingAsset.metrologyRegime,
        regulatedInterval: parsedCurrent.success ? parsedCurrent.data : null,
      },
    });
    updateData.metrologyRegime = regimeWrite.metrologyRegime;
    updateData.regulatedInterval = regimeWrite.regulatedInterval;
    const anchorDate =
      (values.lastCalibrationDate !== undefined
        ? parseSyncDate(values.lastCalibrationDate)
        : existingAsset.lastCalibrationDate) ?? null;
    const installAnchor =
      (installedAtUpdate !== undefined
        ? installedAtUpdate
        : existingAsset.installedAt) ?? null;
    updateData.nextLegalVerificationDate = regimeWrite.regulatedInterval
      ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
          lastVerificationDate: anchorDate,
          firstVerificationDate: anchorDate,
          installDate: installAnchor,
        }).date
      : null;
  }
  if (values.specifications !== undefined) {
    const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
      specifications: values.specifications || null,
      definition: existingAsset.assetTypeDefinition,
      baseMeasurementUnit: existingAsset.baseMeasurementUnit,
    });
    updateData.specifications = normalizedSpecifications.specifications || null;
    if (normalizedSpecifications.conversions.length > 0) {
      changes.unitConversions = {
        old: null,
        new: normalizedSpecifications.conversions,
      };
    }
  }

  for (const [key, value] of Object.entries(updateData)) {
    if (key === "updatedAt") continue;
    const oldValue = Reflect.get(existingAsset, key);
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      changes[key] = { old: oldValue, new: value };
    }
  }

  const [updatedAsset] = await db
    .update(asset)
    .set(updateData)
    .where(and(eq(asset.id, remoteEntityId), isNull(asset.deletedAt)))
    .returning();

  if (!updatedAsset) throw new Error("Erro ao atualizar ativo");

  if (Object.keys(changes).length > 0) {
    await db.insert(assetAuditLog).values({
      organizationId: updatedAsset.labOrganizationId,
      assetId: remoteEntityId,
      action: "status" in changes ? "status_change" : "update",
      changes,
      performedBy: actorUserId,
    });
  }

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: updatedAsset.id,
    remoteAssetTag: updatedAsset.tag,
  });

  return {
    ok: true,
    remoteEntityId: updatedAsset.id,
    remoteEntity: {
      id: updatedAsset.id,
      tag: updatedAsset.tag,
      status: updatedAsset.status,
      // REL-01 slice 3 (REQ-REL-RES-002): carry the persisted updatedAt so the
      // desktop refreshes remote_base_updated_at on accept (no false self-
      // conflict on the next same-device edit before the next pull).
      updatedAt:
        updatedAsset.updatedAt?.toISOString?.() ?? updatedAsset.updatedAt,
    },
  };
}
