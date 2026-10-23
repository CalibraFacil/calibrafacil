import {
  renderFleetStatusReportHtml,
  classifyFleetDueStatus,
  FLEET_DUE_SOON_DAYS,
  type FleetStatusAsset,
} from "@calibra-facil/documents";
import { zipSync, strToU8, type Zippable } from "fflate";
import { Workbook } from "@cj-tech-master/excelts";
import type { AuditPackBackgroundJobMessage } from "@calibra-facil/schemas";
import { portalAuditPackKey } from "@calibra-facil/shared/storage-keys";
import { notifyAuditPackReady } from "@calibra-facil/notifications";
import { type Env } from "./runtime-types.js";
import {
  generatePdfFromHtml,
  getErrorMessage,
  withDbClient,
} from "./pdf-render.js";
import {
  AUDIT_PACK_EXPIRY_DAYS,
  AUDIT_PACK_MAX_CERTIFICATES,
  AUDIT_PACK_MAX_TOTAL_BYTES,
  type AuditPackCertificateRow,
  auditPackFileName,
  buildAuditPackReadme,
  parseAuditPackParams,
  portalBaseUrl,
  renderAuditPackIndexHtml,
} from "./audit-pack-support.js";
import { bucketBinding, getStoredObject } from "./storage-helpers.js";

