import { Client, type QueryResultRow } from "pg";
import { renderToString } from "react-dom/server";
import {
  ServiceOrderIntakeDocumentHtml,
  type ServiceOrderDocumentData,
} from "@calibra-facil/documents";
import React from "react";
import QRCode from "qrcode";
import { formatSpecificationsForDisplay } from "@calibra-facil/shared";
import {
  getYearMonth,
  serviceOrderDocKey,
  type OrgRef,
} from "@calibra-facil/shared/storage-keys";
import { type Env } from "./runtime-types.js";
import { portalBaseUrl } from "./audit-pack-support.js";
import {
  bucketBinding,
  fetchOrgRefById,
  resolveOrganizationLogoDataUrl,
} from "./storage-helpers.js";
import {
  findOrganizationOnSystemPath,
  generatePdfFromHtml,
  withOrgDbClient,
} from "./pdf-render.js";

function formatAddress(parts: Record<string, unknown> | null | undefined) {
  if (!parts || typeof parts !== "object") return null;
  return [
    parts.street,
    parts.number,
    parts.complement,
    parts.neighbourhood,
    parts.city,
    parts.state,
    parts.cep,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(", ");
}

/**
 * Composes the permissionária authorization for documents as "<number>/<UF>".
 * Returns the number alone when the UF is absent, or null when no number is set.
 */
function composePermissionariaAuthorization(
  authorizationNumber: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const number = authorizationNumber?.trim();
  if (!number) return null;
  const uf = state?.trim();
  return uf ? `${number}/${uf}` : number;
}

/**
 * The laboratory a service order belongs to, or null when there is no such order.
 * A queue message names a service order, not its laboratory: this is the one
 * lookup per message that cannot name an organization yet (system path, one
 * column of one row by primary key). Everything after it runs in
 * `withOrgDbClient`; see `findOrganizationOnSystemPath`.
 */
export function findServiceOrderOrganization(
  env: Env,
  serviceOrderId: number,
): Promise<string | null> {
  return findOrganizationOnSystemPath(
    env,
    `service order ${serviceOrderId}`,
    "select organization_id from service_order where id = $1 limit 1",
    [serviceOrderId],
  );
}

/**
 * The service order row of a document, joined with everything the documents
 * print. Database only: the QR code and the logo (storage I/O) are built
 * afterwards by `buildServiceOrderDocumentData`, outside any transaction.
 */
async function readServiceOrderDocumentRow(
  client: Client,
  serviceOrderId: number,
): Promise<QueryResultRow | null> {
  const result = await client.query(
    `
    SELECT
      so.id,
      so.organization_id,
      so.unit_id,
      so.service_order_number,
      so.priority,
      so.intake_type,
      so.is_external_service,
      so.opened_at,
      so.service_started_at,
      so.claimed_defect,
      so.intake_condition,
      so.accessories,
      so.invoice_remittance_number,
      so.invoice_remittance_key,
      so.carrier_name,
      so.third_party_name,
      so.removed_sealing_mark_number,
      so.affixed_sealing_mark_number,
      so.inmetro_repair_mark_number,
      so.client_visible_notes,
      so.internal_notes,
      src.service_order_number as previous_so_number,
      tech.name as previous_technician_name,
      o.name as lab_name,
      o.cnpj as lab_cnpj,
      o.phone as lab_phone,
      o.email as lab_email,
      o.logo as lab_logo,
      o.permissionaria_authorization_number as lab_permissionaria_number,
      o.permissionaria_authorization_state as lab_permissionaria_state,
      ou.name as unit_name,
      c.name as customer_name,
      c.tax_id as customer_tax_id,
      c.phone as customer_phone,
      c.email as customer_email,
      c.address as customer_address,
      snap.asset_name,
      snap.asset_type,
      snap.manufacturer,
      snap.model,
      snap.serial_number,
      snap.patrimony_number,
      snap.observed_identification,
      snap.display_specs,
      snap.specifications,
      atype.definition as asset_type_definition,
      a.metrology_regime,
      settings.default_intake_terms
    FROM service_order so
    LEFT JOIN organization o ON so.organization_id = o.id
    LEFT JOIN organization_unit ou ON so.unit_id = ou.id
    LEFT JOIN customer c ON so.customer_id = c.id
    LEFT JOIN service_order_asset_snapshot snap ON snap.service_order_id = so.id
    LEFT JOIN asset a ON a.id = snap.asset_id
    LEFT JOIN asset_type atype ON atype.id = a.asset_type_id
    LEFT JOIN service_order_settings settings ON settings.organization_id = so.organization_id
    LEFT JOIN service_order src ON src.id = so.source_service_order_id
    LEFT JOIN "user" tech ON tech.id = src.responsible_technician_id
    WHERE so.id = $1
    `,
    [serviceOrderId],
  );

  return result.rows[0] ?? null;
}

async function buildServiceOrderDocumentData(
  env: Env,
  row: QueryResultRow,
  serviceOrderId: number,
): Promise<ServiceOrderDocumentData> {
  const qrSvg = await QRCode.toString(
    `${portalBaseUrl()}/service-orders/${row.id}`,
    {
      type: "svg",
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
    },
  );

  const labLogoUrl = await resolveOrganizationLogoDataUrl(
    env,
    row.lab_logo,
    serviceOrderId,
  );

  // Blueprint-driven instrument specs: use the list frozen at intake; for snapshots
  // created before migration 0056 (display_specs NULL), fall back to formatting from
  // the live asset-type blueprint + the frozen specifications values.
  const assetSpecs =
    Array.isArray(row.display_specs) && row.display_specs.length > 0
      ? row.display_specs
      : formatSpecificationsForDisplay(
          row.asset_type_definition,
          row.specifications,
        );

  return {
    serviceOrderNumber: row.service_order_number,
    openedAt: row.opened_at,
    intakeType: row.intake_type,
    isExternalService: row.is_external_service ?? false,
    serviceStartedAt: row.service_started_at,
    requestedServices:
      row.priority === "warranty"
        ? ["Garantia"]
        : ["Orçamento", "Manutenção corretiva"],
    previousServiceOrderNumber: row.previous_so_number,
    previousTechnicianName: row.previous_technician_name,
    lab: {
      name: row.lab_name ?? "Laboratório",
      cnpj: row.lab_cnpj,
      phone: row.lab_phone,
      email: row.lab_email,
      address: null,
      logoUrl: labLogoUrl,
      authorizationNumber: composePermissionariaAuthorization(
        row.lab_permissionaria_number,
        row.lab_permissionaria_state,
      ),
    },
    unit: { name: row.unit_name },
    customer: {
      name: row.customer_name ?? "Cliente",
      taxId: row.customer_tax_id,
      phone: row.customer_phone,
      email: row.customer_email,
      address: formatAddress(row.customer_address),
    },
    asset: {
      name: row.asset_name ?? "Instrumento",
      type: row.asset_type,
      manufacturer: row.manufacturer,
      model: row.model,
      serialNumber: row.serial_number,
      patrimonyNumber: row.patrimony_number,
      observedIdentification: row.observed_identification,
      specs: assetSpecs,
      metrologyRegime: row.metrology_regime ?? "INDUSTRIAL",
    },
    intake: {
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
      clientVisibleNotes: row.client_visible_notes,
      internalNotes: row.internal_notes,
      terms: row.default_intake_terms,
    },
    qrCodeDataUrl: `data:image/svg+xml;base64,${btoa(qrSvg)}`,
    publicUrl: `${portalBaseUrl()}/service-orders/${row.id}`,
  };
}

/**
 * The document data and the organization reference of a service order of the
 * laboratory: one short transaction for the rows, then the QR code and the logo
 * (storage I/O) after it ended. Null when the order does not exist.
 */
export async function loadServiceOrderDocumentBase(
  env: Env,
  organizationId: string,
  serviceOrderId: number,
): Promise<{ data: ServiceOrderDocumentData; org: OrgRef } | null> {
  const read = await withOrgDbClient(env, organizationId, async (client) => {
    const row = await readServiceOrderDocumentRow(client, serviceOrderId);
    if (!row) return null;
    return { row, org: await fetchOrgRefById(client, organizationId) };
  });
  if (!read) return null;
  return {
    data: await buildServiceOrderDocumentData(env, read.row, serviceOrderId),
    org: read.org,
  };
}

export async function processServiceOrderIntakeDocument(
  env: Env,
  serviceOrderId: number,
  documentId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const organizationId = await findServiceOrderOrganization(
      env,
      serviceOrderId,
    );
    const base = organizationId
      ? await loadServiceOrderDocumentBase(env, organizationId, serviceOrderId)
      : null;
    if (!organizationId || !base) {
      return { success: false, error: "Service order not found" };
    }
    const { data, org } = base;
    const html = renderToString(
      React.createElement(ServiceOrderIntakeDocumentHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(data.openedAt, "openedAt");
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: data.serviceOrderNumber,
      year,
      month,
      type: "INTAKE",
      version: 1,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withOrgDbClient(env, organizationId, async (client) => {
      if (documentId) {
        await client.query(
          `UPDATE service_order_intake_document SET pdf_r2_key = $2, issued_at = COALESCE(issued_at, now()), issued_by_user_id = COALESCE(issued_by_user_id, $3) WHERE id = $1`,
          [documentId, key, userId],
        );
      } else {
        await client.query(
          `INSERT INTO service_order_intake_document (organization_id, service_order_id, document_number, version, type, pdf_r2_key, issued_at, issued_by_user_id)
           SELECT so.organization_id, so.id, $2::text, 1, 'combined', $3::text, now(), $4::text
             FROM service_order so WHERE so.id = $1
           ON CONFLICT DO NOTHING`,
          [serviceOrderId, `${data.serviceOrderNumber}/REC`, key, userId],
        );
      }
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
