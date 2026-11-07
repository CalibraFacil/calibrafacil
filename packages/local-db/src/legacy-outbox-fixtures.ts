import { randomUUID } from "node:crypto";
import { SERVICE_ORDER_MACHINE } from "@calibra-facil/schemas/machines";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

/**
 * What an upgraded desktop's database looks like: a row with a queued local change that an
 * older build wrote (customer create/edit, instrument edit, repair-notes save). Since Q69 no
 * build writes them and the cloud refuses them (`UNSUPPORTED_SYNC_OPERATION`), so nothing in
 * the product calls these. The sync suites use them to put a pending change on a mirror row:
 * a pull must not overwrite it, a bootstrap must not drop it, and the push still drains it.
 *
 * Test-only: not exported from the package index.
 */

/** The row an identifier names: its id, its cloud id, or the numeric id the local API hands out. */
function resolveRow(
  database: LocalDatabase,
  table: "customers" | "assets",
  identifier: string,
) {
  const rows = database
    .prepare<
      [],
      { id: string; remote_id: number | null }
    >(`SELECT id, remote_id FROM ${table}`)
    .all();
  return rows.find(
    (row) =>
      row.id === identifier ||
      String(row.remote_id) === identifier ||
      String(stableLocalNumericId(row.id)) === identifier,
  );
}

function enqueue(
  database: LocalDatabase,
  input: {
    aggregateKind: string;
    entityId: string;
    operation: string;
    payload: Record<string, unknown>;
    actorUserId?: string | null | undefined;
    deviceId?: string | null | undefined;
    occurredAt: string;
  },
) {
  const eventId = `event:${randomUUID()}`;
  const payloadJson = JSON.stringify(input.payload);
  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id, aggregate_kind, aggregate_id, aggregate_version, event_type,
  payload_json, metadata_json, actor_user_id, device_id, occurred_at, sync_state
) VALUES (@eventId, @aggregateKind, @aggregateId, 0, @eventType, @payloadJson, '{}', @actorUserId, @deviceId, @occurredAt, 'pending')
`,
    )
    .run({
      eventId,
      aggregateKind: input.aggregateKind,
      aggregateId: input.entityId,
      eventType: input.operation,
      payloadJson,
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: input.occurredAt,
    });
  database
    .prepare(
      `