export async function processAuditPackJob(
  env: Env,
  message: AuditPackBackgroundJobMessage,
) {
  const totalStart = performance.now();
  const exportId = message.exportId;
  console.log(`[AUDIT PACK ${exportId}] Starting`);

  try {
    const exportRow = await withDbClient(env, async (client) => {
      const result = await client.query<{
        id: number;
        lab_organization_id: string;
        auth_organization_id: string;
        auth_organization_name: string;
        organization_slug: string | null;
        lab_organization_name: string;
        params: unknown;
      }>(
        `
          update portal_export_job pe
          set status = 'PROCESSING', updated_at = now()
          from organization lab, organization auth
          where pe.id = $1
            and lab.id = pe.lab_organization_id
            and auth.id = pe.auth_organization_id
            and pe.status in ('PENDING', 'PROCESSING')
          returning
            pe.id,
            pe.lab_organization_id,
            pe.auth_organization_id,
            auth.name as auth_organization_name,
            lab.slug as organization_slug,
            lab.name as lab_organization_name,
            pe.params
        `,
        [exportId],
      );
      return result.rows[0] ?? null;
    });

    if (!exportRow) {
      throw new Error("Audit pack export not found");
    }

    const params = parseAuditPackParams(exportRow.params);
    const generatedAtIso = new Date().toISOString();
    const labName = exportRow.lab_organization_name;
    const customerName = exportRow.auth_organization_name;
    const showUnit = params.customerIds.length > 1;

    // Certificates are needed for both the PDF folder and the index.
    const wantsCertificateRows =
      params.include.certificates || params.include.verificationIndex;

    const certificates = wantsCertificateRows
      ? await withDbClient(env, async (client) => {
          // Same window semantics as the portal /certificates list: approval
          // date in America/Sao_Paulo, latest (non-superseded) version only.
          const candidates = await client.query<AuditPackCertificateRow>(
            `
              select
                cj.id,
                cj.job_id,
                cj.certificate_name,
                cj.certificate_url,
                cj.verification_token,
                to_char((cj.approved_at at time zone 'utc' at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as approved_date,
                a.tag as asset_tag,
                a.name as asset_name,
                a.serial_number,
                c.name as customer_name
              from calibration_job cj
              inner join asset a on a.id = cj.asset_id
              inner join customer c on c.id = cj.customer_id
              where cj.customer_id = any($1::int[])
                and cj.status = 'APPROVED'
                and cj.superseded_by_id is null
                and cj.certificate_url is not null
                and (cj.approved_at at time zone 'utc' at time zone 'America/Sao_Paulo')::date >= $2::date
                and (cj.approved_at at time zone 'utc' at time zone 'America/Sao_Paulo')::date <= $3::date
              order by cj.approved_at asc
            `,
            [params.customerIds, params.dateFrom, params.dateTo],
          );

          if (candidates.rows.length === 0) return [];

          // RELEASE GATE (hard requirement, #738): re-evaluated here at
          // generation time — a certificate held for billing/payment must
          // never reach the ZIP, even if it was released at enqueue time.
          const releases = await client.query<{
            calibration_job_id: number;
            status: string;
          }>(
            `
              select calibration_job_id, status
              from certificate_release
              where calibration_job_id = any($1::int[])
                and organization_id = $2
            `,
            [
              candidates.rows.map((row) => row.id),
              exportRow.lab_organization_id,
            ],
          );
          const held = new Set(
            releases.rows
              .filter(
                (row) =>
                  row.status === "HELD_FOR_BILLING" ||
                  row.status === "HELD_FOR_PAYMENT",
              )
              .map((row) => row.calibration_job_id),
          );
          return candidates.rows.filter((row) => !held.has(row.id));
        })
      : [];

    if (certificates.length > AUDIT_PACK_MAX_CERTIFICATES) {
      throw new Error(
        `O período selecionado tem mais de ${AUDIT_PACK_MAX_CERTIFICATES} certificados. Reduza o período e gere pacotes menores.`,
      );
    }

    const zipEntries: Zippable = {};
    let totalBytes = 0;
    let missingCount = 0;
    const includedJobIds: number[] = [];

    if (params.include.certificates) {
      const usedNames = new Set<string>();
      for (const cert of certificates) {
        const key = new URL(cert.certificate_url).pathname.slice(1);
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential downloads keep peak memory bounded to one PDF + the accumulated zip entries.
        const object = await getStoredObject(env, "documents", key);
        if (!object) {
          missingCount += 1;
          console.error(
            `[AUDIT PACK ${exportId}] Certificate PDF missing in R2, skipping`,
            { jobId: cert.job_id, key },
          );
          continue;
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
        const bytes = new Uint8Array(await object.arrayBuffer());
        totalBytes += bytes.byteLength;
        if (totalBytes > AUDIT_PACK_MAX_TOTAL_BYTES) {
          throw new Error(
            "O pacote excede o tamanho máximo suportado. Reduza o período e gere pacotes menores.",
          );
        }
        const base = auditPackFileName(
          `${cert.certificate_name ?? cert.job_id} - ${cert.asset_tag}`,
        );
        let name = `certificados/${base}.pdf`;
        for (let n = 2; usedNames.has(name); n += 1) {
          name = `certificados/${base}-${n}.pdf`;
        }
        usedNames.add(name);
        // PDFs are already compressed — store them instead of re-deflating.
        zipEntries[name] = [bytes, { level: 0 }];
        includedJobIds.push(cert.id);
      }
    } else {
      includedJobIds.push(...certificates.map((cert) => cert.id));
    }

    if (params.include.fleetReport) {
      const assets = await withDbClient(env, async (client) => {
        const result = await client.query<{
          tag: string;
          name: string;
          serial_number: string | null;
          manufacturer: string | null;
          model: string | null;
          customer_name: string;
          last_calibration_date: Date | null;
          next_calibration_date: Date | null;
          calibration_interval_months: number | null;
          metrology_regime: string;
          next_legal_verification_date: Date | null;
        }>(
          `
            select
              a.tag,
              a.name,
              a.serial_number,
              a.manufacturer,
              a.model,
              c.name as customer_name,
              a.last_calibration_date,
              a.next_calibration_date,
              a.calibration_interval_months,
              a.metrology_regime,
              a.next_legal_verification_date
            from asset a
            inner join customer c on c.id = a.customer_id
            where a.customer_id = any($1::int[])
              and a.status = 'ACTIVE'
              and a.deleted_at is null
            order by c.name asc, a.tag asc
          `,
          [params.customerIds],
        );
        return result.rows;
      });

      const fleetAssets: FleetStatusAsset[] = assets.map((asset) => ({
        name: asset.name,
        tag: asset.tag,
        serialNumber: asset.serial_number,
        manufacturer: asset.manufacturer,
        model: asset.model,
        unitName: showUnit ? asset.customer_name : null,
        lastCalibrationDate: asset.last_calibration_date?.toISOString() ?? null,
        nextCalibrationDate: asset.next_calibration_date?.toISOString() ?? null,
        calibrationIntervalMonths: asset.calibration_interval_months,
        metrologyRegime: asset.metrology_regime,
        nextLegalVerificationDate:
          asset.next_legal_verification_date?.toISOString() ?? null,
      }));

      const fleetHtml = renderFleetStatusReportHtml({
        labName,
        customerName,
        generatedAtIso,
        dueSoonDays: FLEET_DUE_SOON_DAYS,
        assets: fleetAssets,
      });
      const fleetPdf = await generatePdfFromHtml(env, fleetHtml);
      zipEntries["relatorio-frota.pdf"] = [fleetPdf, { level: 0 }];

      const workbook = new Workbook();
      const sheet = workbook.addWorksheet("Situação da frota");
      const now = new Date(generatedAtIso);
      const header = [
        ...(showUnit ? ["Unidade"] : []),
        "Tag",
        "Instrumento",
        "Fabricante",
        "Modelo",
        "Nº de série",
        "Última calibração",
        "Próxima calibração",
        "Periodicidade (meses)",
        "Regime metrológico",
        "Próxima verificação legal",
        "Situação",
      ];
      sheet.addRow(header);
      for (const asset of fleetAssets) {
        const due = classifyFleetDueStatus(
          asset.nextCalibrationDate
            ? new Date(asset.nextCalibrationDate)
            : null,
          now,
          FLEET_DUE_SOON_DAYS,
        );
        sheet.addRow([
          ...(showUnit ? [asset.unitName ?? ""] : []),
          asset.tag,
          asset.name,
          asset.manufacturer ?? "",
          asset.model ?? "",
          asset.serialNumber ?? "",
          asset.lastCalibrationDate?.slice(0, 10) ?? "",
          asset.nextCalibrationDate?.slice(0, 10) ?? "",
          asset.calibrationIntervalMonths ?? "",
          asset.metrologyRegime,
          asset.nextLegalVerificationDate?.slice(0, 10) ?? "",
          due.label,
        ]);
      }
      const xlsxBytes = new Uint8Array(
        await workbook.xlsx.writeBuffer({ validate: false }),
      );
      zipEntries["relatorio-frota.xlsx"] = [xlsxBytes, { level: 0 }];
    }

    if (params.include.verificationIndex) {
      zipEntries["indice.html"] = strToU8(
        renderAuditPackIndexHtml({
          labName,
          customerName,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          generatedAtIso,
          certificates,
          verificationBaseUrl: portalBaseUrl(),
          showUnit,
        }),
      );
    }

    zipEntries["README.txt"] = strToU8(
      buildAuditPackReadme({
        labName,
        customerName,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        generatedAtIso,
        certificateCount: includedJobIds.length,
        missingCount,
        include: params.include,
      }),
    );

    const zipBytes = zipSync(zipEntries, { level: 6 });

    const storage = portalAuditPackKey({
      org: {
        id: exportRow.lab_organization_id,
        slug: exportRow.organization_slug ?? "",
      },
      exportId,
      generatedAt: new Date(generatedAtIso),
    });
    await bucketBinding(env, storage.bucket).put(storage.key, zipBytes, {
      httpMetadata: { contentType: "application/zip" },
    });

    await withDbClient(env, (client) =>
      client.query(
        `
          update portal_export_job
          set status = 'COMPLETED',
              certificate_count = $1,
              included_job_ids = $2::jsonb,
              r2_key = $3,
              file_size_bytes = $4,
              failure_reason = null,
              expires_at = now() + ($5 || ' days')::interval,
              completed_at = now(),
              updated_at = now()
          where id = $6
        `,
        [
          includedJobIds.length,
          JSON.stringify(includedJobIds),
          storage.key,
          zipBytes.byteLength,
          String(AUDIT_PACK_EXPIRY_DAYS),
          exportId,
        ],
      ),
    );

    // Non-fatal: the pack is ready even if the notification fails.
    try {
      await notifyAuditPackReady(exportId);
    } catch (notifyError) {
      console.error(
        `[AUDIT PACK ${exportId}] Failed to send ready notification:`,
        notifyError,
      );
    }

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(
      `[AUDIT PACK ${exportId}] DONE in ${totalMs}ms (${includedJobIds.length} certificates, ${zipBytes.byteLength} bytes)`,
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await withDbClient(env, (client) =>
      client.query(
        `
          update portal_export_job
          set status = 'FAILED', failure_reason = $1, updated_at = now()
          where id = $2
        `,
        [errorMessage, exportId],
      ),
    ).catch((dbError) => {
      console.error(
        `[AUDIT PACK ${exportId}] Failed to record error:`,
        dbError,
      );
    });
    throw error;
  }
}
