import {
  formatCalendarDate,
  formatInstant,
} from "@calibra-facil/shared/format";
import { portalBaseUrl as sharedPortalBaseUrl } from "@calibra-facil/shared/public-urls";

// =============================================================================
// AUDIT PACK (#738) — customer-requested bulk export of released certificates
// + fleet-status report + verification-links index, zipped and uploaded to R2.
// =============================================================================

// Mirror the API-side enqueue caps (apps/api/src/routes/portal.ts). Both are
// re-checked here because the certificate set is re-derived at generation time.
export const AUDIT_PACK_MAX_CERTIFICATES = 500;

export const AUDIT_PACK_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

// 512 MB
export const AUDIT_PACK_EXPIRY_DAYS = 7;

type AuditPackParams = {
  dateFrom: string;
  dateTo: string;
  unitId: number | null;
  include: {
    certificates: boolean;
    fleetReport: boolean;
    verificationIndex: boolean;
  };
  customerIds: number[];
};

/** Defensive parse of the portal_export_job.params jsonb column. */
export function parseAuditPackParams(value: unknown): AuditPackParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid audit pack params");
  }
  const record = Object.fromEntries(Object.entries(value));
  const include =
    record.include && typeof record.include === "object"
      ? Object.fromEntries(Object.entries(record.include))
      : {};
  const customerIds = Array.isArray(record.customerIds)
    ? record.customerIds.filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id),
      )
    : [];
  if (
    typeof record.dateFrom !== "string" ||
    typeof record.dateTo !== "string" ||
    customerIds.length === 0
  ) {
    throw new Error("Invalid audit pack params");
  }
  return {
    dateFrom: record.dateFrom,
    dateTo: record.dateTo,
    unitId: typeof record.unitId === "number" ? record.unitId : null,
    include: {
      certificates: include.certificates === true,
      fleetReport: include.fleetReport === true,
      verificationIndex: include.verificationIndex === true,
    },
    customerIds,
  };
}

export function portalBaseUrl(): string {
  return sharedPortalBaseUrl();
}

/** Sanitize a ZIP entry filename segment (keeps readable pt-BR-ish names). */
export function auditPackFileName(value: string): string {
  const sanitized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 120);
  return sanitized || "certificado";
}

export type AuditPackCertificateRow = {
  id: number;
  job_id: string;
  certificate_name: string | null;
  certificate_url: string;
  verification_token: string;
  approved_date: string;
  asset_tag: string;
  asset_name: string;
  serial_number: string | null;
  customer_name: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Verification-links index: one row per certificate pointing at the PUBLIC
 * verification page (`/v/{token}`), so an auditor can independently confirm
 * authenticity and signature without a portal login.
 */
export function renderAuditPackIndexHtml(params: {
  labName: string;
  customerName: string;
  dateFrom: string;
  dateTo: string;
  generatedAtIso: string;
  certificates: AuditPackCertificateRow[];
  verificationBaseUrl: string;
  showUnit: boolean;
}): string {
  const rows = params.certificates
    .map((cert) => {
      const url = `${params.verificationBaseUrl}/v/${encodeURIComponent(cert.verification_token)}`;
      return `<tr>
        <td>${escapeHtml(cert.certificate_name ?? cert.job_id)}</td>
        ${params.showUnit ? `<td>${escapeHtml(cert.customer_name)}</td>` : ""}
        <td>${escapeHtml(cert.asset_name)}<div class="sub">${escapeHtml(cert.asset_tag)}${cert.serial_number ? ` · NS ${escapeHtml(cert.serial_number)}` : ""}</div></td>
        <td class="num">${escapeHtml(formatCalendarDate(cert.approved_date))}</td>
        <td><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Índice de verificação — Pacote de auditoria</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .eyebrow { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #64748b; }
  p.note { font-size: 13px; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid #e2e8f0; font-size: 12px; vertical-align: top; }
  th { color: #475569; font-weight: 500; }
  td.num { font-family: ui-monospace, monospace; }
  .sub { color: #64748b; font-size: 11px; }
  a { color: #1d4ed8; word-break: break-all; }
</style>
</head>
<body>
  <div class="wrap">
    <p class="eyebrow">${escapeHtml(params.labName)} · Pacote de auditoria</p>
    <h1>Índice de certificados e links de verificação</h1>
    <p class="eyebrow">${escapeHtml(params.customerName)} · ${escapeHtml(formatCalendarDate(params.dateFrom))} a ${escapeHtml(formatCalendarDate(params.dateTo))}</p>
    <p class="note">
      Cada link abre a página pública de verificação do certificado, onde o
      auditor pode confirmar a autenticidade e a assinatura digital do
      documento de forma independente. Este pacote inclui apenas a versão
      vigente de cada certificado (emendas substituem o original).
    </p>
    <table>
      <thead>
        <tr>
          <th>Certificado</th>
          ${params.showUnit ? "<th>Unidade</th>" : ""}
          <th>Instrumento</th>
          <th>Data</th>
          <th>Verificação</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p class="note">Gerado em ${escapeHtml(formatInstant(params.generatedAtIso, "date-time"))} · ${params.certificates.length} certificado(s).</p>
  </div>
</body>
</html>`;
}

export function buildAuditPackReadme(params: {
  labName: string;
  customerName: string;
  dateFrom: string;
  dateTo: string;
  generatedAtIso: string;
  certificateCount: number;
  missingCount: number;
  include: AuditPackParams["include"];
}): string {
  const lines = [
    "PACOTE DE AUDITORIA",
    "===================",
    "",
    `Laboratório: ${params.labName}`,
    `Cliente: ${params.customerName}`,
    `Período (data de aprovação): ${formatCalendarDate(params.dateFrom)} a ${formatCalendarDate(params.dateTo)}`,
    `Gerado em: ${formatInstant(params.generatedAtIso, "date-time")}`,
    "",
    "Conteúdo:",
  ];
  if (params.include.certificates) {
    lines.push(
      `  - certificados/ — ${params.certificateCount} certificado(s) de calibração em PDF (apenas a versão vigente de cada certificado).`,
    );
  }
  if (params.include.fleetReport) {
    lines.push(
      "  - relatorio-frota.pdf / relatorio-frota.xlsx — situação da frota de instrumentos na data de geração.",
    );
  }
  if (params.include.verificationIndex) {
    lines.push(
      "  - indice.html — índice dos certificados com links públicos de verificação de autenticidade.",
    );
  }
  if (params.missingCount > 0) {
    lines.push(
      "",
      `Atenção: ${params.missingCount} certificado(s) do período não puderam ser incluídos (arquivo indisponível no momento da geração).`,
    );
  }
  lines.push(
    "",
    "AVISO: o relatório de situação da frota e o índice são documentos",
    "informativos e NÃO são certificados de calibração. A periodicidade de",
    "calibração é definida pelo cliente (NBR ISO/IEC 17025 §7.8.4.3).",
    "",
    "Gerado via CalibraFácil.",
    "",
  );
  return lines.join("\n");
}
