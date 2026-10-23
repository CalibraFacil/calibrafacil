import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  customer,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveAssetRegimeWrite } from "../../lib/asset-regime";
import { deriveRegulatedNextDate } from "../../lib/regulated-interval";
import { asRecord, getNullableString, getNumber } from "./helpers";
import { createCalibrationJob } from "../../lib/jobs";
import {
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "../../lib/asset-measurement";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
} from "./desktop-event-support";
import {
  findDesktopSyncRemoteEntityId,
  writeDesktopSyncAudit,
} from "./desktop-sync-support";
import { DesktopCreateAssetSchema } from "./desktop-schemas";
import { parseSyncDate } from "./snapshot-parsers";

export async function applyCreateLocalJobDraft(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const assetId = getNumber(payload, "assetId");
  const serviceId = getNumber(payload, "serviceId");
  const unitId =
    input.event.unitId ??
    getNumber(payload, "unitId") ??
    input.memberData.activeUnitId;

  if (!assetId || !serviceId || !unitId) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop job draft event is missing asset, service, or unit.",
    };
  }

  const job = await createCalibrationJob({
    organizationId: input.memberData.organizationId,
    unitId,
    createdBy: actorUserId,
    assetId,
    serviceId,
    technicianId: getNullableString(payload, "technicianId"),
    dueDate: getNullableString(payload, "dueDate"),
    notifyOnAssignment: false,
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: job.id,
    remoteJobId: job.jobId,
  });

  return {
    ok: true,
    remoteEntityId: job.id,
    remoteEntity: {
      id: job.id,
      jobId: job.jobId,
      status: job.status,
      certificateName: job.certificateName,
    },
  };
}

export async function applyCreateLocalAsset(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const parseResult = DesktopCreateAssetSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop asset event is invalid.",
    };
  }

  const values = parseResult.data;
  const unitId = input.event.unitId ?? input.memberData.activeUnitId;
  if (!unitId) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop asset event is missing a unit.",
    };
  }

  const [foundCustomer] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, values.customerId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);

  if (!foundCustomer) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente nao encontrado",
    };
  }

  const [foundAssetType] = await db
    .select()
    .from(assetType)
    .where(eq(assetType.id, values.assetTypeId))
    .limit(1);

  if (!foundAssetType) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Tipo de instrumento nao encontrado",
    };
  }

  const baseMeasurementUnitResult = resolveAssetBaseMeasurementUnit(
    foundAssetType,
    values.baseMeasurementUnit,
  );
  if (!baseMeasurementUnitResult.ok) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: baseMeasurementUnitResult.error,
    };
  }

  if (foundAssetType.definition && values.specifications) {
    const requiredFields = foundAssetType.definition.filter(
      (field) => field.required,
    );
    for (const field of requiredFields) {
      if (
        values.specifications[field.key] === undefined ||
        values.specifications[field.key] === null ||
        values.specifications[field.key] === ""
      ) {
        return {
          ok: false,
          code: "DOMAIN_VALIDATION_FAILED",
          reason: `Campo obrigatorio: ${field.label}`,
        };
      }
    }
  }

  // SEC-03b (#638): tag uniqueness is per lab org — scope the collision check to
  // the caller's org (join asset → customer) so a desktop-created asset whose tag
  // is used only by ANOTHER lab is not falsely rejected (and cannot read/probe
  // another tenant's tags). The DB now enforces UNIQUE(lab_organization_id, tag).
  const [existingAsset] = await db
    .select({ id: asset.id })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(
      and(
        eq(asset.tag, values.tag),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);
  if (existingAsset) {
    return {
      ok: false,
      code: "TAG_ALREADY_EXISTS",
      reason: "Tag ja esta em uso",
    };
  }

  // The desktop never authors `nextCalibrationDate` — the calibration interval /
  // next-cal date is the customer's decision, set in the portal (§7.8.4.3 +
  // ILAC-G24); the field is not in the schema, so a desktop-sent value is
  // stripped and a freshly created asset lands with no next-cal date.
  const lastCalibrationDate = parseSyncDate(values.lastCalibrationDate);
  // Legal-metrology TRACK 2 (mirrors the cloud asset-create route): resolve the regime
  // trio + derive next_legal_verification_date so a desktop-created LEGAL instrument lands
  // consistent (REQ-MLR-003/030/031 + REQ-INSTALL-002), not as a half-set state.
  const installedAt = parseSyncDate(values.installedAt);
  const regimeWrite = resolveAssetRegimeWrite({
    metrologyRegime: values.metrologyRegime,
    regulatedInterval: values.regulatedInterval,
    current: { metrologyRegime: "INDUSTRIAL", regulatedInterval: null },
  });
  const nextLegalVerificationDate = regimeWrite.regulatedInterval
    ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
        lastVerificationDate: lastCalibrationDate,
        firstVerificationDate: lastCalibrationDate,
        installDate: installedAt,
      }).date
    : null;
  const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
    specifications: values.specifications || null,
    definition: foundAssetType.definition,
    baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
  });

  const newAsset = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(asset)
      .values({
        unitId,
        customerId: values.customerId,
        // SEC-03b (#638): denormalize the lab org from the (already org-scoped)
        // customer so the desktop-synced asset satisfies UNIQUE(lab_org, tag).
        // foundCustomer was fetched WHERE labOrganizationId =
        // memberData.organizationId, so this is the device's own lab org.
        labOrganizationId: foundCustomer.labOrganizationId,
        assetTypeId: values.assetTypeId,
        name: values.name,
        manufacturer: values.manufacturer || null,
        model: values.model || null,
        serialNumber: values.serialNumber,
        tag: values.tag,
        status: values.status || "ACTIVE",
        baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
        lastCalibrationDate,
        installedAt,
        comments: values.comments || null,
        specifications: normalizedSpecifications.specifications || null,
        metrologyRegime: regimeWrite.metrologyRegime,
        regulatedInterval: regimeWrite.regulatedInterval,
        nextLegalVerificationDate,
      })
      .returning();

    if (!created) throw new Error("Erro ao criar ativo");

    await tx.insert(assetAuditLog).values({
      organizationId: created.labOrganizationId,
      assetId: created.id,
      action: "create",
      changes: {
        source: "desktop_sync",
        asset: { old: null, new: created },
        unitConversions:
          normalizedSpecifications.conversions.length > 0
            ? normalizedSpecifications.conversions
            : undefined,
      },
      performedBy: actorUserId,
    });

    return created;
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: newAsset.id,
    remoteAssetTag: newAsset.tag,
  });

  return {
    ok: true,
    remoteEntityId: newAsset.id,
    remoteEntity: {
      id: newAsset.id,
      tag: newAsset.tag,
      status: newAsset.status,
    },
  };
}
