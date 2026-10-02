/**
 * Calibration-interval optimization report (Phase E2, REQ-ENGINE-REPORT-001/002).
 * A self-contained, print-optimized HTML report of the reliability analysis (ILAC-G24 /
 * NCSL RP-1) the customer can save as a PDF from the browser. It is a plain string
 * template (no React render) so it can be served straight from the API.
 *
 * It is DELIBERATELY NOT a calibration certificate: no certificate number, no signature,
 * no accreditation seal — it carries a §7.8.4.3 disclaimer instead. The interval is the
 * customer's decision; this is an indicative analysis only.
 */

import { formatLabDate } from "./dates.js";

export type IntervalReportData = {
  assetName: string;
  assetTag: string;
  serialNumber: string;
  customerName: string;
  classification: "INSUFFICIENT_DATA" | "STABLE" | "DRIFTING" | "LEGAL_FIXED";
  reliability: number | null;
  coverage: number;
  currentIntervalMonths: number | null;
  recommendation: {
    action: "extend" | "keep" | "shorten";
    method: string;
    proposedIntervalMonths: number;
    intervalConfidence?: { lower: number; upper: number } | null;
  } | null;
  generatedAtIso: string;
};

const CLASSIFICATION_LABEL: Record<
  IntervalReportData["classification"],
  string
> = {
  STABLE: "Estável",
  DRIFTING: "Derivando",
  INSUFFICIENT_DATA: "Dados insuficientes",
  LEGAL_FIXED: "Periodicidade fixada por regulamento (Inmetro)",
};

const ACTION_LABEL: Record<
  NonNullable<IntervalReportData["recommendation"]>["action"],
  string
> = { extend: "Estender", keep: "Manter", shorten: "Encurtar" };

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function months(value: number): string {
  return `${value} ${value === 1 ? "mês" : "meses"}`;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function renderIntervalReportHtml(data: IntervalReportData): string {
  const generated = formatLabDate(data.generatedAtIso);
  const current =
    data.currentIntervalMonths === null
      ? "não definida"
      : months(data.currentIntervalMonths);
  const suggestion = data.recommendation
    ? `${ACTION_LABEL[data.recommendation.action]} para ${months(
        data.recommendation.proposedIntervalMonths,
      )}`
    : "Sem sugestão (histórico insuficiente)";
  const confidence = data.recommendation?.intervalConfidence
    ? `${months(data.recommendation.intervalConfidence.lower)} – ${months(
        data.recommendation.intervalConfidence.upper,
      )}`
    : "—";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Relatório de análise de periodicidade — ${esc(data.assetTag)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .eyebrow { font-family: ui-monospace, "Geist Mono", monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #64748b; }
  .disclaimer { margin: 16px 0; padding: 12px 14px; border: 1px solid #f59e0b; background: #fffbeb; border-radius: 8px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
  th { width: 42%; color: #475569; font-weight: 500; }
  td { font-family: ui-monospace, "Geist Mono", monospace; }
  .muted { color: #64748b; font-size: 12px; margin-top: 24px; }
  @page { margin: 16mm; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="wrap">
    <p class="eyebrow">Programa metrológico · Análise de periodicidade</p>
    <h1>Relatório de análise de periodicidade de calibração</h1>
    <p class="eyebrow">${esc(data.customerName)}</p>

    <div class="disclaimer">
      <strong>Este documento não é um certificado de calibração.</strong> É uma
      análise indicativa de periodicidade baseada no histórico de conformidade
      (ILAC-G24 / OIML D 10 · NCSL RP-1). A periodicidade de calibração é definida
      pelo cliente (NBR ISO/IEC 17025 §7.8.4.3); esta é apenas uma sugestão.
    </div>

    <table>
      <tbody>
        <tr><th>Instrumento</th><td>${esc(data.assetName)}</td></tr>
        <tr><th>Tag / ID</th><td>${esc(data.assetTag)}</td></tr>
        <tr><th>Número de série</th><td>${esc(data.serialNumber)}</td></tr>
        <tr><th>Classificação</th><td>${CLASSIFICATION_LABEL[data.classification]}</td></tr>
        <tr><th>Confiabilidade observada</th><td>${pct(data.reliability)}</td></tr>
        <tr><th>Cobertura de dados</th><td>${pct(data.coverage)}</td></tr>
        <tr><th>Periodicidade atual</th><td>${esc(current)}</td></tr>
        <tr><th>Sugestão</th><td>${esc(suggestion)}</td></tr>
        <tr><th>Faixa de confiança</th><td>${esc(confidence)}</td></tr>
        <tr><th>Método</th><td>${esc(data.recommendation?.method ?? "—")}</td></tr>
      </tbody>
    </table>

    <p class="muted">Gerado em ${esc(generated)}. Métodos: ILAC-G24 / OIML D 10:2022 (M1/M2) e NCSL RP-1:2010 (M5).</p>
  </div>
</body>
</html>`;
}
