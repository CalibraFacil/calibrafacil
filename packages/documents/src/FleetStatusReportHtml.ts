/**
 * Fleet calibration-status report for the portal audit pack (#738).
 * A self-contained, print-optimized HTML snapshot of the customer's instrument
 * fleet at generation time: last/next calibration, customer-owned interval,
 * legal-verification track and due status. Plain string template (no React)
 * so the worker can render it straight through the Gotenberg HTML→PDF path.
 *
 * It is DELIBERATELY NOT a calibration certificate: no certificate number, no
 * signature, no accreditation seal — it carries the same informational
 * disclaimer as the interval-analysis report (§7.8.4.3: the calibration
 * interval is the customer's decision).
 */

export type FleetDueStatus = "OVERDUE" | "DUE_SOON" | "OK" | "UNSCHEDULED";

export type FleetStatusClassification = {
  status: FleetDueStatus;
  /** pt-BR label rendered in both the PDF and the XLSX ("vence em X dias"). */
  label: string;
};

/** Mirrors the portal's DUE_SOON window (apps/portal calibration-status). */
export const FLEET_DUE_SOON_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Classify an instrument's calibration due status at `now`. Shared by the
 * PDF and XLSX renderings so the two report formats can never disagree.
 */
export function classifyFleetDueStatus(
  nextCalibrationDate: Date | null,
  now: Date,
  dueSoonDays: number = FLEET_DUE_SOON_DAYS,
): FleetStatusClassification {
  if (!nextCalibrationDate) {
    return { status: "UNSCHEDULED", label: "Sem programação" };
  }
  const days = Math.ceil(
    (nextCalibrationDate.getTime() - now.getTime()) / DAY_MS,
  );
  if (days < 0) {
    const overdueDays = Math.abs(days);
    return {
      status: "OVERDUE",
      label: `Vencido há ${overdueDays} ${overdueDays === 1 ? "dia" : "dias"}`,
    };
  }
  if (days === 0) {
    return { status: "DUE_SOON", label: "Vence hoje" };
  }
  if (days <= dueSoonDays) {
    return {
      status: "DUE_SOON",
      label: `Vence em ${days} ${days === 1 ? "dia" : "dias"}`,
    };
  }
  return { status: "OK", label: "Em dia" };
}

export type FleetStatusAsset = {
  name: string;
  tag: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  /** Branch customer name; rendered only when the pack spans multiple units. */
  unitName: string | null;
  lastCalibrationDate: string | null;
  nextCalibrationDate: string | null;
  /** Customer-owned recalibration interval (ISO 17025 §7.8.4.3). */
  calibrationIntervalMonths: number | null;
  metrologyRegime: string;
  /** Legal-metrology TRACK 2 (regulation-fixed verification), when LEGAL. */
  nextLegalVerificationDate: string | null;
};

