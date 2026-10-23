import { db } from "@calibra-facil/db";
import { customer, customerAuditLog } from "@calibra-facil/db/schema";
import {
  CreateCustomerSchema,
  UpdateComplianceSchema,
  UpdateCustomerSchema,
} from "@calibra-facil/schemas";
import { and, eq } from "drizzle-orm";
import { asRecord, getNumber } from "./helpers";
import {
  loadCustomerActiveCommercialAgreement,
  syncComplianceWithActiveAgreement,
} from "../../lib/finance";
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

export async function applyCreateLocalCustomer(
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
  const parseResult = CreateCustomerSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop customer event is invalid.",
    };
  }

  const values = parseResult.data;
  // Created before this transaction (see PreparedDesktopEventSideEffects).
  const clientOrganizationId = input.prepared.clientOrganizationId;
  if (!clientOrganizationId) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Falha ao criar organizacao do cliente",
    };
  }

  const newCustomer = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customer)
      .values({
        name: values.name,
        taxId: values.taxId || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        authOrganizationId: clientOrganizationId,
        labOrganizationId: input.memberData.organizationId,
      })
      .returning();

    if (!created) throw new Error("Erro ao criar cliente");

    await tx.insert(customerAuditLog).values({
      organizationId: created.labOrganizationId,
      customerId: created.id,
      action: "create",
      changes: {
        source: "desktop_sync",
        customer: { old: null, new: created },
      },
      performedBy: actorUserId,
    });

    return created;
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: newCustomer.id,
    remoteCustomerName: newCustomer.name,
    remoteAuthOrganizationId: newCustomer.authOrganizationId,
  });

  return {
    ok: true,
    remoteEntityId: newCustomer.id,
    remoteEntity: {
      id: newCustomer.id,
      name: newCustomer.name,
      taxId: newCustomer.taxId,
      email: newCustomer.email,
      authOrganizationId: newCustomer.authOrganizationId,
    },
  };
}

export async function applyUpdateLocalCustomer(
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
      reason: "Cliente desktop ainda nao possui ID remoto para atualizar.",
    };
  }

  const parseResult = UpdateCustomerSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop customer update event is invalid.",
    };
  }

  const values = parseResult.data;
  const [existing] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente nao encontrado para atualizacao desktop.",
    };
  }

  // REL-01 slice 2: refuse to blind-overwrite a cloud customer that advanced
  // since the desktop pulled its base (REQ-REL-SYNC-201). Legacy/null base
  // applies as today (REQ-REL-SYNC-203); equal/unchanged applies
  // (REQ-REL-SYNC-202).
  const customerStaleBase = detectStaleDesktopBase({
    baseUpdatedAt: input.event.baseUpdatedAt,
    serverUpdatedAt: existing.updatedAt,
  });
  if (customerStaleBase.diverged) {
    return buildStaleDesktopBaseConflict({
      entity: "customer",
      id: existing.id,
      serverUpdatedAtIso: customerStaleBase.serverUpdatedAtIso,
      baseUpdatedAt: customerStaleBase.baseUpdatedAt,
      remoteFields: {
        name: existing.name,
        taxId: existing.taxId,
        email: existing.email,
        phone: existing.phone,
      },
    });
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const [key, value] of Object.entries(values)) {
    const oldValue = Reflect.get(existing, key);
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      changes[key] = { old: oldValue, new: value };
    }
  }

  const updatedCustomer = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customer)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customer.id, remoteEntityId),
          eq(customer.labOrganizationId, input.memberData.organizationId),
        ),
      )
      .returning();

    if (!updated) throw new Error("Erro ao atualizar cliente");

    if (Object.keys(changes).length > 0) {
      await tx.insert(customerAuditLog).values({
        organizationId: input.memberData.organizationId,
        customerId: remoteEntityId,
        action: "update",
        changes: {
          source: "desktop_sync",
          fields: changes,
        },
        performedBy: actorUserId,
      });
    }

    return updated;
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: updatedCustomer.id,
    remoteCustomerName: updatedCustomer.name,
  });

  return {
    ok: true,
    remoteEntityId: updatedCustomer.id,
    remoteEntity: {
      id: updatedCustomer.id,
      name: updatedCustomer.name,
      taxId: updatedCustomer.taxId,
      email: updatedCustomer.email,
      authOrganizationId: updatedCustomer.authOrganizationId,
      // REL-01 slice 3 (REQ-REL-RES-002): carry the persisted updatedAt so the
      // desktop refreshes remote_base_updated_at on accept.
      updatedAt:
        updatedCustomer.updatedAt?.toISOString?.() ?? updatedCustomer.updatedAt,
    },
  };
}

export async function applyUpdateLocalCustomerCompliance(
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
      reason: "Cliente desktop ainda nao possui ID remoto para conformidade.",
    };
  }

  const parseResult = UpdateComplianceSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop customer compliance event is invalid.",
    };
  }

  const { compliance, reason } = parseResult.data;
  const [existing] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente nao encontrado para conformidade desktop.",
    };
  }

  const baseCompliance = existing.compliance ?? {
    qualificationStatus: "pending" as const,
    qualityRequirementsAcknowledged: false,
  };
  const mergedCompliance = {
    ...baseCompliance,
    ...compliance,
    qualificationStatus:
      compliance.qualificationStatus ??
      baseCompliance.qualificationStatus ??
      ("pending" as const),
    qualityRequirementsAcknowledged:
      compliance.qualityRequirementsAcknowledged ??
      baseCompliance.qualityRequirementsAcknowledged ??
      false,
    ...(compliance.qualityRequirementsAcknowledged &&
    !baseCompliance.qualityRequirementsAcknowledged
      ? { qualityRequirementsAcknowledgedAt: new Date().toISOString() }
      : {}),
  };
  const activeCommercialAgreement = await loadCustomerActiveCommercialAgreement(
    input.memberData.organizationId,
    remoteEntityId,
  );
  const updatedCompliance = syncComplianceWithActiveAgreement(
    mergedCompliance,
    activeCommercialAgreement,
  );

  const [updatedCustomer] = await db
    .update(customer)
    .set({
      compliance: updatedCompliance,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customer.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .returning();

  if (!updatedCustomer) throw new Error("Erro ao atualizar conformidade");

  await db.insert(customerAuditLog).values({
    organizationId: input.memberData.organizationId,
    customerId: remoteEntityId,
    action: "compliance_change",
    changes: { old: existing.compliance, new: updatedCompliance },
    performedBy: actorUserId,
    reason,
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: updatedCustomer.id,
    remoteCustomerName: updatedCustomer.name,
  });

  return {
    ok: true,
    remoteEntityId: updatedCustomer.id,
    remoteEntity: {
      id: updatedCustomer.id,
      name: updatedCustomer.name,
      taxId: updatedCustomer.taxId,
      email: updatedCustomer.email,
      compliance: updatedCustomer.compliance,
    },
  };
}
