import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

type JsonRecord = Record<string, unknown>;

export type LocalServiceOrderStatus =
  | "opened"
  | "awaiting_tech_evaluation"
  | "under_evaluation"
  | "awaiting_quote_approval"
  | "quote_approved"
  | "quote_rejected"
  | "repair_in_progress"
  | "awaiting_calibration"
  | "calibration_in_progress"
  | "awaiting_final_review"
  | "ready_for_pickup"
  | "delivered"
  | "closed"
  | "canceled"
  | "warranty_return";

export type LocalServiceOrderPriority =
  | "normal"
  | "urgent"
  | "contract"
  | "warranty";

export type LocalServiceOrderIntakeType =
  | "counter"
  | "carrier"
  | "third_party"
  | "internal"
  | "warranty_return";

export type LocalServiceOrderDeliveryMethod =
  | "pickup_at_lab"
  | "ship_to_client"
  | "third_party_pickup";

export type LocalServiceOrderItemType =
  | "service"
  | "part"
  | "external_service"
  | "freight"
  | "discount"
  | "evaluation_fee"
  | "other";

export type LocalServiceOrderExecutionResult =
  | "repaired"
  | "not_repaired"
  | "condemned"
  | "returned_without_service"
  | "sent_to_third_party";

export type LocalServiceOrderPricedItemInput = {
  type: LocalServiceOrderItemType;
  description: string;
  materialId?: number | null;
  quantity: number;
  unit?: string;
  unitCostCents?: number;
  unitPriceCents: number;
  taxable?: boolean;
  warrantyCovered?: boolean;
  warrantyUntil?: string | null;
  warrantyTerms?: string | null;
  notes?: string | null;
};

export type CreateLocalServiceOrderIntakeInput = {
  organizationId?: string | null;
  unitId?: number | null;
  actorUserId?: string | null;
  deviceId?: string | null;
  customerId: number;
  clientContactId?: number | null;
  clientContactSnapshot?: JsonRecord | null;
  assetId: number;
  intakeType?: LocalServiceOrderIntakeType;
  sourceServiceOrderId?: number | null;
  priority?: LocalServiceOrderPriority;
  responsibleTechnicianId?: string | null;
  claimedDefect: string;
  intakeCondition: string;
  accessories?: string | null;
  removedSealingMarkNumber?: string | null;
  affixedSealingMarkNumber?: string | null;
  inmetroRepairMarkNumber?: string | null;
  invoiceRemittanceNumber?: string | null;
  invoiceRemittanceKey?: string | null;
  invoiceRemittanceIssuedAt?: string | null;
  carrierName?: string | null;
  carrierDocument?: string | null;
  thirdPartyName?: string | null;
  thirdPartyDocument?: string | null;
  thirdPartyPhone?: string | null;
  deliveryMethod?: "pickup_at_lab" | "ship_to_client" | "third_party_pickup";
  internalNotes?: string | null;
  clientVisibleNotes?: string | null;
  evaluationFeeCents?: number;
  warrantyUntil?: string | null;
  warrantyTerms?: string | null;
  assetSnapshot?: {
    observedIdentification?: string | null;
    photos?: string[];
  };
  signatureData?: JsonRecord | null;
};

export type LocalServiceOrdersListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: LocalServiceOrderStatus;
};