export type FleetStatusReportData = {
  labName: string;
  customerName: string;
  generatedAtIso: string;
  dueSoonDays: number;
  assets: FleetStatusAsset[];
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null): string {
  const date = parseDate(value);
  if (!date) return "—";
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(
    date.getUTCMonth() + 1,
  ).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

const STATUS_COLOR: Record<FleetDueStatus, string> = {
  OVERDUE: "#b91c1c",
  DUE_SOON: "#b45309",
  OK: "#15803d",
  UNSCHEDULED: "#64748b",
};

export function renderFleetStatusReportHtml(
  data: FleetStatusReportData,
): string {
  const now = new Date(data.generatedAtIso);
  const generated = `${String(now.getUTCDate()).padStart(2, "0")}/${String(
    now.getUTCMonth() + 1,
  ).padStart(2, "0")}/${now.getUTCFullYear()}`;
  const showUnit = data.assets.some((asset) => asset.unitName);

  const counts = { OVERDUE: 0, DUE_SOON: 0, OK: 0, UNSCHEDULED: 0 };
  const rows = data.assets
    .map((asset) => {
      const due = classifyFleetDueStatus(
        parseDate(asset.nextCalibrationDate),
        now,
        data.dueSoonDays,
      );
      counts[due.status] += 1;
      const interval =
        asset.calibrationIntervalMonths === null
          ? "—"
          : `${asset.calibrationIntervalMonths} ${asset.calibrationIntervalMonths === 1 ? "mês" : "meses"}`;
      const legal =
        asset.metrologyRegime === "LEGAL"
          ? formatDate(asset.nextLegalVerificationDate)
          : "—";
      return `<tr>
        ${showUnit ? `<td>${esc(asset.unitName ?? "—")}</td>` : ""}
        <td>${esc(asset.tag)}</td>
        <td>${esc(asset.name)}${asset.manufacturer || asset.model ? `<div class="sub">${esc([asset.manufacturer, asset.model].filter(Boolean).join(" · "))}</div>` : ""}</td>
        <td>${esc(asset.serialNumber ?? "—")}</td>
        <td class="num">${formatDate(asset.lastCalibrationDate)}</td>
        <td class="num">${formatDate(asset.nextCalibrationDate)}</td>
        <td class="num">${esc(interval)}</td>
        <td class="num">${legal}</td>
        <td><span class="status" style="color:${STATUS_COLOR[due.status]}">${esc(due.label)}</span></td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Relatório de situação da frota — ${esc(data.customerName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .eyebrow { font-family: ui-monospace, "Geist Mono", monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #64748b; }
  .disclaimer { margin: 16px 0; padding: 12px 14px; border: 1px solid #f59e0b; background: #fffbeb; border-radius: 8px; font-size: 13px; }
  .kpis { display: flex; gap: 24px; margin: 16px 0; font-size: 13px; }
  .kpis strong { font-family: ui-monospace, "Geist Mono", monospace; font-size: 16px; display: block; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid #e2e8f0; font-size: 12px; vertical-align: top; }
  th { color: #475569; font-weight: 500; }
  td.num, .status { font-family: ui-monospace, "Geist Mono", monospace; }
  .sub { color: #64748b; font-size: 11px; }
  .muted { color: #64748b; font-size: 12px; margin-top: 24px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  @page { margin: 14mm; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="wrap">
    <p class="eyebrow">${esc(data.labName)} · Pacote de auditoria</p>
    <h1>Relatório de situação da frota</h1>
    <p class="eyebrow">${esc(data.customerName)}</p>

    <div class="disclaimer">
      <strong>Este documento não é um certificado de calibração.</strong> É um
      relatório informativo da situação da frota de instrumentos na data de
      geração. A periodicidade de calibração é definida pelo cliente
      (NBR ISO/IEC 17025 §7.8.4.3); a periodicidade de verificação metrológica
      legal, quando aplicável, é fixada por regulamento.
    </div>

    <div class="kpis">
      <div><strong>${data.assets.length}</strong> instrumentos</div>
      <div><strong style="color:${STATUS_COLOR.OVERDUE}">${counts.OVERDUE}</strong> vencidos</div>
      <div><strong style="color:${STATUS_COLOR.DUE_SOON}">${counts.DUE_SOON}</strong> vencendo em ${data.dueSoonDays} dias</div>
      <div><strong style="color:${STATUS_COLOR.OK}">${counts.OK}</strong> em dia</div>
      <div><strong style="color:${STATUS_COLOR.UNSCHEDULED}">${counts.UNSCHEDULED}</strong> sem programação</div>
    </div>

    <table>
      <thead>
        <tr>
          ${showUnit ? "<th>Unidade</th>" : ""}
          <th>Tag</th>
          <th>Instrumento</th>
          <th>Nº de série</th>
          <th>Última calibração</th>
          <th>Próxima calibração</th>
          <th>Periodicidade</th>
          <th>Verificação legal</th>
          <th>Situação</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <p class="muted">Gerado em ${esc(generated)} por ${esc(data.labName)} via CalibraFácil. Situação calculada na data de geração; janela de alerta: ${data.dueSoonDays} dias.</p>
  </div>
</body>
</html>`;
}
