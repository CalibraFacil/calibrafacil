import { z } from "zod";

import { resolvePlaceholder } from "./catalog.js";
import type {
  CertificateBlockLayout,
  LockedBlockKey,
} from "./document-schema.js";
import { applyPlaceholderFormat } from "./format.js";
import { deriveResultGrids, type ResultGrid } from "./result-grid.js";

/**
 * Locked-block renderers (spec 02 §2, §5). Each returns the INNER HTML of the
 * block's <section>; content is derived exclusively from the frozen input
 * data (`buildXlsxCertificateData` shape) — the template only positions the
 * block. Fail-loud: structurally invalid data throws, never renders a
 * certificate with silently missing mandatory content (ADR-2 rule 2).
 */

export class CertificateRenderDataError extends Error {
  readonly blockKey: string;
  constructor(blockKey: string, detail: string) {
    super(`cannot render locked block "${blockKey}": ${detail}`);
    this.name = "CertificateRenderDataError";
    this.blockKey = blockKey;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Data = Record<string, unknown>;

/** Escaped catalog resolution (required-ness comes from the catalog). */
function field(data: Data, path: string): string {
  return escapeHtml(resolvePlaceholder(data, path));
}

function fieldRow(label: string, value: string): string {
  return value === "" ? "" : `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
}

function section(title: string | null, inner: string): string {
  const heading = title === null ? "" : `<div class="cf-block-title">${escapeHtml(title)}</div>`;
  return `${heading}${inner}`;
}

/**
 * Placement presets (M-C): the layout envelope's free-string `preset` becomes
 * a CSS modifier ONLY when it is on the block's whitelist — unknown presets
 * render as the default (never as an arbitrary class).
 */
function presetClass(
  layout: CertificateBlockLayout | null | undefined,
  allowed: readonly string[],
): string {
  const preset = layout?.preset;
  return preset && allowed.includes(preset) ? ` cf-preset-${preset}` : "";
}

export const LAB_IDENTIFICATION_PRESETS = ["logo-right", "logo-top"] as const;
export const ACCREDITATION_SEAL_PRESETS = ["seal-left", "seal-center"] as const;

// ---------------------------------------------------------------------------
// Structured data mini-schemas (fail-loud shape checks)
// ---------------------------------------------------------------------------

// Mirrors normalizeResultRowsForXlsx (apps/worker): role/group/include flags
// are optional on rows derived from raw results; values are arbitrary jsonb.
const resultRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.unknown(),
  unit: z.string().nullish(),
  role: z.string().nullish(),
  group: z.string().nullish(),
  includeInCertificate: z.boolean().nullish(),
});

const resultRowsSchema = z.array(resultRowSchema);

const standardSchema = z.object({
  name: z.string(),
  certificate: z.string().nullish(),
  validUntil: z.string().nullish(),
  traceability: z.string().nullish(),
});

function formatRowValue(row: { value: string | number; unit?: string | null }): string {
  const value =
    typeof row.value === "number"
      ? applyPlaceholderFormat("number-br", row.value)
      : row.value;
  return row.unit ? `${escapeHtml(value)} ${escapeHtml(row.unit)}` : escapeHtml(value);
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderCertificateIdentification(data: Data): string {
  const amendmentNumber = field(data, "certificate.amendmentNumber");
  const amendment =
    amendmentNumber === ""
      ? ""
      : fieldRow("Retificação nº", amendmentNumber) +
        fieldRow("Substitui o certificado", field(data, "certificate.originalJobId")) +
        fieldRow("Motivo", field(data, "certificate.amendmentReason"));
  return section(
    null,
    `<div class="cf-certrow"><dl class="cf-field-list">
${fieldRow("Data de emissão", field(data, "certificate.issuedAtText"))}
${fieldRow("Data da calibração", field(data, "job.performedAtText"))}
${fieldRow("Local da calibração", field(data, "job.location"))}
${amendment}</dl><div><div class="cf-certno-label">Certificado n.º</div><div class="cf-certno">${field(data, "certificate.number")}</div></div></div>`,
  );
}

function renderLabIdentification(
  data: Data,
  layout?: CertificateBlockLayout | null,
): string {
  // Masthead (reference PR #587): logo · lab identity lines · 2px brand rule.
  const rawLogo = Reflect.get(Reflect.get(data, "lab") ?? {}, "logoDataUrl");
  const logo =
    typeof rawLogo === "string" && rawLogo !== ""
      ? `<img class="cf-lab-logo" src="${escapeHtml(rawLogo)}" alt="" />`
      : "";
  const cnpj = field(data, "lab.cnpj");
  const accreditation = field(data, "accreditation.numberFormatted");
  const accreditationBody = field(data, "accreditation.body");
  const identityBits = [
    cnpj === "" ? "" : `<b>CNPJ</b> ${cnpj}`,
    accreditation === ""
      ? ""
      : `<b>Acreditação ${accreditationBody === "" ? "CGCRE" : accreditationBody}</b> n.º ${accreditation}`,
  ].filter(Boolean);
  const contactBits = [
    field(data, "lab.phone"),
    field(data, "lab.email"),
    field(data, "lab.website"),
  ].filter(Boolean);
  const manager = [
    field(data, "lab.technicalManagerName"),
    field(data, "lab.technicalManagerTitle"),
  ]
    .filter(Boolean)
    .join(" — ");
  const lines = [
    identityBits.join(" &nbsp;·&nbsp; "),
    field(data, "lab.address"),
    contactBits.join(" &nbsp;·&nbsp; "),
    manager,
  ]
    .filter(Boolean)
    .join("<br/>");
  return `<div class="cf-masthead${presetClass(layout, LAB_IDENTIFICATION_PRESETS)}">${logo}<div class="cf-masthead-id"><div class="cf-masthead-name">${field(data, "lab.name")}</div><div class="cf-masthead-lines">${lines}</div></div></div><div class="cf-rule"></div>`;
}

function renderCustomerIdentification(data: Data): string {
  return section(
    "Cliente",
    `<dl class="cf-field-list">
${fieldRow("Razão social", field(data, "customer.name"))}
${fieldRow("CNPJ/CPF", field(data, "customer.taxId"))}
${fieldRow("Endereço", field(data, "customer.address"))}</dl>`,
  );
}

function renderItemIdentification(data: Data): string {
  return section(
    "Item calibrado",
    `<dl class="cf-field-list">
${fieldRow("Item", field(data, "asset.kind"))}
${fieldRow("TAG", field(data, "asset.tag"))}
${fieldRow("Nº de série", field(data, "asset.serialNumber"))}
${fieldRow("Fabricante", field(data, "asset.manufacturer"))}
${fieldRow("Modelo", field(data, "asset.model"))}
${fieldRow("Capacidade", field(data, "asset.capacityText"))}
${fieldRow("Divisão", field(data, "asset.divisionText"))}
${fieldRow("Registro Inmetro", field(data, "asset.inmetroRegistration"))}</dl>`,
  );
}

function renderMethodTraceability(data: Data): string {
  const rawStandards = Reflect.get(data, "standards");
  const parsed = z.array(standardSchema).safeParse(rawStandards ?? []);
  if (!parsed.success) {
    throw new CertificateRenderDataError(
      "method_traceability",
      "input data `standards` does not match the expected shape",
    );
  }
  const standardsRows = parsed.data
    .map(
      (standard) =>
        `<tr><td>${escapeHtml(standard.name)}</td><td>${escapeHtml(standard.certificate ?? "")}</td><td>${escapeHtml(standard.validUntil ? applyPlaceholderFormat("date-br", standard.validUntil) : "")}</td><td>${escapeHtml(standard.traceability ?? "")}</td></tr>`,
    )
    .join("");
  const standardsTable =
    parsed.data.length === 0
      ? ""
      : `<table><thead><tr><th>Padrão utilizado</th><th>Certificado</th><th>Validade</th><th>Rastreabilidade</th></tr></thead><tbody>${standardsRows}</tbody></table>`;
  return section(
    "Método e rastreabilidade metrológica",
    `<dl class="cf-field-list">
${fieldRow("Método", field(data, "method.name"))}
${fieldRow("Procedimento", field(data, "method.procedureCode"))}
${fieldRow("Normas de referência", field(data, "method.referenceStandardsText"))}</dl>
${standardsTable}
<p>Os resultados apresentados possuem rastreabilidade metrológica ao Sistema Internacional de Unidades (SI) por meio dos padrões relacionados acima.</p>`,
  );
}

function renderEnvironmentalConditions(data: Data): string {
  const withinLimits = field(data, "environment.withinLimits");
  const justification = escapeHtml(
    String(Reflect.get(Reflect.get(data, "environment") ?? {}, "outOfLimitsJustification") ?? ""),
  );
  return section(
    "Condições ambientais",
    `<dl class="cf-field-list">
${fieldRow("Temperatura", field(data, "environment.temperatureText"))}
${fieldRow("Umidade relativa", field(data, "environment.relativeHumidityText"))}
${fieldRow("Pressão atmosférica", field(data, "environment.pressureText"))}
${fieldRow("Dentro dos limites", withinLimits)}
${withinLimits === "Não" && justification !== "" && justification !== "null" ? fieldRow("Justificativa", justification) : ""}</dl>`,
  );
}

function formatGridCell(value: string | number | null): string {
  if (value === null) return "";
  return typeof value === "number"
    ? applyPlaceholderFormat("number-br", value)
    : escapeHtml(value);
}

function tableClass(layout?: CertificateBlockLayout | null): string {
  return layout?.borders ? ` class="cf-borders-${layout.borders}"` : "";
}

/** DOQ-CGCRE-057 shape: label header row + bracketed-unit row; no ± ever. */
function renderResultGrid(
  grid: ResultGrid,
  layout?: CertificateBlockLayout | null,
): string {
  const labelRow = grid.columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join("");
  const hasUnits = grid.columns.some((column) => column.unit);
  const unitRow = hasUnits
    ? `<tr>${grid.columns
        .map(
          (column) =>
            `<th class="cf-unit-row">${column.unit ? `[${escapeHtml(column.unit)}]` : ""}</th>`,
        )
        .join("")}</tr>`
    : "";
  const body = grid.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => {
            const numeric = typeof cell === "number";
            return `<td${numeric || grid.columns[index]?.kind === "computed" ? ' class="cf-num"' : ""}>${formatGridCell(cell)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const caption = grid.title
    ? `<p class="cf-grid-caption">${escapeHtml(grid.title)}</p>`
    : "";
  return `${caption}<table${tableClass(layout)}><thead><tr>${labelRow}</tr>${unitRow}</thead><tbody>${body}</tbody></table>`;
}

/** The method table field (if any) that declares the eccentricity indicator. */
function eccentricityIndicatorTableKey(data: Data): string | null {
  const methodSnapshot = Reflect.get(data, "methodSnapshot");
  if (!methodSnapshot || typeof methodSnapshot !== "object") return null;
  const rawFields = Reflect.get(methodSnapshot, "dataFields");
  for (const field of Array.isArray(rawFields) ? rawFields : []) {
    if (!field || typeof field !== "object") continue;
    const indicator = Reflect.get(field, "eccentricityIndicator");
    if (
      indicator &&
      typeof indicator === "object" &&
      Reflect.get(indicator, "enabled") === true
    ) {
      const key = Reflect.get(field, "key");
      return typeof key === "string" ? key : null;
    }
  }
  return null;
}

function renderResultsTable(
  data: Data,
  layout?: CertificateBlockLayout | null,
): string {
  const grids = deriveResultGrids(data, {
    hiddenColumns: layout?.hiddenColumns,
  });

  const parsed = resultRowsSchema.safeParse(Reflect.get(data, "resultRows"));
  if (!parsed.success) {
    throw new CertificateRenderDataError(
      "results_table",
      "input data `resultRows` does not match the expected shape",
    );
  }
  // Scalar summary: calibration_result rows NOT already shown as grid columns.
  const gridColumnKeys = new Set(
    grids.flatMap((grid) => grid.columns.map((column) => column.key)),
  );
  const scalarRows = parsed.data
    .filter(
      (row) =>
        (row.group ?? "calibration_result") === "calibration_result" &&
        (row.includeInCertificate ?? true) &&
        !gridColumnKeys.has(row.key) &&
        (typeof row.value === "number" || typeof row.value === "string"),
    )
    .map((row) => ({
      label: row.label,
      value: typeof row.value === "number" ? row.value : String(row.value),
      unit: row.unit,
    }));

  if (grids.length === 0 && scalarRows.length === 0) {
    throw new CertificateRenderDataError(
      "results_table",
      "no calibration_result rows marked includeInCertificate — a certificate cannot be issued without results (§7.8.2.1)",
    );
  }

  // Eccentricity indicator (calibration finding 3): when the method declares
  // an indicator-enabled table field AND the worker injected the rendered SVG
  // (graphics.eccentricityIndicatorSvg data URL, same injection pattern as
  // the lab logo), the figure prints after that field's grid — the placement
  // real certificates use. Purely data-driven: absent either piece, nothing
  // renders.
  const indicatorTableKey = eccentricityIndicatorTableKey(data);
  const rawIndicator = Reflect.get(
    Reflect.get(data, "graphics") ?? {},
    "eccentricityIndicatorSvg",
  );
  const indicatorHtml =
    indicatorTableKey !== null &&
    typeof rawIndicator === "string" &&
    rawIndicator.startsWith("data:image/svg+xml")
      ? `<figure class="cf-eccentricity-indicator"><img src="${escapeHtml(rawIndicator)}" alt="Posições de excentricidade" /></figure>`
      : "";

  const gridsHtml = grids
    .map((grid) => {
      const gridHtml = renderResultGrid(grid, layout);
      // attach after the LAST grid of the indicator's table (após-ajuste side
      // when the method is phase-split)
      const isIndicatorGrid =
        grid.tableKey === indicatorTableKey &&
        grid === grids.filter((g) => g.tableKey === indicatorTableKey).at(-1);
      return isIndicatorGrid ? `${gridHtml}${indicatorHtml}` : gridHtml;
    })
    .join("");
  const scalarHtml =
    scalarRows.length === 0
      ? ""
      : `<table${tableClass(layout)}><thead><tr><th>Grandeza</th><th class="cf-num">Resultado</th></tr></thead><tbody>${scalarRows
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.label)}</td><td class="cf-num">${formatRowValue(row)}</td></tr>`,
          )
          .join("")}</tbody></table>`;

  return section("Resultados da calibração", `${gridsHtml}${scalarHtml}`);
}

function renderUncertaintyStatement(data: Data): string {
  const expandedValue = field(data, "uncertainty.expanded.value");
  const expandedUnit = field(data, "uncertainty.expanded.unit");
  const coverageFactor = field(data, "uncertainty.coverageFactor.value");
  if (expandedValue === "" || coverageFactor === "") {
    throw new CertificateRenderDataError(
      "uncertainty_statement",
      "expanded uncertainty and coverage factor are mandatory on a calibration certificate (§7.8.4.1) — missing from the frozen results",
    );
  }
  return section(
    "Incerteza de medição",
    `<p>A incerteza expandida de medição relatada é U = ${expandedValue}${expandedUnit === "" ? "" : ` ${expandedUnit}`}, declarada como a incerteza padrão combinada multiplicada pelo fator de abrangência k = ${coverageFactor}, correspondendo a uma probabilidade de abrangência de aproximadamente 95%, conforme o Guia para a Expressão da Incerteza de Medição (GUM).</p>`,
  );
}

function renderSignatureBlock(data: Data): string {
  const approverName = field(data, "approval.approvedBy.name");
  const rawSignatureUrl = Reflect.get(Reflect.get(data, "approval") ?? {}, "signatureUrl");
  const signatureImg =
    typeof rawSignatureUrl === "string" && rawSignatureUrl !== ""
      ? `<img src="${escapeHtml(rawSignatureUrl)}" alt="Assinatura" />`
      : "";
  return `<div class="cf-signature-block">${signatureImg}<div><span class="cf-signature-line"><span class="cf-signature-name">${approverName}</span><br/><span class="cf-signature-title">Signatário autorizado</span></span></div></div>`;
}

function renderAccreditationSeal(
  data: Data,
  layout?: CertificateBlockLayout | null,
): string {
  const accredited = field(data, "accreditation.accredited") === "Sim";
  const rawSeal = Reflect.get(Reflect.get(data, "lab") ?? {}, "accreditationSealPng");
  const sealImg =
    accredited && typeof rawSeal === "string" && rawSeal !== ""
      ? `<img src="${escapeHtml(rawSeal)}" alt="Selo de acreditação" />`
      : "";
  // Layout-stable: the reserved box renders whether or not the seal appears
  // (vigência is decided at emission and arrives in the input data — #647).
  return `<div class="cf-accreditation-seal${presetClass(layout, ACCREDITATION_SEAL_PRESETS)}">${sealImg}${sealImg === "" ? "" : '<div class="cf-seal-caption">CGCRE · RBC</div>'}</div>`;
}

function renderVerificationQr(data: Data, qrDataUrl: string): string {
  const url = field(data, "certificate.verificationUrl");
  return `<div class="cf-verification"><img src="${escapeHtml(qrDataUrl)}" alt="QR code de verificação" /><div class="cf-verification-text">Verifique a autenticidade deste certificado em:<br/><strong>${url}</strong></div></div>`;
}

function renderEndOfDocument(data: Data): string {
  return `<div class="cf-end-of-document"><div class="cf-end-marker">— FIM DO CERTIFICADO ${field(data, "certificate.number")} —</div><div class="cf-end-note">Este certificado atende aos requisitos da NBR ISO/IEC 17025 e não pode ser reproduzido, exceto integralmente, sem aprovação por escrito do laboratório.</div></div>`;
}

/** Render context computed once per compile (async pre-steps live here). */
export type LockedBlockRenderContext = {
  /** QR code for `certificate.verificationUrl`, as a data URL. */
  qrDataUrl: string;
};

export function renderLockedBlockInner(
  blockKey: LockedBlockKey,
  data: Data,
  context: LockedBlockRenderContext,
  layout?: CertificateBlockLayout | null,
): string {
  switch (blockKey) {
    case "certificate_identification":
      return renderCertificateIdentification(data);
    case "lab_identification":
      return renderLabIdentification(data, layout);
    case "customer_identification":
      return renderCustomerIdentification(data);
    case "item_identification":
      return renderItemIdentification(data);
    case "method_traceability":
      return renderMethodTraceability(data);
    case "environmental_conditions":
      return renderEnvironmentalConditions(data);
    case "results_table":
      return renderResultsTable(data, layout);
    case "uncertainty_statement":
      return renderUncertaintyStatement(data);
    case "signature_block":
      return renderSignatureBlock(data);
    case "accreditation_seal":
      return renderAccreditationSeal(data, layout);
    case "verification_qr":
      return renderVerificationQr(data, context.qrDataUrl);
    case "end_of_document":
      return renderEndOfDocument(data);
  }
}