export type LocalServiceOrdersListData = {
  data: Array<{
    id: number;
    serviceOrderNumber: string;
    customerName: string | null;
    assetName: string | null;
    assetSerialNumber: string | null;
    status: LocalServiceOrderStatus;
    statusLabel: string;
    priority: LocalServiceOrderPriority;
    responsibleTechnicianName: string | null;
    openedAt: string;
    quotedAt: string | null;
    approvedAt: string | null;
    totalApprovedCents: number;
    totalQuotedCents: number;
    unitName: string | null;
    syncState: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type CreateLocalServiceOrderQuoteDraftInput = {
  routeId: string;
  actorUserId?: string | null;
  deviceId?: string | null;
  validUntil?: string | null;
  paymentTerms?: string | null;
  deliveryEstimate?: string | null;
  warrantyTerms?: string | null;
  clientMessage?: string | null;
  internalNotes?: string | null;
  items: LocalServiceOrderPricedItemInput[];
};

export type SaveLocalServiceOrderExecutionNotesInput = {
  routeId: string;
  actorUserId?: string | null;
  deviceId?: string | null;
  servicePerformed?: string | null;
  partsUsedSummary?: string | null;
  technicalNotes?: string | null;
  calibrationRequiredAfterRepair?: boolean;
  result?: LocalServiceOrderExecutionResult;
  items?: LocalServiceOrderPricedItemInput[];
};

export type CreateLocalServiceOrderDeliveryDocumentDraftInput = {
  routeId: string;
  actorUserId?: string | null;
  deviceId?: string | null;
  technicianSignatureData?: JsonRecord | null;
  clientSignatureData?: JsonRecord | null;
};

const SERVICE_ORDER_STATUS_LABELS: Record<LocalServiceOrderStatus, string> = {
  opened: "Aberta",
  awaiting_tech_evaluation: "Aguardando avaliacao",
  under_evaluation: "Em avaliacao",
  awaiting_quote_approval: "Aguardando aprovacao",
  quote_approved: "Orcamento aprovado",
  quote_rejected: "Orcamento recusado",
  repair_in_progress: "Reparo em andamento",
  awaiting_calibration: "Aguardando calibracao",
  calibration_in_progress: "Calibracao em andamento",
  awaiting_final_review: "Aguardando revisao final",
  ready_for_pickup: "Pronta para retirada",
  delivered: "Entregue",
  closed: "Fechada",
  canceled: "Cancelada",
  warranty_return: "Retorno em garantia",
};

export function createLocalServiceOrderIntake(
  database: LocalDatabase,
  input: CreateLocalServiceOrderIntakeInput,
) {
  const asset = getAssetForServiceOrderIntake(database, {
    assetId: input.assetId,
    customerId: input.customerId,
  });
  if (!asset) {
    throw new Error("Ativo ou cliente invalido para esta OS");
  }

  const now = new Date().toISOString();
  const localId = `service-order:local:${randomUUID()}`;
  const serviceOrderNumber = nextLocalServiceOrderNumber(database);
  const organizationId = input.organizationId ?? asset.organization_id;
  const unitId = input.unitId ?? asset.unit_id;
  const intakeType = input.intakeType ?? "counter";
  const priority = input.priority ?? "normal";
  const deliveryMethod = input.deliveryMethod ?? "pickup_at_lab";
  if (intakeType === "warranty_return" && !input.sourceServiceOrderId) {
    throw new Error("OS de garantia deve referenciar a OS de origem");
  }

  const status: LocalServiceOrderStatus =
    intakeType === "warranty_return"
      ? "warranty_return"
      : "awaiting_tech_evaluation";
  const snapshot = buildAssetSnapshot(asset, input.assetSnapshot);
  const payload = {
    customerId: input.customerId,
    clientContactId: input.clientContactId ?? null,
    clientContactSnapshot: input.clientContactSnapshot ?? null,
    assetId: input.assetId,
    intakeType,
    sourceServiceOrderId: input.sourceServiceOrderId ?? null,
    priority,
    responsibleTechnicianId: input.responsibleTechnicianId ?? null,
    claimedDefect: input.claimedDefect,
    intakeCondition: input.intakeCondition,
    accessories: input.accessories ?? null,
    removedSealingMarkNumber: input.removedSealingMarkNumber ?? null,
    affixedSealingMarkNumber: input.affixedSealingMarkNumber ?? null,
    inmetroRepairMarkNumber: input.inmetroRepairMarkNumber ?? null,
    invoiceRemittanceNumber: input.invoiceRemittanceNumber ?? null,
    invoiceRemittanceKey: input.invoiceRemittanceKey ?? null,
    invoiceRemittanceIssuedAt: input.invoiceRemittanceIssuedAt ?? null,
    carrierName: input.carrierName ?? null,
    carrierDocument: input.carrierDocument ?? null,
    thirdPartyName: input.thirdPartyName ?? null,
    thirdPartyDocument: input.thirdPartyDocument ?? null,
    thirdPartyPhone: input.thirdPartyPhone ?? null,
    deliveryMethod,
    internalNotes: input.internalNotes ?? null,
    clientVisibleNotes: input.clientVisibleNotes ?? null,
    evaluationFeeCents: input.evaluationFeeCents ?? 0,
    warrantyUntil: input.warrantyUntil ?? null,
    warrantyTerms: input.warrantyTerms ?? null,
    assetSnapshot: input.assetSnapshot ?? null,
    signatureData: input.signatureData ?? null,
    localServiceOrderNumber: serviceOrderNumber,
    unitId,
  };

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO service_orders (
  id,
  remote_id,
  service_order_number,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  client_contact_id,
  client_contact_snapshot_json,
  intake_type,
  source_service_order_id,
  status,
  priority,
  responsible_technician_id,
  claimed_defect,
  intake_condition,
  accessories,
  removed_sealing_mark_number,
  affixed_sealing_mark_number,
  inmetro_repair_mark_number,
  invoice_remittance_number,
  invoice_remittance_key,
  invoice_remittance_issued_at,
  carrier_name,
  carrier_document,
  third_party_name,
  third_party_document,
  third_party_phone,
  delivery_method,
  internal_notes,
  client_visible_notes,
  evaluation_fee_cents,
  warranty_until,
  warranty_terms,
  opened_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  NULL,
  @serviceOrderNumber,
  @organizationId,
  @unitId,
  @customerId,
  @assetId,
  @clientContactId,
  @clientContactSnapshotJson,
  @intakeType,
  @sourceServiceOrderId,
  @status,
  @priority,
  @responsibleTechnicianId,
  @claimedDefect,
  @intakeCondition,
  @accessories,
  @removedSealingMarkNumber,
  @affixedSealingMarkNumber,
  @inmetroRepairMarkNumber,
  @invoiceRemittanceNumber,
  @invoiceRemittanceKey,
  @invoiceRemittanceIssuedAt,
  @carrierName,
  @carrierDocument,
  @thirdPartyName,
  @thirdPartyDocument,
  @thirdPartyPhone,
  @deliveryMethod,
  @internalNotes,
  @clientVisibleNotes,
  @evaluationFeeCents,
  @warrantyUntil,
  @warrantyTerms,
  @openedAt,
  @updatedAt,
  'local'
)
`,
      )
      .run({
        id: localId,
        serviceOrderNumber,
        organizationId,
        unitId,
        customerId: asset.customer_id,
        assetId: asset.id,
        clientContactId: input.clientContactId ?? null,
        clientContactSnapshotJson: JSON.stringify(
          input.clientContactSnapshot ?? null,
        ),
        intakeType,
        sourceServiceOrderId: input.sourceServiceOrderId ?? null,
        status,
        priority,
        responsibleTechnicianId: input.responsibleTechnicianId ?? null,
        claimedDefect: input.claimedDefect,
        intakeCondition: input.intakeCondition,
        accessories: input.accessories ?? null,
        removedSealingMarkNumber: input.removedSealingMarkNumber ?? null,
        affixedSealingMarkNumber: input.affixedSealingMarkNumber ?? null,
        inmetroRepairMarkNumber: input.inmetroRepairMarkNumber ?? null,
        invoiceRemittanceNumber: input.invoiceRemittanceNumber ?? null,
        invoiceRemittanceKey: input.invoiceRemittanceKey ?? null,
        invoiceRemittanceIssuedAt: input.invoiceRemittanceIssuedAt ?? null,
        carrierName: input.carrierName ?? null,
        carrierDocument: input.carrierDocument ?? null,
        thirdPartyName: input.thirdPartyName ?? null,
        thirdPartyDocument: input.thirdPartyDocument ?? null,
        thirdPartyPhone: input.thirdPartyPhone ?? null,
        deliveryMethod,
        internalNotes: input.internalNotes ?? null,
        clientVisibleNotes: input.clientVisibleNotes ?? null,
        evaluationFeeCents: input.evaluationFeeCents ?? 0,
        warrantyUntil: input.warrantyUntil ?? null,
        warrantyTerms: input.warrantyTerms ?? null,
        openedAt: now,
        updatedAt: now,
      });

    database
      .prepare(
        `
INSERT INTO service_order_asset_snapshots (
  service_order_id,
  asset_id,
  asset_name,
  asset_type,
  manufacturer,
  model,
  serial_number,
  patrimony_number,
  capacity,
  resolution,
  inventory_code,
  client_asset_code,
  observed_identification,
  photos_json,
  specifications_json
) VALUES (
  @serviceOrderId,
  @assetId,
  @assetName,
  @assetType,
  @manufacturer,
  @model,
  @serialNumber,
  @patrimonyNumber,
  @capacity,
  @resolution,
  @inventoryCode,
  @clientAssetCode,
  @observedIdentification,
  @photosJson,
  @specificationsJson
)
`,
      )
      .run({
        serviceOrderId: localId,
        assetId: snapshot.assetId,
        assetName: snapshot.assetName,
        assetType: snapshot.assetType,
        manufacturer: snapshot.manufacturer,
        model: snapshot.model,
        serialNumber: snapshot.serialNumber,
        patrimonyNumber: snapshot.patrimonyNumber,
        capacity: snapshot.capacity,
        resolution: snapshot.resolution,
        inventoryCode: snapshot.inventoryCode,
        clientAssetCode: snapshot.clientAssetCode,
        observedIdentification: snapshot.observedIdentification,
        photosJson: JSON.stringify(snapshot.photos),
        specificationsJson: JSON.stringify(snapshot.specifications),
      });

    appendLocalAudit(database, {
      entityType: "service_order",
      entityId: localId,
      action: "create_intake",
      actorUserId: input.actorUserId,
      details: {
        serviceOrderNumber,
        customerId: input.customerId,
        assetId: input.assetId,
      },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "service_order",
      entityId: localId,
      operation: "create_local_service_order_intake",
      payload,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLocalServiceOrderDetail(
    database,
    String(stableLocalNumericId(localId)),
  );
}

export function listLocalServiceOrders(
  database: LocalDatabase,
  input: LocalServiceOrdersListInput,
): LocalServiceOrdersListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (input.status) {
    conditions.push("so.status = @status");
    params.status = input.status;
  }

  if (input.query) {
    conditions.push(`(
      so.service_order_number LIKE @query OR
      c.name LIKE @query OR
      a.name LIKE @query OR
      a.serial_number LIKE @query
    )`);
    params.query = `%${input.query}%`;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = database
    .prepare<typeof params, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM service_orders so
LEFT JOIN customers c ON c.id = so.customer_id
LEFT JOIN assets a ON a.id = so.asset_id
${whereClause}
`,
    )
    .get(params);
  const pageParams = { ...params, limit, offset };
  const rows = database
    .prepare<typeof pageParams, LocalServiceOrderListRow>(
      `
SELECT
  so.remote_id,
  so.public_id,
  so.id AS local_id,
  so.service_order_number,
  so.status,
  so.priority,
  so.opened_at,
  so.sync_state,
  c.name AS customer_name,
  a.name AS asset_name,
  a.serial_number AS asset_serial_number
FROM service_orders so
LEFT JOIN customers c ON c.id = so.customer_id
LEFT JOIN assets a ON a.id = so.asset_id
${whereClause}
ORDER BY so.opened_at DESC
LIMIT @limit OFFSET @offset
`,
    )
    .all(pageParams);

  return {
    data: rows.map((row) => ({
      id: row.remote_id ?? stableLocalNumericId(row.local_id),
      // Route id for the dashboard. Synced rows carry the cloud publicId;
      // offline-created ones fall back to their local id, which is already
      // opaque. Never the serial.
      publicId: row.public_id ?? row.local_id,
      serviceOrderNumber: row.service_order_number,
      customerName: row.customer_name,
      assetName: row.asset_name,
      assetSerialNumber: row.asset_serial_number,
      status: row.status,
      statusLabel: SERVICE_ORDER_STATUS_LABELS[row.status],
      priority: row.priority,
      responsibleTechnicianName: null,
      openedAt: row.opened_at,
      quotedAt: null,
      approvedAt: null,
      totalApprovedCents: 0,
      totalQuotedCents: 0,
      unitName: null,
      syncState: row.sync_state,
    })),
    pagination: {
      page,
      limit,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / limit),
    },
  };
}

