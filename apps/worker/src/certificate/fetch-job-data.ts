/**
 * The SQL projection from an approved calibration job to `CertificateJobData`.
 *
 * Restored for Phase 3 from the pre-removal worker (`git show abfea552`), with
 * three deliberate differences from what was deleted:
 *
 *   1. No certificate-template resolution. The old version, on finding no
 *      frozen snapshot, went looking for the org's default ACTIVE template and
 *      WROTE it back onto the job. That whole concept died with the
 *      lab-authored templates (#865) — the layout is now ours and is chosen by
 *      the method's quantity, not by a row a lab configured.
 *   2. `method_deviations` is selected. §7.8.2.1(n) content the product had
 *      nowhere to record until migration 0106.
 *   3. The service-order LATERAL join carries `opened_at`, `intake_condition`
 *      and `accessories`, not just the repair-mark number. Those are
 *      §7.8.2.1(g) and (h) — condition on receipt and date of receipt — which
 *      the XLSX layout never printed and the fixed layout does.
 *
 * It lives in its own module rather than back in `index.ts` (2,300 lines
 * already) so the query is readable and the issuance pipeline can be followed
 * without scrolling past it.
 */

import type { CertificateJobData } from "@calibra-facil/certificate-data";
import type { Client } from "pg";

/**
 * Only what this module needs from the worker's env, so the query can be
 * exercised without standing up the whole runtime.
 */
export type FetchJobDataDeps = {
  /** Resolves the org logo (an R2 key or a URL) to a self-contained data URI. */
  resolveLogoDataUrl: (logo: string | null) => Promise<string | null>;
  /** Fetches the approver's visual signature from R2 as a data URI. */
  resolveSignatureDataUrl: (
    r2Key: string,
    contentType: string,
  ) => Promise<string | null>;
};

const JOB_QUERY = `
  SELECT
    cj.job_id,
    cj.certificate_name,
    cj.unit_id,
    cj.performed_at,
    cj.approved_at,
    cj.method_snapshot,
    cj.asset_snapshot,
    cj.standards_snapshot,
    cj.environmental_snapshot,
    cj.calibration_location_snapshot,
    cj.calibration_phase_snapshot,
    cj.results,
    cj.data,
    cj.organization_id,
    cj.approved_by,
    cj.verification_token,
    -- §7.8.4.1 amendment chain
    cj.supersedes_id,
    cj.superseded_by_id,
    cj.amendment_number,
    cj.amendment_reason,
    -- #427: non-null downgrades the issuance to non-accredited
    cj.scope_override_justification,
    -- §7.8.2.1(n), added in 0106
    cj.method_deviations,
    o.name as lab_name,
    o.cnpj as lab_cnpj,
    o.accreditation_number as lab_accreditation_number,
    o.accreditation_body as lab_accreditation_body,
    o.accreditation_active as lab_accreditation_active,
    o.accreditation_valid_from as lab_accreditation_valid_from,
    o.accreditation_valid_until as lab_accreditation_valid_until,
    o.street as lab_street,
    o.number as lab_number,
    o.complement as lab_complement,
    o.neighbourhood as lab_neighbourhood,
    o.city as lab_city,
    o.state as lab_state,
    o.cep as lab_cep,
    o.phone as lab_phone,
    o.email as lab_email,
    o.website as lab_website,
    o.logo as lab_logo,
    o.slug as organization_slug,
    o.technical_manager_name as lab_technical_manager_name,
    o.technical_manager_title as lab_technical_manager_title,
    c.name as customer_name,
    c.tax_id as customer_tax_id,
    c.phone as customer_phone,
    c.email as customer_email,
    c.address as customer_address,
    a.name as asset_name,
    a.serial_number,
    a.tag,
    a.model,
    a.manufacturer,
    u.name as approver_name,
    original.job_id as original_job_id,
    original.approved_at as original_approved_at,
    service_order_link.inmetro_repair_mark_number,
    service_order_link.received_at as service_order_received_at,
    service_order_link.intake_condition as service_order_intake_condition,
    service_order_link.accessories as service_order_accessories,
    snapshot_method.accredited_scope as method_accredited_scope_current
  FROM calibration_job cj
  LEFT JOIN organization o ON cj.organization_id = o.id
  LEFT JOIN calibration_method snapshot_method
    ON snapshot_method.id = NULLIF(cj.method_snapshot->>'methodId', '')::int
    AND snapshot_method.organization_id = cj.organization_id
  LEFT JOIN customer c ON cj.customer_id = c.id
  LEFT JOIN asset a ON cj.asset_id = a.id
  LEFT JOIN "user" u ON cj.approved_by = u.id
  LEFT JOIN calibration_job original ON cj.supersedes_id = original.id
  LEFT JOIN LATERAL (
    SELECT
      so.inmetro_repair_mark_number,
      -- The OS is opened when the item comes in over the counter, so
      -- opened_at IS the §7.8.2.1(h) date of receipt. There is no separate
      -- received_at column, and inventing one would only let the two drift.
      so.opened_at as received_at,
      so.intake_condition,
      so.accessories
    FROM service_order_certificate_link socl
    INNER JOIN service_order so ON so.id = socl.service_order_id
    WHERE socl.certificate_job_id = cj.id
    ORDER BY socl.linked_at DESC
    LIMIT 1
  ) service_order_link ON true
  WHERE cj.id = $1
`;

