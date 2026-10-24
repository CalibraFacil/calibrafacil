import { renderToString } from "react-dom/server";
import {
  ServiceOrderDeliveryReceiptHtml,
  ServiceOrderQuoteHtml,
  ServiceOrderTagHtml,
  type ServiceOrderDeliveryReceiptData,
  type ServiceOrderQuoteData,
  type ServiceOrderTagData,
} from "@calibra-facil/documents";
import React from "react";
import QRCode from "qrcode";
import {
  getYearMonth,
  serviceOrderDocKey,
} from "@calibra-facil/shared/storage-keys";
import { appBaseUrl } from "@calibra-facil/shared/public-urls";
import { type Env } from "./runtime-types.js";
import { generatePdfFromHtml, withOrgDbClient } from "./pdf-render.js";
import {
  findServiceOrderOrganization,
  loadServiceOrderDocumentBase,
} from "./service-order-data.js";
import { bucketBinding, fetchOrgRefById } from "./storage-helpers.js";

export async function processServiceOrderTag(
  env: Env,
  serviceOrderId: number,
  tagId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // The message names a service order, not its laboratory: one lookup on the
    // system path, then every statement runs in a transaction that names it, and
    // none spans the QR code, Gotenberg or storage.
    const organizationId = await findServiceOrderOrganization(
      env,
      serviceOrderId,
    );
    if (!organizationId) {
      return { success: false, error: "Service order not found" };
    }
    const read = await withOrgDbClient(env, organizationId, async (client) => {
      const result = await client.query(
        `
        SELECT so.organization_id, so.service_order_number, so.opened_at,
          c.name AS customer_name, snap.asset_name, snap.serial_number, snap.patrimony_number,
          tag.id AS tag_id, tag.tag_number
        FROM service_order so
        LEFT JOIN customer c ON so.customer_id = c.id
        LEFT JOIN service_order_asset_snapshot snap ON snap.service_order_id = so.id
        LEFT JOIN service_order_tag tag ON tag.service_order_id = so.id
        WHERE so.id = $1
        ORDER BY tag.id DESC
        LIMIT 1
        `,
        [serviceOrderId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { row, org: await fetchOrgRefById(client, organizationId) };
    });
    if (!read) return { success: false, error: "Service order not found" };
    const { row: data, org } = read;
    const qrSvg = await QRCode.toString(
      `${appBaseUrl()}/dashboard/service-orders/${serviceOrderId}`,
      { type: "svg", width: 200, margin: 1, errorCorrectionLevel: "M" },
    );
    const tag: ServiceOrderTagData = {
      serviceOrderNumber: data.service_order_number,
      customerName: data.customer_name ?? "Cliente",
      assetName: data.asset_name ?? "Instrumento",
      serialNumber: data.serial_number,
      patrimonyNumber: data.patrimony_number,
      openedAt: data.opened_at,
      qrCodeDataUrl: `data:image/svg+xml;base64,${btoa(qrSvg)}`,
    };
    const html = renderToString(
      React.createElement(ServiceOrderTagHtml, { tag }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(data.opened_at, "openedAt");
    const tagNumber =
      data.tag_number ?? `${data.service_order_number}-TAG-${serviceOrderId}`;
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: data.service_order_number,
      year,
      month,
      type: "TAG",
      tagNumber,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withOrgDbClient(env, organizationId, async (client) => {
      if (tagId ?? data.tag_id) {
        await client.query(
          `UPDATE service_order_tag SET pdf_r2_key = $2, printed_at = COALESCE(printed_at, now()), printed_by_user_id = COALESCE(printed_by_user_id, $3) WHERE id = $1`,
          [tagId ?? data.tag_id, key, userId],
        );
      } else {
        await client.query(
          `INSERT INTO service_order_tag (organization_id, service_order_id, tag_number, pdf_r2_key, printed_at, printed_by_user_id)
           SELECT so.organization_id, so.id, $2::text, $3::text, now(), $4::text
             FROM service_order so WHERE so.id = $1`,
          [serviceOrderId, tagNumber, key, userId],
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

export async function processServiceOrderQuote(
  env: Env,
  serviceOrderId: number,
  quoteId: number | undefined,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!quoteId) return { success: false, error: "Missing quoteId" };
    const organizationId = await findServiceOrderOrganization(
      env,
      serviceOrderId,
    );
    const loaded = organizationId
      ? await loadServiceOrderDocumentBase(env, organizationId, serviceOrderId)
      : null;
    if (!organizationId || !loaded) {
      return { success: false, error: "Service order not found" };
    }
    const { data: base, org } = loaded;
    const quote = await withOrgDbClient(env, organizationId, async (client) => {
      const quoteResult = await client.query(
        `SELECT * FROM service_order_quote WHERE id = $1`,
        [quoteId],
      );
      const itemsResult = await client.query(
        `SELECT description, quantity, unit, unit_price_cents, total_price_cents, type
         FROM service_order_quote_item WHERE quote_id = $1 ORDER BY sort_order, id`,
        [quoteId],
      );
      return { row: quoteResult.rows[0], items: itemsResult.rows };
    });
    if (!quote.row) return { success: false, error: "Quote not found" };
    const data: ServiceOrderQuoteData = {
      ...base,
      quote: {
        quoteNumber: quote.row.quote_number,
        version: quote.row.version,
        validUntil: quote.row.valid_until,
        paymentTerms: quote.row.payment_terms,
        deliveryEstimate: quote.row.delivery_estimate,
        warrantyTerms: quote.row.warranty_terms,
        clientMessage: quote.row.client_message,
        items: quote.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unit_price_cents,
          totalPriceCents: item.total_price_cents,
          type: item.type,
        })),
        subtotalServicesCents: quote.row.subtotal_services_cents,
        subtotalPartsCents: quote.row.subtotal_parts_cents,
        discountCents: quote.row.discount_cents,
        freightCents: quote.row.freight_cents,
        totalCents: quote.row.total_cents,
      },
    };
    const html = renderToString(
      React.createElement(ServiceOrderQuoteHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(base.openedAt, "openedAt");
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      month,
      type: "QUOTE",
      quoteNumber: quote.row.quote_number,
      version: quote.row.version,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withOrgDbClient(env, organizationId, (client) =>
      client.query(
        `UPDATE service_order_quote SET pdf_r2_key = $2 WHERE id = $1`,
        [quoteId, key],
      ),
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function processServiceOrderDeliveryReceipt(
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
    const loaded = organizationId
      ? await loadServiceOrderDocumentBase(env, organizationId, serviceOrderId)
      : null;
    if (!organizationId || !loaded) {
      return { success: false, error: "Service order not found" };
    }
    const { data: base } = loaded;

    const payload = await withOrgDbClient(
      env,
      organizationId,
      async (client) => {
        const documentResult = await client.query(
          `
        SELECT *
        FROM service_order_delivery_document
        WHERE service_order_id = $1
          AND ($2::integer IS NULL OR id = $2)
        ORDER BY version DESC
        LIMIT 1
        `,
          [serviceOrderId, documentId ?? null],
        );
        const orderResult = await client.query(
          `
        SELECT organization_id, service_order_number, opened_at, delivered_at,
          delivered_to_name, delivered_to_document, delivery_method, delivery_notes,
          inmetro_repair_mark_number, inmetro_repair_mark_issued_at
        FROM service_order
        WHERE id = $1
        `,
          [serviceOrderId],
        );
        const executionResult = await client.query(
          `
        SELECT *
        FROM service_order_execution
        WHERE service_order_id = $1
        LIMIT 1
        `,
          [serviceOrderId],
        );
        const execution = executionResult.rows[0];
        const itemsResult = execution
          ? await client.query(
              `
            SELECT description, quantity, unit, unit_price_cents, total_price_cents, type
            FROM service_order_execution_item
            WHERE execution_id = $1
            ORDER BY sort_order, id
            `,
              [execution.id],
            )
          : { rows: [] };
        return {
          document: documentResult.rows[0],
          order: orderResult.rows[0],
          execution,
          items: itemsResult.rows,
        };
      },
    );

    if (!payload.document) {
      return { success: false, error: "Delivery document not found" };
    }
    if (!payload.order)
      return { success: false, error: "Service order not found" };

    const items = payload.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unit_price_cents,
      totalPriceCents: item.total_price_cents,
      type: item.type,
    }));
    const subtotalPartsCents = items
      .filter((item) => item.type === "part")
      .reduce((total, item) => total + item.totalPriceCents, 0);
    const subtotalServicesCents = items
      .filter((item) => item.type !== "part")
      .reduce((total, item) => total + item.totalPriceCents, 0);
    const totalCents = items.reduce(
      (total, item) => total + item.totalPriceCents,
      0,
    );

    const data: ServiceOrderDeliveryReceiptData = {
      ...base,
      delivery: {
        documentNumber: payload.document.document_number,
        version: payload.document.version,
        issuedAt: payload.document.issued_at,
        deliveredAt: payload.order.delivered_at,
        deliveredToName: payload.order.delivered_to_name,
        deliveredToDocument: payload.order.delivered_to_document,
        deliveryMethod: payload.order.delivery_method,
        deliveryNotes: payload.order.delivery_notes,
        inmetroRepairMarkNumber: payload.order.inmetro_repair_mark_number,
        inmetroRepairMarkIssuedAt: payload.order.inmetro_repair_mark_issued_at,
        technicianSignature: payload.document.technician_signature_data,
        clientSignature: payload.document.client_signature_data,
      },
      execution: {
        servicePerformed: payload.execution?.service_performed,
        partsUsedSummary: payload.execution?.parts_used_summary,
        technicalNotes: payload.execution?.technical_notes,
        result: payload.execution?.result,
        finishedAt: payload.execution?.finished_at,
        items,
        subtotalServicesCents,
        subtotalPartsCents,
        totalCents,
      },
    };

    const html = renderToString(
      React.createElement(ServiceOrderDeliveryReceiptHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);
    const { year, month } = getYearMonth(base.openedAt, "openedAt");
    const { org } = loaded;
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      month,
      type: "DELIVERY",
      version: payload.document.version,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withOrgDbClient(env, organizationId, (client) =>
      client.query(
        `UPDATE service_order_delivery_document
         SET pdf_r2_key = $2, issued_at = COALESCE(issued_at, now()), issued_by_user_id = COALESCE(issued_by_user_id, $3)
         WHERE id = $1`,
        [payload.document.id, key, userId],
      ),
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
