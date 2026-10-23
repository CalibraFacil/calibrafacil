import { Client } from "pg";
import { formatIntegrationCustomerAddress } from "@calibra-facil/shared";
import type { IntegrationSyncTarget } from "@calibra-facil/shared";
import { type SyncPayload, toIso } from "./helpers.js";

export async function loadPayloads(
  client: Client,
  organizationId: string,
  target: IntegrationSyncTarget,
  limit: number,
): Promise<SyncPayload[]> {
  if (target === "customer") {
    const result = await client.query(
      `
            SELECT id, name, tax_id, email, phone, address, created_at, updated_at
            FROM customer
            WHERE lab_organization_id = $1
            ORDER BY updated_at DESC
            LIMIT $2
            `,
      [organizationId, limit],
    );

    return result.rows.map((row) => ({
      externalId: `customer:${row.id}`,
      organizationId,
      name: row.name,
      taxId: row.tax_id,
      email: row.email,
      phone: row.phone,
      address: formatIntegrationCustomerAddress(row.address),
      addressParts: row.address,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }));
  }

  if (target === "service_order") {
    const result = await client.query(
      `
            SELECT
              cj.id,
              cj.job_id,
              cj.status,
              cj.unit_id,
              ou.name AS unit_name,
              c.id AS customer_id,
              c.name AS customer_name,
              s.id AS service_id,
              a.name AS asset_name,
              a.tag AS asset_tag,
              s.name AS service_name,
              s.price AS service_price,
              s.currency AS service_currency,
              cj.performed_at,
              cj.approved_at,
              cj.updated_at
            FROM calibration_job cj
            LEFT JOIN customer c ON cj.customer_id = c.id
            LEFT JOIN asset a ON cj.asset_id = a.id
            LEFT JOIN service s ON cj.service_id = s.id
            LEFT JOIN organization_unit ou ON cj.unit_id = ou.id
            WHERE cj.organization_id = $1
              AND cj.status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'SUPERSEDED')
            ORDER BY cj.updated_at DESC
            LIMIT $2
            `,
      [organizationId, limit],
    );

    return result.rows.map((row) => ({
      externalId: `service_order:${row.id}`,
      organizationId,
      unitId: row.unit_id,
      unitName: row.unit_name ?? null,
      jobId: row.job_id,
      status: row.status,
      customerExternalId: row.customer_id
        ? `customer:${row.customer_id}`
        : null,
      customerName: row.customer_name ?? null,
      serviceExternalId: row.service_id ? `service:${row.service_id}` : null,
      assetName: row.asset_name ?? null,
      assetTag: row.asset_tag ?? null,
      serviceName: row.service_name ?? null,
      servicePriceCents: row.service_price ?? null,
      currency: row.service_currency ?? null,
      performedAt: toIso(row.performed_at),
      approvedAt: toIso(row.approved_at),
      updatedAt: toIso(row.updated_at),
    }));
  }

  const result = await client.query(
    `
        SELECT
          cj.id,
          cj.job_id,
          cj.unit_id,
          ou.name AS unit_name,
          c.id AS customer_id,
          c.name AS customer_name,
          s.name AS service_name,
          s.price AS amount,
          s.currency,
          cj.approved_at,
          cj.due_date
        FROM calibration_job cj
        LEFT JOIN customer c ON cj.customer_id = c.id
        LEFT JOIN service s ON cj.service_id = s.id
        LEFT JOIN organization_unit ou ON cj.unit_id = ou.id
        WHERE cj.organization_id = $1
          AND cj.status IN ('APPROVED', 'SUPERSEDED')
          AND s.price IS NOT NULL
          AND s.price > 0
        ORDER BY cj.approved_at DESC
        LIMIT $2
        `,
    [organizationId, limit],
  );

  return result.rows.map((row) => ({
    externalId: `billing_document:${row.id}`,
    documentNumber: row.job_id ?? null,
    organizationId,
    unitId: row.unit_id,
    unitName: row.unit_name ?? null,
    customerExternalId: row.customer_id ? `customer:${row.customer_id}` : null,
    customerName: row.customer_name ?? null,
    totalCents: Number(row.amount ?? 0),
    currency: row.currency ?? "BRL",
    issueDate: toIso(row.approved_at),
    dueDate: toIso(row.due_date),
    status: "issued" as const,
    items: [
      {
        lineId: `calibration_job:${row.id}:service`,
        jobId: row.job_id ?? null,
        description: row.service_name ?? "Servico de calibracao",
        quantity: 1,
        unitPriceCents: Number(row.amount ?? 0),
        totalCents: Number(row.amount ?? 0),
      },
    ],
  }));
}

export async function countLocalTargetRecords(
  client: Client,
  organizationId: string,
  target: IntegrationSyncTarget,
): Promise<number> {
  if (target === "customer") {
    const result = await client.query(
      `SELECT COUNT(*)::int AS total FROM customer WHERE lab_organization_id = $1`,
      [organizationId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  if (target === "service_order") {
    const result = await client.query(
      `
            SELECT COUNT(*)::int AS total
            FROM calibration_job
            WHERE organization_id = $1
              AND status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'SUPERSEDED')
            `,
      [organizationId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  const result = await client.query(
    `
        SELECT COUNT(*)::int AS total
        FROM calibration_job cj
        LEFT JOIN service s ON cj.service_id = s.id
        WHERE cj.organization_id = $1
          AND cj.status IN ('APPROVED', 'SUPERSEDED')
          AND s.price IS NOT NULL
          AND s.price > 0
        `,
    [organizationId],
  );

  return Number(result.rows[0]?.total ?? 0);
}

export async function countLinkedTargetRecords(
  client: Client,
  integrationId: string,
  target: IntegrationSyncTarget,
): Promise<number> {
  const result = await client.query(
    `
        SELECT COUNT(*)::int AS total
        FROM integration_object_link
        WHERE integration_id = $1
          AND target = $2
        `,
    [integrationId, target],
  );

  return Number(result.rows[0]?.total ?? 0);
}