export function getLocalServiceOrderDetail(
  database: LocalDatabase,
  routeId: string,
) {
  const row = findLocalServiceOrder(database, routeId);
  if (!row) return null;

  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    publicId: row.public_id ?? row.id,
    serviceOrderNumber: row.service_order_number,
    customerId: row.customer_remote_id ?? stableLocalNumericId(row.customer_id),
    customerName: row.customer_name ?? "",
    assetId: row.asset_remote_id ?? stableLocalNumericId(row.asset_id),
    assetName: row.asset_name ?? "",
    assetSerialNumber: row.asset_serial_number,
    status: row.status,
    statusLabel: SERVICE_ORDER_STATUS_LABELS[row.status],
    priority: row.priority,
    intakeType: row.intake_type,
    responsibleTechnicianId: row.responsible_technician_id,
    claimedDefect: row.claimed_defect,
    intakeCondition: row.intake_condition,
    accessories: row.accessories,
    invoiceRemittanceNumber: row.invoice_remittance_number,
    invoiceRemittanceKey: row.invoice_remittance_key,
    carrierName: row.carrier_name,
    thirdPartyName: row.third_party_name,
    removedSealingMarkNumber: row.removed_sealing_mark_number,
    affixedSealingMarkNumber: row.affixed_sealing_mark_number,
    inmetroRepairMarkNumber: row.inmetro_repair_mark_number,
    deliveryMethod: row.delivery_method,
    clientVisibleNotes: row.client_visible_notes,
    internalNotes: row.internal_notes,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state,
    evaluations: [],
    quotes: listLocalServiceOrderQuotes(database, row.id),
    execution: getLocalServiceOrderExecution(database, row.id),
    deliveryDocuments: listLocalServiceOrderDeliveryDocuments(database, row.id),
    events: [],
    assetSnapshot: row.snapshot_service_order_id
      ? {
          assetId: row.snapshot_asset_id,
          assetName: row.snapshot_asset_name,
          assetType: row.snapshot_asset_type,
          manufacturer: row.snapshot_manufacturer,
          model: row.snapshot_model,
          serialNumber: row.snapshot_serial_number,
          patrimonyNumber: row.snapshot_patrimony_number,
          capacity: row.snapshot_capacity,
          resolution: row.snapshot_resolution,
          inventoryCode: row.snapshot_inventory_code,
          clientAssetCode: row.snapshot_client_asset_code,
          observedIdentification: row.snapshot_observed_identification,
          photos: parseJsonArray(row.snapshot_photos_json),
          specifications: parseJsonRecord(row.snapshot_specifications_json),
        }
      : null,
  };
}