const SIGNATURE_QUERY = `
  SELECT mvs.r2_key, mvs.content_type
  FROM member_visual_signature mvs
  INNER JOIN member m ON mvs.member_id = m.id
  WHERE m.user_id = $1 AND mvs.organization_id = $2
`;

export async function fetchCertificateJobData(
  client: Client,
  jobId: number,
  deps: FetchJobDataDeps,
): Promise<CertificateJobData | null> {
  const result = await client.query(JOB_QUERY, [jobId]);
  const row = result.rows[0];
  if (!row) return null;

  const labLogoUrl = await deps.resolveLogoDataUrl(row.lab_logo ?? null);

  let approverSignatureUrl: string | null = null;
  if (row.approved_by && row.organization_id) {
    const signatureResult = await client.query(SIGNATURE_QUERY, [
      row.approved_by,
      row.organization_id,
    ]);
    const signatureRow = signatureResult.rows[0];
    if (signatureRow) {
      // A missing or unreadable signature image must not fail the issuance:
      // the certificate is authorised by the signatory's NAME plus the PAdES
      // signature on the file. The drawn image is decoration.
      try {
        approverSignatureUrl = await deps.resolveSignatureDataUrl(
          signatureRow.r2_key,
          signatureRow.content_type,
        );
      } catch (error) {
        console.warn(
          `[JOB ${jobId}] Failed to fetch approver signature:`,
          error,
        );
      }
    }
  }

  return {
    jobId: row.job_id,
    verificationToken: row.verification_token,
    certificateName: row.certificate_name,
    organizationId: row.organization_id,
    organizationSlug: row.organization_slug,
    unitId: row.unit_id,
    performedAt: row.performed_at,
    approvedAt: row.approved_at,
    lab: {
      name: row.lab_name || "Laboratório de Calibração",
      cnpj: row.lab_cnpj,
      accreditationNumber: row.lab_accreditation_number,
      accreditationBody: row.lab_accreditation_body,
      accreditationActive: row.lab_accreditation_active,
      accreditationValidFrom: row.lab_accreditation_valid_from,
      accreditationValidUntil: row.lab_accreditation_valid_until,
      street: row.lab_street,
      number: row.lab_number,
      complement: row.lab_complement,
      neighbourhood: row.lab_neighbourhood,
      city: row.lab_city,
      state: row.lab_state,
      cep: row.lab_cep,
      phone: row.lab_phone,
      email: row.lab_email,
      website: row.lab_website,
      logo: labLogoUrl,
      technicalManagerName: row.lab_technical_manager_name,
      technicalManagerTitle: row.lab_technical_manager_title,
    },
    customer: {
      name: row.customer_name,
      taxId: row.customer_tax_id,
      phone: row.customer_phone,
      email: row.customer_email,
      address: row.customer_address,
    },
    asset: {
      name: row.asset_name,
      serialNumber: row.serial_number,
      tag: row.tag,
      model: row.model,
      manufacturer: row.manufacturer,
    },
    // Legacy and offline snapshots may predate the accredited-scope flag; fall
    // back to the method's current flag so older jobs still seal correctly.
    methodSnapshot: row.method_snapshot
      ? {
          ...row.method_snapshot,
          accreditedScope:
            row.method_snapshot.accreditedScope ??
            row.method_accredited_scope_current ??
            false,
        }
      : row.method_snapshot,
    assetSnapshot: row.asset_snapshot,
    scopeOverrideJustification: row.scope_override_justification,
    standardsSnapshot: row.standards_snapshot,
    methodDeviations: row.method_deviations,
    serviceOrder: {
      inmetroRepairMarkNumber: row.inmetro_repair_mark_number,
      receivedAt: row.service_order_received_at,
      intakeCondition: row.service_order_intake_condition,
      accessories: row.service_order_accessories,
    },
    environmentalSnapshot: row.environmental_snapshot,
    calibrationLocationSnapshot: row.calibration_location_snapshot,
    calibrationPhaseSnapshot: row.calibration_phase_snapshot,
    data: row.data,
    results: row.results,
    approverName: row.approver_name,
    approverSignatureUrl,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    amendmentNumber: row.amendment_number,
    amendmentReason: row.amendment_reason,
    originalJobId: row.original_job_id,
    originalApprovedAt: row.original_approved_at,
  };
}
