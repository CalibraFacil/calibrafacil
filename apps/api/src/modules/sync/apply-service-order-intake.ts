import { toRecord } from "@calibra-facil/shared/record";
import { asset, customer } from "@calibra-facil/db/schema";
import { CreateServiceOrderSchema } from "@calibra-facil/schemas";
import { and, eq } from "drizzle-orm";
import {
  isAssignableTechnician,
  serviceOrderBelongsToOrganization,
} from "../../lib/tenant-refs";
import { getNumber } from "./helpers";
import { createInitialServiceOrderRecords } from "../../lib/service-order-workflow";
import {
  type ApplyDesktopSyncEventInput,
  type ApplyDesktopSyncEventResult,
} from "./desktop-event-support";
import {
  findDesktopSyncRemoteEntityId,
  writeDesktopSyncAudit,
} from "./desktop-sync-support";
import {
  DESKTOP_SERVICE_ORDER_NULLABLE_KEYS,
  stripDesktopNullEntries,
} from "./desktop-schemas";
import { parseSyncDate } from "./snapshot-parsers";

export async function applyCreateLocalServiceOrderIntake(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
    input.o,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = toRecord(input.event.payload);
  const parseResult = CreateServiceOrderSchema.safeParse(
    stripDesktopNullEntries(payload, DESKTOP_SERVICE_ORDER_NULLABLE_KEYS),
  );
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order intake event is invalid.",
    };
  }

  const values = parseResult.data;
  const unitId =
    input.event.unitId ??
    getNumber(payload, "unitId") ??
    input.memberData.activeUnitId ??
    input.memberData.accessibleUnitIds[0];
  if (!unitId) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop service-order intake event is missing a unit.",
    };
  }

  const [assetRow] = await input.o
    .select({
      id: asset.id,
      unitId: asset.unitId,
      customerId: asset.customerId,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(
      and(
        eq(asset.id, values.assetId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);

  if (
    !assetRow ||
    assetRow.customerId !== values.customerId ||
    assetRow.labOrganizationId !== input.memberData.organizationId ||
    !input.memberData.accessibleUnitIds.includes(unitId)
  ) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Ativo ou cliente invalido para esta OS",
    };
  }

  // The responsible technician and source OS are payload-supplied ids: they
  // must belong to the pushing member's organization (same guard as the cloud
  // `POST /service-orders`).
  if (
    values.responsibleTechnicianId &&
    !(await isAssignableTechnician(
      {
        organizationId: input.memberData.organizationId,
        userId: values.responsibleTechnicianId,
        unitId,
      },
      input.o,
    ))
  ) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Tecnico nao encontrado ou sem permissao",
    };
  }
  if (
    values.sourceServiceOrderId &&
    !(await serviceOrderBelongsToOrganization(
      input.memberData.organizationId,
      values.sourceServiceOrderId,
      input.o,
    ))
  ) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "OS de origem nao encontrada",
    };
  }

  const created = await createInitialServiceOrderRecords(
    {
      organizationId: input.memberData.organizationId,
      unitId,
      customerId: values.customerId,
      assetId: values.assetId,
      userId: actorUserId,
      // Desktop payloads send an absent snapshot as explicit null; the intake
      // creator expects undefined for "none".
      assetSnapshot: values.assetSnapshot ?? undefined,
      signatureData: values.signatureData ?? null,
      values: {
        clientContactId: values.clientContactId ?? null,
        clientContactSnapshot: values.clientContactSnapshot ?? null,
        intakeType: values.intakeType,
        sourceServiceOrderId: values.sourceServiceOrderId ?? null,
        priority: values.priority,
        responsibleTechnicianId: values.responsibleTechnicianId ?? null,
        claimedDefect: values.claimedDefect,
        intakeCondition: values.intakeCondition,
        accessories: values.accessories ?? null,
        removedSealingMarkNumber: values.removedSealingMarkNumber ?? null,
        affixedSealingMarkNumber: values.affixedSealingMarkNumber ?? null,
        inmetroRepairMarkNumber: values.inmetroRepairMarkNumber ?? null,
        invoiceRemittanceNumber: values.invoiceRemittanceNumber ?? null,
        invoiceRemittanceKey: values.invoiceRemittanceKey ?? null,
        invoiceRemittanceIssuedAt: parseSyncDate(
          values.invoiceRemittanceIssuedAt,
        ),
        carrierName: values.carrierName ?? null,
        carrierDocument: values.carrierDocument ?? null,
        thirdPartyName: values.thirdPartyName ?? null,
        thirdPartyDocument: values.thirdPartyDocument ?? null,
        thirdPartyPhone: values.thirdPartyPhone ?? null,
        deliveryMethod: values.deliveryMethod,
        internalNotes: values.internalNotes ?? null,
        clientVisibleNotes: values.clientVisibleNotes ?? null,
        evaluationFeeCents: values.evaluationFeeCents,
        warrantyUntil: parseSyncDate(values.warrantyUntil),
        warrantyTerms: values.warrantyTerms ?? null,
      },
    },
    input.o,
  );

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: created.id,
    remoteServiceOrderNumber: created.serviceOrderNumber,
  });

  return {
    ok: true,
    remoteEntityId: created.id,
    remoteEntity: {
      id: created.id,
      serviceOrderNumber: created.serviceOrderNumber,
      status: created.status,
      openedAt: created.openedAt?.toISOString?.() ?? created.openedAt,
    },
  };
}