export function createLocalServiceOrderQuoteDraft(
  database: LocalDatabase,
  input: CreateLocalServiceOrderQuoteDraftInput,
) {
  const serviceOrder = findLocalServiceOrder(database, input.routeId);
  if (!serviceOrder) {
    throw new Error("Ordem de servico nao encontrada");
  }

  if (input.items.length === 0) {
    throw new Error("Orcamento deve ter ao menos um item");
  }

  const now = new Date().toISOString();
  const quoteId = `service-order-quote:local:${randomUUID()}`;
  const version = nextLocalQuoteVersion(database, serviceOrder.id);
  const quoteNumber = `${serviceOrder.service_order_number}/ORC`;
  const items = normalizePricedItems(input.items);
  const totals = calculatePricedItems(items);
  const payload = {
    serviceOrderId: serviceOrder.id,
    validUntil: input.validUntil ?? null,
    paymentTerms: input.paymentTerms ?? null,
    deliveryEstimate: input.deliveryEstimate ?? null,
    warrantyTerms: input.warrantyTerms ?? null,
    clientMessage: input.clientMessage ?? null,
    internalNotes: input.internalNotes ?? null,
    items: input.items,
    localQuoteNumber: quoteNumber,
    version,
  };

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO service_order_quotes (
  id,
  remote_id,
  service_order_id,
  quote_number,
  version,
  status,
  subtotal_services_cents,
  subtotal_parts_cents,
  discount_cents,
  freight_cents,
  total_cents,
  valid_until,
  payment_terms,
  delivery_estimate,
  warranty_terms,
  client_message,
  internal_notes,
  created_by_user_id,
  created_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  NULL,
  @serviceOrderId,
  @quoteNumber,
  @version,
  'draft',
  @subtotalServicesCents,
  @subtotalPartsCents,
  @discountCents,
  @freightCents,
  @totalCents,
  @validUntil,
  @paymentTerms,
  @deliveryEstimate,
  @warrantyTerms,
  @clientMessage,
  @internalNotes,
  @createdByUserId,
  @createdAt,
  @updatedAt,
  'local'
)
`,
      )
      .run({
        id: quoteId,
        serviceOrderId: serviceOrder.id,
        quoteNumber,
        version,
        ...totals,
        validUntil: input.validUntil ?? null,
        paymentTerms: input.paymentTerms ?? null,
        deliveryEstimate: input.deliveryEstimate ?? null,
        warrantyTerms: input.warrantyTerms ?? null,
        clientMessage: input.clientMessage ?? null,
        internalNotes: input.internalNotes ?? null,
        createdByUserId: input.actorUserId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    replaceLocalQuoteItems(database, quoteId, items);
    markServiceOrderLocal(database, serviceOrder.id, now);
    appendLocalAudit(database, {
      entityType: "service_order_quote",
      entityId: quoteId,
      action: "create_draft",
      actorUserId: input.actorUserId,
      details: { serviceOrderId: serviceOrder.id, quoteNumber, version },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "service_order_quote",
      entityId: quoteId,
      operation: "create_local_service_order_quote_draft",
      payload,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLocalServiceOrderQuote(database, quoteId);
}

export function saveLocalServiceOrderExecutionNotes(
  database: LocalDatabase,
  input: SaveLocalServiceOrderExecutionNotesInput,
) {
  const serviceOrder = findLocalServiceOrder(database, input.routeId);
  if (!serviceOrder) {
    throw new Error("Ordem de servico nao encontrada");
  }

  const now = new Date().toISOString();
  const existing = getLocalServiceOrderExecutionRow(database, serviceOrder.id);
  const executionId =
    existing?.id ?? `service-order-execution:local:${randomUUID()}`;
  const items = input.items ? normalizePricedItems(input.items) : null;
  const payload = {
    serviceOrderId: serviceOrder.id,
    servicePerformed: input.servicePerformed ?? null,
    partsUsedSummary: input.partsUsedSummary ?? null,
    technicalNotes: input.technicalNotes ?? null,
    calibrationRequiredAfterRepair:
      input.calibrationRequiredAfterRepair ?? false,
    result: input.result ?? null,
    items: input.items ?? null,
  };

  database.transaction(() => {
    if (!existing) {
      database
        .prepare(
          `
INSERT INTO service_order_executions (
  id,
  remote_id,
  service_order_id,
  started_at,
  started_by_user_id,
  service_performed,
  parts_used_summary,
  technical_notes,
  calibration_required_after_repair,
  result,
  created_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  NULL,
  @serviceOrderId,
  @startedAt,
  @startedByUserId,
  @servicePerformed,
  @partsUsedSummary,
  @technicalNotes,
  @calibrationRequiredAfterRepair,
  @result,
  @createdAt,
  @updatedAt,
  'local'
)
`,
        )
        .run({
          id: executionId,
          serviceOrderId: serviceOrder.id,
          startedAt: now,
          startedByUserId: input.actorUserId ?? null,
          servicePerformed: input.servicePerformed ?? null,
          partsUsedSummary: input.partsUsedSummary ?? null,
          technicalNotes: input.technicalNotes ?? null,
          calibrationRequiredAfterRepair: input.calibrationRequiredAfterRepair
            ? 1
            : 0,
          result: input.result ?? null,
          createdAt: now,
          updatedAt: now,
        });
    } else {
      database
        .prepare(
          `
UPDATE service_order_executions
SET service_performed = @servicePerformed,
  parts_used_summary = @partsUsedSummary,
  technical_notes = @technicalNotes,
  calibration_required_after_repair = @calibrationRequiredAfterRepair,
  result = @result,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
        )
        .run({
          id: executionId,
          servicePerformed: input.servicePerformed ?? null,
          partsUsedSummary: input.partsUsedSummary ?? null,
          technicalNotes: input.technicalNotes ?? null,
          calibrationRequiredAfterRepair: input.calibrationRequiredAfterRepair
            ? 1
            : 0,
          result: input.result ?? null,
          updatedAt: now,
        });
    }

    if (items) {
      replaceLocalExecutionItems(database, executionId, items);
    }

    updateServiceOrderStatus(database, {
      id: serviceOrder.id,
      status: "repair_in_progress",
      updatedAt: now,
    });
    appendLocalAudit(database, {
      entityType: "service_order_execution",
      entityId: executionId,
      action: "save_notes",
      actorUserId: input.actorUserId,
      details: { serviceOrderId: serviceOrder.id },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "service_order_execution",
      entityId: executionId,
      operation: "save_local_service_order_execution_notes",
      payload,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLocalServiceOrderExecution(database, serviceOrder.id);
}

export function createLocalServiceOrderDeliveryDocumentDraft(
  database: LocalDatabase,
  input: CreateLocalServiceOrderDeliveryDocumentDraftInput,
) {
  const serviceOrder = findLocalServiceOrder(database, input.routeId);
  if (!serviceOrder) {
    throw new Error("Ordem de servico nao encontrada");
  }

  const now = new Date().toISOString();
  const documentId = `service-order-delivery-document:local:${randomUUID()}`;
  const version = nextLocalDeliveryDocumentVersion(database, serviceOrder.id);
  const documentNumber = `${serviceOrder.service_order_number}/ENT`;
  const payload = {
    serviceOrderId: serviceOrder.id,
    technicianSignatureData: input.technicianSignatureData ?? null,
    clientSignatureData: input.clientSignatureData ?? null,
    localDocumentNumber: documentNumber,
    version,
  };

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO service_order_delivery_documents (
  id,
  remote_id,
  service_order_id,
  document_number,
  version,
  issued_at,
  issued_by_user_id,
  technician_signature_data_json,
  client_signature_data_json,
  created_at,
  sync_state
) VALUES (
  @id,
  NULL,
  @serviceOrderId,
  @documentNumber,
  @version,
  NULL,
  @issuedByUserId,
  @technicianSignatureDataJson,
  @clientSignatureDataJson,
  @createdAt,
  'local'
)
`,
      )
      .run({
        id: documentId,
        serviceOrderId: serviceOrder.id,
        documentNumber,
        version,
        issuedByUserId: input.actorUserId ?? null,
        technicianSignatureDataJson: JSON.stringify(
          input.technicianSignatureData ?? null,
        ),
        clientSignatureDataJson: JSON.stringify(
          input.clientSignatureData ?? null,
        ),
        createdAt: now,
      });
    markServiceOrderLocal(database, serviceOrder.id, now);
    appendLocalAudit(database, {
      entityType: "service_order_delivery_document",
      entityId: documentId,
      action: "create_draft",
      actorUserId: input.actorUserId,
      details: { serviceOrderId: serviceOrder.id, documentNumber, version },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "service_order_delivery_document",
      entityId: documentId,
      operation: "create_local_service_order_delivery_document_draft",
      payload,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return getLocalServiceOrderDeliveryDocument(database, documentId);
}

/**
 * Resolves the id carried in the dashboard URL. That id is opaque: for an order
 * that has synced it is the cloud `publicId`, and for one created offline (which
 * has no publicId until the cloud assigns one) it is the local id. The numeric
 * branch stays for callers still holding a remote serial.
 */
function findLocalServiceOrder(database: LocalDatabase, routeId: string) {
  // Indexed lookup first: public_id has its own index and id is the primary
  // key, so opening one OS costs one row, not the whole local history plus its
  // customer/asset/snapshot joins.
  const byRouteId = selectServiceOrderDetail(database).get({
    remoteId: null,
    routeId,
    routeLocalId: null,
  });
  if (byRouteId) return byRouteId;

  const remoteId = Number(routeId);
  if (Number.isFinite(remoteId)) {
    const remoteMatch = selectServiceOrderDetail(database).get({
      remoteId,
      routeId: null,
      routeLocalId: null,
    });
    if (remoteMatch) return remoteMatch;
  }

  // Legacy stable-hash ids have no column to match on, so this last resort is
  // the only case that still scans.
  return selectServiceOrderDetail(database)
    .all({ remoteId: null, routeId: null, routeLocalId: null })
    .find((row) => String(stableLocalNumericId(row.id)) === routeId);
}

function selectServiceOrderDetail(database: LocalDatabase) {
  return database.prepare<
    {
      remoteId: number | null;
      routeId: string | null;
      routeLocalId: string | null;
    },
    LocalServiceOrderDetailRow
  >(
    `
SELECT
  so.*,
  c.remote_id AS customer_remote_id,
  c.id AS customer_local_id,
  c.name AS customer_name,
  a.remote_id AS asset_remote_id,
  a.id AS asset_local_id,
  a.name AS asset_name,
  a.serial_number AS asset_serial_number,
  snap.service_order_id AS snapshot_service_order_id,
  snap.asset_id AS snapshot_asset_id,
  snap.asset_name AS snapshot_asset_name,
  snap.asset_type AS snapshot_asset_type,
  snap.manufacturer AS snapshot_manufacturer,
  snap.model AS snapshot_model,
  snap.serial_number AS snapshot_serial_number,
  snap.patrimony_number AS snapshot_patrimony_number,
  snap.capacity AS snapshot_capacity,
  snap.resolution AS snapshot_resolution,
  snap.inventory_code AS snapshot_inventory_code,
  snap.client_asset_code AS snapshot_client_asset_code,
  snap.observed_identification AS snapshot_observed_identification,
  snap.photos_json AS snapshot_photos_json,
  snap.specifications_json AS snapshot_specifications_json
FROM service_orders so
LEFT JOIN customers c ON c.id = so.customer_id
LEFT JOIN assets a ON a.id = so.asset_id
LEFT JOIN service_order_asset_snapshots snap ON snap.service_order_id = so.id
WHERE (@remoteId IS NOT NULL AND so.remote_id = @remoteId)
   OR (@routeId IS NOT NULL AND (so.public_id = @routeId OR so.id = @routeId))
   OR (@remoteId IS NULL AND @routeId IS NULL AND @routeLocalId IS NULL)
`,
  );
}

function getAssetForServiceOrderIntake(
  database: LocalDatabase,
  input: { assetId: number; customerId: number },
) {
  const rows = database
    .prepare<
      { assetId: number; customerId: number },
      LocalServiceOrderAssetRow
    >(
      `
SELECT
  a.*,
  c.remote_id AS customer_remote_id,
  at.remote_id AS asset_type_remote_id,
  at.name AS asset_type_name
FROM assets a
INNER JOIN customers c ON c.id = a.customer_id
LEFT JOIN asset_types at ON at.id = a.asset_type_id
WHERE (a.remote_id = @assetId OR a.remote_id IS NULL)
  AND (c.remote_id = @customerId OR c.remote_id IS NULL)
  AND a.deleted_at IS NULL
`,
    )
    .all(input);

  return rows.find((row) => {
    const assetId = row.remote_id ?? stableLocalNumericId(row.id);
    const customerId =
      row.customer_remote_id ?? stableLocalNumericId(row.customer_id);

    return assetId === input.assetId && customerId === input.customerId;
  });
}

function buildAssetSnapshot(
  asset: LocalServiceOrderAssetRow,
  input: CreateLocalServiceOrderIntakeInput["assetSnapshot"],
) {
  const specifications = parseJsonRecord(asset.specifications_json);

  return {
    assetId: asset.remote_id ?? stableLocalNumericId(asset.id),
    assetName: asset.name,
    assetType: asset.asset_type_name,
    manufacturer: asset.manufacturer,
    model: asset.model,
    serialNumber: asset.serial_number,
    patrimonyNumber: asset.tag,
    capacity: getSpec(specifications, ["capacity", "capacidade"]),
    resolution: getSpec(specifications, ["resolution", "resolucao"]),
    inventoryCode: asset.tag,
    clientAssetCode: getSpec(specifications, [
      "clientAssetCode",
      "codigoCliente",
    ]),
    observedIdentification: input?.observedIdentification ?? null,
    photos: input?.photos ?? [],
    specifications,
  };
}

function listLocalServiceOrderQuotes(
  database: LocalDatabase,
  serviceOrderId: string,
) {
  const rows = database
    .prepare<{ serviceOrderId: string }, LocalServiceOrderQuoteRow>(
      `
SELECT *
FROM service_order_quotes
WHERE service_order_id = @serviceOrderId
ORDER BY version DESC
`,
    )
    .all({ serviceOrderId });

  return rows.map((row) => toLocalQuote(database, row));
}

function getLocalServiceOrderQuote(database: LocalDatabase, quoteId: string) {
  const row = database
    .prepare<
      { quoteId: string },
      LocalServiceOrderQuoteRow
    >("SELECT * FROM service_order_quotes WHERE id = @quoteId")
    .get({ quoteId });

  return row ? toLocalQuote(database, row) : null;
}

function toLocalQuote(database: LocalDatabase, row: LocalServiceOrderQuoteRow) {
  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    localId: row.id,
    serviceOrderId: row.service_order_id,
    quoteNumber: row.quote_number,
    version: row.version,
    status: row.status,
    subtotalServicesCents: row.subtotal_services_cents,
    subtotalPartsCents: row.subtotal_parts_cents,
    discountCents: row.discount_cents,
    freightCents: row.freight_cents,
    totalCents: row.total_cents,
    validUntil: row.valid_until,
    paymentTerms: row.payment_terms,
    deliveryEstimate: row.delivery_estimate,
    warrantyTerms: row.warranty_terms,
    clientMessage: row.client_message,
    internalNotes: row.internal_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state,
    items: listLocalQuoteItems(database, row.id),
  };
}

function listLocalQuoteItems(database: LocalDatabase, quoteId: string) {
  const rows = database
    .prepare<{ quoteId: string }, LocalServiceOrderQuoteItemRow>(
      `
SELECT *
FROM service_order_quote_items
WHERE quote_id = @quoteId
ORDER BY sort_order ASC
`,
    )
    .all({ quoteId });

  return rows.map((row) => ({
    id: row.remote_id ?? stableLocalNumericId(row.id),
    type: row.type,
    description: row.description,
    materialId: row.material_id,
    quantity: row.quantity,
    unit: row.unit,
    unitCostCents: row.unit_cost_cents,
    unitPriceCents: row.unit_price_cents,
    totalPriceCents: row.total_price_cents,
    taxable: row.taxable === 1,
    warrantyCovered: row.warranty_covered === 1,
    warrantyUntil: row.warranty_until,
    warrantyTerms: row.warranty_terms,
    notes: row.notes,
    sortOrder: row.sort_order,
  }));
}

function getLocalServiceOrderExecution(
  database: LocalDatabase,
  serviceOrderId: string,
) {
  const row = getLocalServiceOrderExecutionRow(database, serviceOrderId);
  if (!row) return null;

  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    localId: row.id,
    serviceOrderId: row.service_order_id,
    startedAt: row.started_at,
    startedByUserId: row.started_by_user_id,
    finishedAt: row.finished_at,
    finishedByUserId: row.finished_by_user_id,
    servicePerformed: row.service_performed,
    partsUsedSummary: row.parts_used_summary,
    technicalNotes: row.technical_notes,
    calibrationRequiredAfterRepair: row.calibration_required_after_repair === 1,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state,
    items: listLocalExecutionItems(database, row.id),
  };
}

function getLocalServiceOrderExecutionRow(
  database: LocalDatabase,
  serviceOrderId: string,
) {
  return database
    .prepare<{ serviceOrderId: string }, LocalServiceOrderExecutionRow>(
      `
SELECT *
FROM service_order_executions
WHERE service_order_id = @serviceOrderId
`,
    )
    .get({ serviceOrderId });
}

function listLocalExecutionItems(database: LocalDatabase, executionId: string) {
  const rows = database
    .prepare<{ executionId: string }, LocalServiceOrderExecutionItemRow>(
      `
SELECT *
FROM service_order_execution_items
WHERE execution_id = @executionId
ORDER BY sort_order ASC
`,
    )
    .all({ executionId });

  return rows.map((row) => ({
    id: row.remote_id ?? stableLocalNumericId(row.id),
    quoteItemId: row.quote_item_id,
    type: row.type,
    description: row.description,
    materialId: row.material_id,
    quantity: row.quantity,
    unit: row.unit,
    unitCostCents: row.unit_cost_cents,
    unitPriceCents: row.unit_price_cents,
    totalPriceCents: row.total_price_cents,
    technicianId: row.technician_id,
    sortOrder: row.sort_order,
  }));
}

function listLocalServiceOrderDeliveryDocuments(
  database: LocalDatabase,
  serviceOrderId: string,
) {
  const rows = database
    .prepare<{ serviceOrderId: string }, LocalServiceOrderDeliveryDocumentRow>(
      `
SELECT *
FROM service_order_delivery_documents
WHERE service_order_id = @serviceOrderId
ORDER BY version DESC
`,
    )
    .all({ serviceOrderId });

  return rows.map(toLocalDeliveryDocument);
}

function getLocalServiceOrderDeliveryDocument(
  database: LocalDatabase,
  documentId: string,
) {
  const row = database
    .prepare<
      { documentId: string },
      LocalServiceOrderDeliveryDocumentRow
    >("SELECT * FROM service_order_delivery_documents WHERE id = @documentId")
    .get({ documentId });

  return row ? toLocalDeliveryDocument(row) : null;
}

function toLocalDeliveryDocument(row: LocalServiceOrderDeliveryDocumentRow) {
  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    localId: row.id,
    serviceOrderId: row.service_order_id,
    documentNumber: row.document_number,
    version: row.version,
    issuedAt: row.issued_at,
    issuedByUserId: row.issued_by_user_id,
    technicianSignatureData: parseJsonRecordOrNull(
      row.technician_signature_data_json,
    ),
    clientSignatureData: parseJsonRecordOrNull(row.client_signature_data_json),
    createdAt: row.created_at,
    syncState: row.sync_state,
  };
}

function normalizePricedItems(items: LocalServiceOrderPricedItemInput[]) {
  return items.map((item, index) => {
    const quantity = Number(item.quantity);
    const totalPriceCents = Math.round(quantity * item.unitPriceCents);
    return {
      ...item,
      quantity,
      unit: item.unit ?? "un",
      materialId: item.materialId ?? null,
      unitCostCents: item.unitCostCents ?? null,
      taxable: item.taxable ?? true,
      warrantyCovered: item.warrantyCovered ?? false,
      warrantyUntil: item.warrantyUntil ?? null,
      warrantyTerms: item.warrantyTerms ?? null,
      notes: item.notes ?? null,
      totalPriceCents,
      sortOrder: index,
    };
  });
}

function calculatePricedItems(items: ReturnType<typeof normalizePricedItems>) {
  const subtotalServicesCents = items
    .filter((item) =>
      ["service", "external_service", "other", "evaluation_fee"].includes(
        item.type,
      ),
    )
    .reduce((sum, item) => sum + Math.max(item.totalPriceCents, 0), 0);
  const subtotalPartsCents = items
    .filter((item) => item.type === "part")
    .reduce((sum, item) => sum + Math.max(item.totalPriceCents, 0), 0);
  const freightCents = items
    .filter((item) => item.type === "freight")
    .reduce((sum, item) => sum + Math.max(item.totalPriceCents, 0), 0);
  const discountCents = Math.abs(
    items
      .filter((item) => item.type === "discount")
      .reduce((sum, item) => sum + item.totalPriceCents, 0),
  );
  const totalCents = Math.max(
    items.reduce((sum, item) => sum + item.totalPriceCents, 0),
    0,
  );

  return {
    subtotalServicesCents,
    subtotalPartsCents,
    discountCents,
    freightCents,
    totalCents,
  };
}

function replaceLocalQuoteItems(
  database: LocalDatabase,
  quoteId: string,
  items: ReturnType<typeof normalizePricedItems>,
) {
  database
    .prepare("DELETE FROM service_order_quote_items WHERE quote_id = @quoteId")
    .run({ quoteId });

  const insert = database.prepare(
    `
INSERT INTO service_order_quote_items (
  id,
  quote_id,
  remote_id,
  type,
  description,
  material_id,
  quantity,
  unit,
  unit_cost_cents,
  unit_price_cents,
  total_price_cents,
  taxable,
  warranty_covered,
  warranty_until,
  warranty_terms,
  notes,
  sort_order
) VALUES (
  @id,
  @quoteId,
  NULL,
  @type,
  @description,
  @materialId,
  @quantity,
  @unit,
  @unitCostCents,
  @unitPriceCents,
  @totalPriceCents,
  @taxable,
  @warrantyCovered,
  @warrantyUntil,
  @warrantyTerms,
  @notes,
  @sortOrder
)
`,
  );

  for (const item of items) {
    insert.run({
      id: `service-order-quote-item:local:${randomUUID()}`,
      quoteId,
      ...item,
      taxable: item.taxable ? 1 : 0,
      warrantyCovered: item.warrantyCovered ? 1 : 0,
    });
  }
}

function replaceLocalExecutionItems(
  database: LocalDatabase,
  executionId: string,
  items: ReturnType<typeof normalizePricedItems>,
) {
  database
    .prepare(
      "DELETE FROM service_order_execution_items WHERE execution_id = @executionId",
    )
    .run({ executionId });

  const insert = database.prepare(
    `
INSERT INTO service_order_execution_items (
  id,
  execution_id,
  remote_id,
  quote_item_id,
  type,
  description,
  material_id,
  quantity,
  unit,
  unit_cost_cents,
  unit_price_cents,
  total_price_cents,
  technician_id,
  sort_order
) VALUES (
  @id,
  @executionId,
  NULL,
  NULL,
  @type,
  @description,
  @materialId,
  @quantity,
  @unit,
  @unitCostCents,
  @unitPriceCents,
  @totalPriceCents,
  @technicianId,
  @sortOrder
)
`,
  );

  for (const item of items) {
    insert.run({
      id: `service-order-execution-item:local:${randomUUID()}`,
      executionId,
      technicianId: null,
      ...item,
      unitCostCents: item.unitCostCents ?? 0,
    });
  }
}

function nextLocalQuoteVersion(
  database: LocalDatabase,
  serviceOrderId: string,
) {
  const row = database
    .prepare<{ serviceOrderId: string }, { version: number }>(
      `
SELECT COALESCE(MAX(version), 0) + 1 AS version
FROM service_order_quotes
WHERE service_order_id = @serviceOrderId
`,
    )
    .get({ serviceOrderId });

  return row?.version ?? 1;
}

function nextLocalDeliveryDocumentVersion(
  database: LocalDatabase,
  serviceOrderId: string,
) {
  const row = database
    .prepare<{ serviceOrderId: string }, { version: number }>(
      `
SELECT COALESCE(MAX(version), 0) + 1 AS version
FROM service_order_delivery_documents
WHERE service_order_id = @serviceOrderId
`,
    )
    .get({ serviceOrderId });

  return row?.version ?? 1;
}

function markServiceOrderLocal(
  database: LocalDatabase,
  id: string,
  updatedAt: string,
) {
  database
    .prepare(
      `
UPDATE service_orders
SET updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
    )
    .run({ id, updatedAt });
}