INSERT INTO outbox (id, event_id, operation, payload_json, idempotency_key, status, created_at)
VALUES (@id, @eventId, @operation, @payloadJson, @idempotencyKey, 'pending', @createdAt)
`,
    )
    .run({
      id: `outbox:${randomUUID()}`,
      eventId,
      operation: input.operation,
      payloadJson,
      idempotencyKey: `local:${eventId}`,
      createdAt: input.occurredAt,
    });
}

/** A customer created offline by an older build, with its queued `create_local_customer`. */
export function createLocalCustomer(
  database: LocalDatabase,
  input: {
    organizationId: string;
    unitId: number;
    name: string;
    taxId?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: Record<string, unknown> | null;
    actorUserId?: string | null;
    deviceId?: string | null;
  },
) {
  const now = new Date().toISOString();
  const id = `customer:${randomUUID()}`;
  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO customers (id, organization_id, unit_id, name, tax_id, email, phone, address_json, updated_at, sync_state)
VALUES (@id, @organizationId, @unitId, @name, @taxId, @email, @phone, @addressJson, @updatedAt, 'local')
`,
      )
      .run({
        id,
        organizationId: input.organizationId,
        unitId: input.unitId,
        name: input.name,
        taxId: input.taxId || null,
        email: input.email || null,
        phone: input.phone || null,
        addressJson: JSON.stringify(input.address ?? null),
        updatedAt: now,
      });
    enqueue(database, {
      aggregateKind: "customer",
      entityId: id,
      operation: "create_local_customer",
      payload: {
        name: input.name,
        ...(input.taxId ? { taxId: input.taxId } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.address ? { address: input.address } : {}),
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();
  return { id: stableLocalNumericId(id), rowId: id, syncState: "local" };
}

/** A queued local edit of a customer row (`update_local_customer`). */
export function updateLocalCustomer(
  database: LocalDatabase,
  input: {
    identifier: string;
    name: string;
    actorUserId?: string | null;
    deviceId?: string | null;
  },
) {
  const row = resolveRow(database, "customers", input.identifier);
  if (!row) throw new Error("Cliente local nao encontrado");
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        "UPDATE customers SET name = @name, updated_at = @now, sync_state = 'local' WHERE id = @id",
      )
      .run({ id: row.id, name: input.name, now });
    enqueue(database, {
      aggregateKind: "customer",
      entityId: row.id,
      operation: "update_local_customer",
      payload: {
        ...(row.remote_id === null ? {} : { remoteId: row.remote_id }),
        name: input.name,
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();
}

/** A queued local edit of an instrument row (`update_local_asset`). */
export function updateLocalAsset(
  database: LocalDatabase,
  input: {
    identifier: string;
    name: string;
    actorUserId?: string | null;
    deviceId?: string | null;
  },
) {
  const row = resolveRow(database, "assets", input.identifier);
  if (!row) throw new Error("Ativo local nao encontrado");
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        "UPDATE assets SET name = @name, updated_at = @now, sync_state = 'local' WHERE id = @id",
      )
      .run({ id: row.id, name: input.name, now });
    enqueue(database, {
      aggregateKind: "asset",
      entityId: row.id,
      operation: "update_local_asset",
      payload: {
        ...(row.remote_id === null ? {} : { remoteId: row.remote_id }),
        name: input.name,
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();
}

/** A queued save of the repair notes of a service order (`save_local_service_order_execution_notes`). */
export function saveLocalServiceOrderExecutionNotes(
  database: LocalDatabase,
  input: {
    routeId: string;
    servicePerformed?: string | null;
    technicalNotes?: string | null;
    actorUserId?: string | null;
    deviceId?: string | null;
  },
) {
  const order = database
    .prepare<
      { routeId: string },
      { id: string; status: string }
    >("SELECT id, status FROM service_orders WHERE id = @routeId OR public_id = @routeId OR CAST(remote_id AS TEXT) = @routeId LIMIT 1")
    .get({ routeId: input.routeId });
  if (!order) throw new Error("Ordem de servico nao encontrada");
  const now = new Date().toISOString();
  const existing = database
    .prepare<
      { serviceOrderId: string },
      { id: string }
    >("SELECT id FROM service_order_executions WHERE service_order_id = @serviceOrderId LIMIT 1")
    .get({ serviceOrderId: order.id });
  const executionId =
    existing?.id ?? `service-order-execution:local:${randomUUID()}`;
  database.transaction(() => {
    if (existing) {
      database
        .prepare(
          `
UPDATE service_order_executions
SET service_performed = @servicePerformed, technical_notes = @technicalNotes,
  updated_at = @now, sync_state = 'local'
WHERE id = @id
`,
        )
        .run({
          id: executionId,
          servicePerformed: input.servicePerformed ?? null,
          technicalNotes: input.technicalNotes ?? null,
          now,
        });
    } else {
      database
        .prepare(
          `
INSERT INTO service_order_executions (
  id, remote_id, service_order_id, started_at, started_by_user_id,
  service_performed, technical_notes, calibration_required_after_repair,
  created_at, updated_at, sync_state
) VALUES (@id, NULL, @serviceOrderId, @now, @actorUserId, @servicePerformed, @technicalNotes, 0, @now, @now, 'local')
`,
        )
        .run({
          id: executionId,
          serviceOrderId: order.id,
          actorUserId: input.actorUserId ?? null,
          servicePerformed: input.servicePerformed ?? null,
          technicalNotes: input.technicalNotes ?? null,
          now,
        });
    }
    // As the writer did: notes on an order with an approved quote start the repair, a
    // local change of the header; at another stage the order keeps its stage.
    if (SERVICE_ORDER_MACHINE.canTransition(order.status, "start_repair")) {
      database
        .prepare(
          "UPDATE service_orders SET status = @status, updated_at = @now, sync_state = 'local' WHERE id = @id",
        )
        .run({
          id: order.id,
          status: SERVICE_ORDER_MACHINE.requireTargetOf(
            order.status,
            "start_repair",
          ),
          now,
        });
    }
    enqueue(database, {
      aggregateKind: "service_order_execution",
      entityId: executionId,
      operation: "save_local_service_order_execution_notes",
      payload: {
        serviceOrderId: order.id,
        servicePerformed: input.servicePerformed ?? null,
        technicalNotes: input.technicalNotes ?? null,
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();
}
