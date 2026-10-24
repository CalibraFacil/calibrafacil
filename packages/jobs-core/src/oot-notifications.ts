import { renderToString } from "react-dom/server";
import {
  OotNotificationHtml,
  type OotNotificationDocumentData,
} from "@calibra-facil/documents";
import React from "react";
import { ootNotificationKey } from "@calibra-facil/shared/storage-keys";
import { type Env } from "./runtime-types.js";
import {
  findOrganizationOnSystemPath,
  generatePdfFromHtml,
  withOrgDbClient,
} from "./pdf-render.js";
import {
  bucketBinding,
  resolveOrganizationLogoDataUrl,
  sha256Hex,
} from "./storage-helpers.js";

// =============================================================================
// §7.10 OUT-OF-TOLERANCE CUSTOMER NOTIFICATION (#426 Phase 0)
// =============================================================================

type OotNotificationRow = {
  id: number;
  organization_id: string;
  nc_id: number;
  job_id: number;
  certificate_number: string | null;
  recipient_name: string | null;
  affected_scope: string | null;
  nc_number: string;
  nc_description: string;
  performed_at: Date | string | null;
  approved_at: Date | string | null;
  asset_id: number;
  as_found_margins: unknown;
  lab_name: string | null;
  lab_cnpj: string | null;
  lab_phone: string | null;
  lab_email: string | null;
  lab_logo: string | null;
  org_slug: string | null;
  customer_name: string | null;
  customer_email: string | null;
  asset_name: string | null;
  asset_tag: string | null;
  asset_serial: string | null;
  // #426 Phase 1: set when the notification belongs to a standard recall —
  // switches the letter to the recall variant.
  recall_id: number | null;
  std_name: string | null;
  std_serial: string | null;
  std_certificate: string | null;
  std_calibration_date: Date | string | null;
};

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

export async function processOotNotification(
  env: Env,
  notificationId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    // The message names a notification, not its laboratory: one lookup on the
    // system path (one column of one row by primary key), then every statement
    // runs in a transaction that names it. No transaction spans the logo read,
    // Gotenberg or storage.
    const organizationId = await findOrganizationOnSystemPath(
      env,
      `OOT notification ${notificationId}`,
      "select organization_id from oot_notification where id = $1 limit 1",
      [notificationId],
    );
    if (!organizationId) {
      return { success: false, error: "OOT notification not found" };
    }

    const loaded = await withOrgDbClient(
      env,
      organizationId,
      async (client) => {
        const result = await client.query<OotNotificationRow>(
          `
        SELECT
          n.id,
          n.organization_id,
          n.nc_id,
          n.job_id,
          n.certificate_number,
          n.recipient_name,
          n.affected_scope,
          nc.nc_number,
          nc.description as nc_description,
          j.performed_at,
          j.approved_at,
          j.asset_id,
          j.as_found_margins,
          o.name as lab_name,
          o.cnpj as lab_cnpj,
          o.phone as lab_phone,
          o.email as lab_email,
          o.logo as lab_logo,
          o.slug as org_slug,
          c.name as customer_name,
          c.email as customer_email,
          a.name as asset_name,
          a.tag as asset_tag,
          a.serial_number as asset_serial,
          n.recall_id,
          rs.name as std_name,
          rs.serial_number as std_serial,
          rs.certificate_number as std_certificate,
          rs.calibration_date as std_calibration_date
        FROM oot_notification n
        INNER JOIN non_conformance nc ON nc.id = n.nc_id
        INNER JOIN calibration_job j ON j.id = n.job_id
        INNER JOIN organization o ON o.id = n.organization_id
        INNER JOIN customer c ON c.id = j.customer_id
        INNER JOIN asset a ON a.id = j.asset_id
        LEFT JOIN standard_recall sr ON sr.id = n.recall_id
        LEFT JOIN reference_standard rs ON rs.id = sr.standard_id
        WHERE n.id = $1
        `,
          [notificationId],
        );
        const found = result.rows[0];
        if (!found) return null;

        // Start of the potentially affected period: the previous approved
        // calibration of the same asset (the last known-good state).
        const previous = await client.query<{
          performed_at: Date | string | null;
        }>(
          `
        SELECT j2.performed_at
        FROM calibration_job j2
        WHERE j2.asset_id = $1
          AND j2.id <> $2
          AND j2.status IN ('APPROVED', 'SUPERSEDED')
          AND j2.approved_at < COALESCE($3, now())
        ORDER BY j2.approved_at DESC
        LIMIT 1
        `,
          [found.asset_id, found.job_id, toDateOrNull(found.approved_at)],
        );
        return {
          row: found,
          previousCalibration: toDateOrNull(previous.rows[0]?.performed_at),
        };
      },
    );

    if (!loaded) return { success: false, error: "OOT notification not found" };
    const { row, previousCalibration } = loaded;

    const labLogoUrl = await resolveOrganizationLogoDataUrl(
      env,
      row.lab_logo,
      row.job_id,
    );

    const margins = toNumberArray(row.as_found_margins);
    const isStandardRecall = row.recall_id !== null && row.std_name !== null;
    const data: OotNotificationDocumentData = {
      kind: isStandardRecall ? "standard_recall" : "as_found",
      standard: isStandardRecall
        ? {
            name: row.std_name ?? "Padrão de referência",
            serialNumber: row.std_serial,
            certificateNumber: row.std_certificate,
            calibrationDate: toDateOrNull(row.std_calibration_date),
          }
        : null,
      ncNumber: row.nc_number,
      issuedAt: new Date(),
      lab: {
        name: row.lab_name ?? "Laboratório",
        taxId: row.lab_cnpj,
        address: null,
        email: row.lab_email,
        phone: row.lab_phone,
        logoUrl: labLogoUrl,
      },
      customer: {
        name: row.recipient_name ?? row.customer_name ?? "Cliente",
        email: row.customer_email,
      },
      instrument: {
        description: row.asset_name ?? "Instrumento",
        tag: row.asset_tag,
        serialNumber: row.asset_serial,
      },
      certificateNumber: row.certificate_number,
      calibrationDate: toDateOrNull(row.performed_at),
      previousCalibrationDate: previousCalibration,
      asFound: {
        pointsTotal: margins.length,
        pointsWithin: margins.filter((margin) => margin >= 0).length,
        worstMargin: margins.length > 0 ? Math.min(...margins) : null,
      },
      affectedScope: row.affected_scope,
      description: row.nc_description,
    };

    const html = renderToString(
      React.createElement(OotNotificationHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(env, html);

    const { bucket, key } = ootNotificationKey({
      org: { id: row.organization_id, slug: row.org_slug ?? "" },
      notificationId: row.id,
      ncNumber: row.nc_number,
      year: (toDateOrNull(row.approved_at) ?? new Date()).getUTCFullYear(),
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });

    // Record the artifact. Only PENDING advances to GENERATED — a re-render
    // must never regress a notification already SENT/ACKNOWLEDGED.
    await withOrgDbClient(env, organizationId, (client) =>
      client.query(
        `
        UPDATE oot_notification
        SET pdf_r2_key = $2,
            pdf_sha256 = $3,
            status = CASE WHEN status = 'PENDING' THEN 'GENERATED' ELSE status END,
            updated_at = now()
        WHERE id = $1
        `,
        [row.id, key, sha256Hex(pdfBuffer)],
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