function updateServiceOrderStatus(
  database: LocalDatabase,
  input: { id: string; status: LocalServiceOrderStatus; updatedAt: string },
) {
  database
    .prepare(
      `
UPDATE service_orders
SET status = @status,
  updated_at = @updatedAt,
  sync_state = 'local'
WHERE id = @id
`,
    )
    .run(input);
}

function appendLocalAudit(
  database: LocalDatabase,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    actorUserId?: string | null;
    details: unknown;
    createdAt: string;
  },
) {
  database
    .prepare(
      `
INSERT INTO local_audit_log (
  id,
  entity_type,
  entity_id,
  action,
  actor_user_id,
  details_json,
  created_at,
  sync_state
) VALUES (
  @id,
  @entityType,
  @entityId,
  @action,
  @actorUserId,
  @detailsJson,
  @createdAt,
  'local'
)
`,
    )
    .run({
      id: `audit:${randomUUID()}`,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      detailsJson: JSON.stringify(input.details),
      createdAt: input.createdAt,
    });
}

function appendOutboxEvent(
  database: LocalDatabase,
  input: {
    entityType: string;
    entityId: string;
    operation: string;
    payload: unknown;
    actorUserId?: string | null;
    deviceId?: string | null;
    occurredAt: string;
  },
) {
  const eventId = `event:${randomUUID()}`;
  const idempotencyKey = `local:${eventId}`;
  const metadata = {
    actorUserId: input.actorUserId ?? null,
    deviceId: input.deviceId ?? "local",
  };

  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  @eventId,
  @aggregateKind,
  @aggregateId,
  0,
  @eventType,
  @payloadJson,
  @metadataJson,
  @actorUserId,
  @deviceId,
  @occurredAt,
  'pending'
)
`,
    )
    .run({
      eventId,
      aggregateKind: input.entityType,
      aggregateId: input.entityId,
      eventType: input.operation,
      payloadJson: JSON.stringify(input.payload),
      metadataJson: JSON.stringify(metadata),
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: input.occurredAt,
    });

  database
    .prepare(
      `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  @id,
  @eventId,
  @operation,
  @payloadJson,
  @idempotencyKey,
  'pending',
  @createdAt
)
`,
    )
    .run({
      id: `outbox:${randomUUID()}`,
      eventId,
      operation: input.operation,
      payloadJson: JSON.stringify(input.payload),
      idempotencyKey,
      createdAt: input.occurredAt,
    });
}

function nextLocalServiceOrderNumber(database: LocalDatabase) {
  const year = new Date().getFullYear();
  const row = database
    .prepare<{ prefix: string }, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM service_orders
WHERE service_order_number LIKE @prefix
`,
    )
    .get({ prefix: `LOCAL-OS-${year}-%` });

  return `LOCAL-OS-${year}-${String((row?.total ?? 0) + 1).padStart(4, "0")}`;
}

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function recordFromUnknown(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function parseJsonRecord(value: string | null | undefined) {
  const parsed = parseJson(value);
  return recordFromUnknown(parsed);
}

function parseJsonRecordOrNull(value: string | null | undefined) {
  const parsed = parseJsonRecord(value);
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function parseJsonArray(value: string | null | undefined) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function getSpec(specifications: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = specifications[key];
    if (value !== null && value !== undefined && value !== "") {
      return String(value);
    }
  }

  return null;
}

type LocalServiceOrderListRow = {
  remote_id: number | null;
  public_id: string | null;
  local_id: string;
  service_order_number: string;
  customer_name: string | null;
  asset_name: string | null;
  asset_serial_number: string | null;
  status: LocalServiceOrderStatus;
  priority: LocalServiceOrderPriority;
  opened_at: string;
  sync_state: string;
};

type LocalServiceOrderAssetRow = {
  id: string;
  remote_id: number | null;
  organization_id: string;
  unit_id: number;
  customer_id: string;
  customer_remote_id: number | null;
  asset_type_id: string;
  asset_type_remote_id: number | null;
  asset_type_name: string | null;
  name: string;
  serial_number: string;
  tag: string;
  manufacturer: string | null;
  model: string | null;
  specifications_json: string | null;
};

type LocalServiceOrderDetailRow = {
  id: string;
  remote_id: number | null;
  // Mirrored from the cloud on sync; null for orders created offline.
  public_id: string | null;
  service_order_number: string;
  customer_id: string;
  customer_remote_id: number | null;
  customer_name: string | null;
  asset_id: string;
  asset_remote_id: number | null;
  asset_name: string | null;
  asset_serial_number: string | null;
  status: LocalServiceOrderStatus;
  priority: LocalServiceOrderPriority;
  intake_type: LocalServiceOrderIntakeType;
  responsible_technician_id: string | null;
  claimed_defect: string;
  intake_condition: string;
  accessories: string | null;
  removed_sealing_mark_number: string | null;
  affixed_sealing_mark_number: string | null;
  inmetro_repair_mark_number: string | null;
  invoice_remittance_number: string | null;
  invoice_remittance_key: string | null;
  carrier_name: string | null;
  third_party_name: string | null;
  delivery_method: LocalServiceOrderDeliveryMethod | null;
  internal_notes: string | null;
  client_visible_notes: string | null;
  opened_at: string;
  updated_at: string;
  sync_state: string;
  snapshot_service_order_id: string | null;
  snapshot_asset_id: number | null;
  snapshot_asset_name: string | null;
  snapshot_asset_type: string | null;
  snapshot_manufacturer: string | null;
  snapshot_model: string | null;
  snapshot_serial_number: string | null;
  snapshot_patrimony_number: string | null;
  snapshot_capacity: string | null;
  snapshot_resolution: string | null;
  snapshot_inventory_code: string | null;
  snapshot_client_asset_code: string | null;
  snapshot_observed_identification: string | null;
  snapshot_photos_json: string | null;
  snapshot_specifications_json: string | null;
};

type LocalServiceOrderQuoteRow = {
  id: string;
  remote_id: number | null;
  service_order_id: string;
  quote_number: string;
  version: number;
  status: string;
  subtotal_services_cents: number;
  subtotal_parts_cents: number;
  discount_cents: number;
  freight_cents: number;
  total_cents: number;
  valid_until: string | null;
  payment_terms: string | null;
  delivery_estimate: string | null;
  warranty_terms: string | null;
  client_message: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  sync_state: string;
};

type LocalServiceOrderQuoteItemRow = {
  id: string;
  remote_id: number | null;
  type: LocalServiceOrderItemType;
  description: string;
  material_id: number | null;
  quantity: number;
  unit: string;
  unit_cost_cents: number | null;
  unit_price_cents: number;
  total_price_cents: number;
  taxable: number;
  warranty_covered: number;
  warranty_until: string | null;
  warranty_terms: string | null;
  notes: string | null;
  sort_order: number;
};

type LocalServiceOrderExecutionRow = {
  id: string;
  remote_id: number | null;
  service_order_id: string;
  started_at: string;
  started_by_user_id: string | null;
  finished_at: string | null;
  finished_by_user_id: string | null;
  service_performed: string | null;
  parts_used_summary: string | null;
  technical_notes: string | null;
  calibration_required_after_repair: number;
  result: LocalServiceOrderExecutionResult | null;
  created_at: string;
  updated_at: string;
  sync_state: string;
};

type LocalServiceOrderExecutionItemRow = {
  id: string;
  remote_id: number | null;
  quote_item_id: string | null;
  type: LocalServiceOrderItemType;
  description: string;
  material_id: number | null;
  quantity: number;
  unit: string;
  unit_cost_cents: number;
  unit_price_cents: number;
  total_price_cents: number;
  technician_id: string | null;
  sort_order: number;
};

type LocalServiceOrderDeliveryDocumentRow = {
  id: string;
  remote_id: number | null;
  service_order_id: string;
  document_number: string;
  version: number;
  issued_at: string | null;
  issued_by_user_id: string | null;
  technician_signature_data_json: string | null;
  client_signature_data_json: string | null;
  created_at: string;
  sync_state: string;
};
