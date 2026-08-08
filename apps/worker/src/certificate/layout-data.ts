/**
 * Maps a frozen calibration job onto the fixed certificate layout's prop.
 *
 * The single rule this module follows: **it reads only what the method
 * DECLARES.** Column meaning comes from `reporting.role`, as-found/as-left from
 * `reporting.phase`, and which block a formula belongs to from
 * `scope.tableKey`. Nothing is inferred from an output key's spelling.
 *
 * That constraint is the whole point. The WYSIWYG editor (#863) and the XLSX
 * importer (#865) both died from being modelled on one laboratory's method: a
 * heuristic like "keys ending in _antes are the as-found phase" reads Exemplo's
 * naming convention as if it were a platform contract, and the next lab's
 * method silently renders wrong. If a method does not declare enough to build a
 * correct table, this module returns a diagnostic instead of guessing — a
 * blocked issuance is recoverable, a plausible-looking wrong certificate is not.
 *
 * It lives in the worker rather than in @calibra-facil/documents because that
 * package is NodeNext and cannot type-check through certificate-data into
 * shared (whose relative imports are extensionless, for `bundler` resolution).
 */

import {
  formatAtDecimals,
  formatDecimalPtBr,
  fractionDigitsOf,
  renderEccentricityIndicatorSvgMarkup,
  roundMeasurementForReport,
  certificateImageContextFromJob,
  type CertificateJobData,
  type MethodFormula,
} from "@calibra-facil/certificate-data";
import {
  formatAccreditationNumber,
  shouldRenderAccreditationSeal,
} from "@calibra-facil/shared";
import type {
  CalibrationCertificateData,
  CertificateResultRow,
  CertificateResultTable,
  CertificateStandard,
} from "@calibra-facil/documents";

/** Either the layout prop, or the reasons it could not be built. */
export type LayoutDataResult =
  | { ok: true; data: CalibrationCertificateData }
  | { ok: false; reasons: string[] };

type Phase = "before" | "after";

const PHASE_TITLES: Record<Phase, string> = {
  before: "Resultados antes do ajuste",
  after: "Resultados após o ajuste",
};

/** Title when the method measures once and declares no phase at all. */
const SINGLE_PHASE_TITLE = "Resultados da calibração";

// ── reading the frozen results ──────────────────────────────────────────────
// The math engine writes numbers as strings ("‑500", "290.56691857412756").
// Everything downstream of here works in numbers.

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A row-scoped formula's result is an array, one entry per point. A
 * scalar-scoped one is a single value. Reading `results[key]` uniformly as a
 * list keeps the row builder from having to care.
 */
function valuesAt(results: Record<string, unknown>, key: string): unknown[] {
  const value = results[key];
  return Array.isArray(value) ? value : [value];
}

function isRowScoped(formula: MethodFormula): boolean {
  return formula.scope?.kind === "table_row";
}

function tableKeyOf(formula: MethodFormula): string | null {
  return formula.scope?.kind === "table_row" ? formula.scope.tableKey : null;
}

function phaseOf(formula: MethodFormula): Phase | null {
  const phase = formula.reporting?.phase;
  return phase === "before" || phase === "after" ? phase : null;
}

function isReported(formula: MethodFormula): boolean {
  return formula.reporting?.includeInCertificate !== false;
}

// ── choosing the results table ──────────────────────────────────────────────

/**
 * The main results table is the one whose formulas report an expanded
 * uncertainty. A method's other row-scoped tables (eccentricity, repeatability)
 * report deviations without an uncertainty of their own, and belong in their
 * own sections rather than as extra rows in the results.
 *
 * Deriving it this way, rather than naming `pontos_indicacao`, is what keeps
 * this generic: any method that reports U over a table gets a results table.
 */
function resolveResultsTableKey(formulas: MethodFormula[]): string | null {
  for (const formula of formulas) {
    if (
      isReported(formula) &&
      formula.reporting?.role === "expanded_uncertainty" &&
      formula.reporting?.group === "calibration_result" &&
      isRowScoped(formula)
    ) {
      return tableKeyOf(formula);
    }
  }
  return null;
}

type ColumnSet = {
  /**
   * Output keys that claimed the same column for this (table, phase). More
   * than one means the method is ambiguous and nothing may be rendered from it
   * — see the note on collectColumns.
   */
  ambiguous: string[];
  error: MethodFormula | null;
  indication: MethodFormula | null;
  referenceValue: MethodFormula | null;
  uncertainty: MethodFormula | null;
  coverageFactor: MethodFormula | null;
  effectiveDof: MethodFormula | null;
};

function emptyColumns(): ColumnSet {
  return {
    ambiguous: [],
    error: null,
    indication: null,
    referenceValue: null,
    uncertainty: null,
    coverageFactor: null,
    effectiveDof: null,
  };
}

/**
 * Collects the declared columns for one phase.
 *
 * k and ν_eff are looked up across BOTH reporting groups: methods put the
 * coverage factor in `uncertainty_budget` (it is a budget output) even though
 * it is printed in the results table. Role, not group, says what it is.
 */
function collectColumns(
  formulas: MethodFormula[],
  tableKey: string,
  phase: Phase | null,
): ColumnSet {
  const columns = emptyColumns();

  for (const formula of formulas) {
    if (!isReported(formula)) continue;
    if (tableKeyOf(formula) !== tableKey) continue;
    if (phaseOf(formula) !== phase) continue;

    // Taking the first match and ignoring the rest would be a guess, and a
    // silent one: two formulas claiming "primary_result" in the same phase is
    // exactly the pre-#865 shape (media_indicacao and erro_indicacao both did),
    // and picking whichever comes first in the array prints the mean indication
    // under the "Erro" heading. Frozen snapshots from before the re-seed still
    // look like that, so this is reachable in production, not hypothetical.
    const claim = (
      key: keyof Omit<ColumnSet, "ambiguous">,
      candidate: MethodFormula,
    ) => {
      const existing = columns[key];
      if (existing) {
        columns.ambiguous.push(`${existing.outputKey} + ${candidate.outputKey}`);
        return;
      }
      columns[key] = candidate;
    };

    switch (formula.reporting?.role) {
      case "primary_result":
        claim("error", formula);
        break;
      case "mean_indication":
        claim("indication", formula);
        break;
      case "reference_value":
        claim("referenceValue", formula);
        break;
      case "expanded_uncertainty":
        // A method may report u_c in the budget group under the same role; the
        // results-table one is the one in the calibration_result group.
        if (formula.reporting.group === "calibration_result") {
          claim("uncertainty", formula);
        }
        break;
      case "coverage_factor":
        claim("coverageFactor", formula);
        break;
      default:
        break;
    }
  }

  return columns;
}

/**
 * ν_eff has no role of its own in the vocabulary — it is declared "auxiliary".
 * It is identified as the auxiliary output that a coverage-factor formula
 * depends on, which is how Welch–Satterthwaite methods actually wire it.
 * Returns null for methods that fix k=2 and compute no degrees of freedom.
 */
function resolveEffectiveDofKey(
  formulas: MethodFormula[],
  coverageFactor: MethodFormula | null,
): string | null {
  if (!coverageFactor) return null;
  const dependencies = coverageFactor.expression ?? "";
  for (const formula of formulas) {
    if (formula.reporting?.role !== "auxiliary") continue;
    if (tableKeyOf(formula) !== tableKeyOf(coverageFactor)) continue;
    if (phaseOf(formula) !== phaseOf(coverageFactor)) continue;
    // A word-boundary match, so `veff` does not also match `veff_total`.
    const pattern = new RegExp(`\\b${escapeRegExp(formula.outputKey)}\\b`);
    if (pattern.test(dependencies)) return formula.outputKey;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ν = ∞ is how a budget with no Type-A term is reported. The engine writes it
 * as a very large finite number (1e9), which must not print as "1000000000".
 */
const INFINITE_DOF_THRESHOLD = 1e6;

function formatEffectiveDof(value: unknown): string | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  if (parsed >= INFINITE_DOF_THRESHOLD) return "∞";
  return String(Math.round(parsed));
}

function formatCoverageFactor(value: unknown): string | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return parsed.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── the points themselves ───────────────────────────────────────────────────

/**
 * The nominal load / applied point comes from the input table, not from a
 * formula: it is what the technician set, not something computed. Which column
 * of that table holds it is declared by the method's data fields via
 * `quantityKind: "reference"`, falling back to the row index when a method
 * declares none (the row still needs a label).
 */
function resolvePointLabels(
  job: CertificateJobData,
  tableKey: string,
  unit: string | null,
  rowCount: number,
): string[] {
  const table = job.data?.[tableKey];
  const rows = Array.isArray(table) ? table : [];
  const referenceKey = resolveReferenceColumnKey(job, tableKey);

  return Array.from({ length: rowCount }, (_, index) => {
    const row = rows[index];
    if (referenceKey && row && typeof row === "object") {
      const raw = Object.getOwnPropertyDescriptor(row, referenceKey)?.value;
      const parsed = toNumber(raw);
      if (parsed !== null) {
        const formatted = formatDecimalPtBr(
          parsed,
          Math.min(6, fractionDigitsOf(parsed)),
        );
        return unit ? `${formatted} ${unit}` : formatted;
      }
    }
    return `Ponto ${index + 1}`;
  });
}

/**
 * Which column of the points table holds the applied reference value, so each
 * row can be labelled with its actual load instead of "Ponto 1".
 *
 * The columns are NESTED under the table's own data field — an earlier version
 * looked for flattened `<tableKey>_<column>` entries in the top-level field
 * list, found nothing, and silently fell back to row indices on every real
 * certificate. The platform templates have always declared
 * `quantityKind: "reference"` on the right column; nothing was reading it.
 */
function resolveReferenceColumnKey(
  job: CertificateJobData,
  tableKey: string,
): string | null {
  const table = (job.methodSnapshot.dataFields ?? []).find(
    (field) => field.key === tableKey,
  );
  for (const column of table?.columns ?? []) {
    if (column.quantityKind === "reference") return column.key;
  }
  return null;
}

// ── building the tables ─────────────────────────────────────────────────────

function buildResultTable(
  job: CertificateJobData,
  formulas: MethodFormula[],
  tableKey: string,
  phase: Phase | null,
): { table: CertificateResultTable | null; ambiguous: string[] } {
  const columns = collectColumns(formulas, tableKey, phase);
  if (columns.ambiguous.length > 0) {
    return { table: null, ambiguous: columns.ambiguous };
  }
  if (!columns.error && !columns.indication) {
    return { table: null, ambiguous: [] };
  }

  const results = job.results ?? {};
  const anchor = columns.error ?? columns.indication;
  if (!anchor) return { table: null, ambiguous: [] };

  const errorValues = columns.error
    ? valuesAt(results, columns.error.outputKey)
    : [];
  const indicationValues = columns.indication
    ? valuesAt(results, columns.indication.outputKey)
    : [];
  const referenceValues = columns.referenceValue
    ? valuesAt(results, columns.referenceValue.outputKey)
    : [];
  const uncertaintyValues = columns.uncertainty
    ? valuesAt(results, columns.uncertainty.outputKey)
    : [];
  const coverageValues = columns.coverageFactor
    ? valuesAt(results, columns.coverageFactor.outputKey)
    : [];
  const dofKey = resolveEffectiveDofKey(formulas, columns.coverageFactor);
  const dofValues = dofKey ? valuesAt(results, dofKey) : [];

  const rowCount = Math.max(
    errorValues.length,
    indicationValues.length,
    referenceValues.length,
  );
  if (rowCount === 0) return { table: null, ambiguous: [] };

  const unit = anchor.unit ?? null;
  const points = resolvePointLabels(job, tableKey, unit, rowCount);

  const rows: CertificateResultRow[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    // The rounding rule is driven by the uncertainty and then applied to every
    // sibling column, so a row never shows an error with more decimals than the
    // uncertainty that qualifies it (NIT-DICLA-021 A.6.3).
    const rounded = roundMeasurementForReport(
      toNumber(errorValues[index]) ?? toNumber(indicationValues[index]),
      toNumber(uncertaintyValues[index]),
    );
    const decimals = rounded?.decimals ?? 0;

    rows.push({
      point: points[index] ?? `Ponto ${index + 1}`,
      referenceValue: formatAtDecimals(
        toNumber(referenceValues[index]),
        decimals,
      ),
      indication: formatAtDecimals(toNumber(indicationValues[index]), decimals),
      error: formatAtDecimals(toNumber(errorValues[index]), decimals),
      expandedUncertainty: rounded?.uncertainty ?? null,
      coverageFactor: formatCoverageFactor(coverageValues[index]),
      effectiveDegreesOfFreedom: formatEffectiveDof(dofValues[index]),
    });
  }

  return {
    table: {
      title: phase ? PHASE_TITLES[phase] : SINGLE_PHASE_TITLE,
      unit,
      rows,
    },
    ambiguous: [],
  };
}

/**
 * One table per phase the method declares, in as-found → as-left order
 * (§7.8.4.1 d). A method that declares no phase gets a single table.
 */
function buildResultTables(
  job: CertificateJobData,
  formulas: MethodFormula[],
  tableKey: string,
): { tables: CertificateResultTable[]; ambiguous: string[] } {
  const declaredPhases = new Set(
    formulas
      .filter((formula) => tableKeyOf(formula) === tableKey)
      .map(phaseOf)
      .filter((phase): phase is Phase => phase !== null),
  );

  if (declaredPhases.size === 0) {
    const single = buildResultTable(job, formulas, tableKey, null);
    return {
      tables: single.table ? [single.table] : [],
      ambiguous: single.ambiguous,
    };
  }

  const tables: CertificateResultTable[] = [];
  const ambiguous: string[] = [];
  for (const phase of ["before", "after"] satisfies Phase[]) {
    if (!declaredPhases.has(phase)) continue;
    const built = buildResultTable(job, formulas, tableKey, phase);
    if (built.table) tables.push(built.table);
    ambiguous.push(...built.ambiguous);
  }
  return { tables, ambiguous };
}

// ── standards, uncertainty statement, signatory ─────────────────────────────

function buildStandards(job: CertificateJobData): CertificateStandard[] {
  return (job.standardsSnapshot ?? []).map((standard) => ({
    name: standard.name,
    certificateNumber: standard.certificateNumber,
    // Verbatim, never guessed from the certificate number — see the note on
    // normalizeStandards in @calibra-facil/certificate-data.
    issuer: standard.calibratedBy?.trim() || null,
    validUntilText: formatDate(standard.nextCalibrationDate),
  }));
}

function buildTraceabilityStatement(job: CertificateJobData): string | null {
  const bodies = [
    ...new Set(
      (job.standardsSnapshot ?? [])
        .map((standard) => standard.calibratedBy?.trim())
        .filter((body): body is string => Boolean(body)),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  if (bodies.length === 0) return null;

  const list =
    bodies.length === 1
      ? bodies[0]
      : `${bodies.slice(0, -1).join(", ")} e ${bodies[bodies.length - 1]}`;

  return (
    "As medições realizadas são metrologicamente rastreáveis ao Sistema " +
    "Internacional de Unidades (SI) por meio dos padrões relacionados neste " +
    `certificado, calibrados por ${list}.`
  );
}

/**
 * NIT-DICLA-021 A.6.1.1 / A.6.2 — the canonical sentence. Written once, here,
 * rather than left to each lab to phrase: it is the statement that gives the
 * numbers in the table their meaning, and a wrong one invalidates them.
 */
function buildUncertaintyStatement(tables: CertificateResultTable[]): string {
  const factors = new Set(
    tables.flatMap((table) =>
      table.rows
        .map((row) => row.coverageFactor)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const uniform = factors.size === 1 ? [...factors][0] : null;

  const base =
    "A incerteza de medição relatada é a incerteza expandida, obtida " +
    "multiplicando-se a incerteza padrão combinada pelo fator de abrangência k";

  const tail = uniform
    ? ` = ${uniform}, que para uma distribuição t com os graus de liberdade ` +
      "efetivos indicados corresponde a uma probabilidade de abrangência de " +
      "aproximadamente 95 %."
    : ", indicado para cada ponto na tabela de resultados, correspondendo a " +
      "uma probabilidade de abrangência de aproximadamente 95 %.";

  return `${base}${tail}`;
}

function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatLongDate(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function joinAddress(job: CertificateJobData): string | null {
  const { street, number, complement, neighbourhood, city, state, cep } =
    job.lab;
  const line = [
    [street, number].filter(Boolean).join(", "),
    complement,
    neighbourhood,
  ]
    .filter(Boolean)
    .join(" — ");
  const place = [[city, state].filter(Boolean).join("/"), cep]
    .filter(Boolean)
    .join(" — ");
  const full = [line, place].filter(Boolean).join(" — ");
  return full || null;
}

function customerAddress(job: CertificateJobData): string | null {
  const address = job.customer.address;
  if (!address) return null;
  const line = [address.street, address.number].filter(Boolean).join(", ");
  const place = [
    [address.city, address.state].filter(Boolean).join("/"),
    address.cep,
  ]
    .filter(Boolean)
    .join(" — ");
  const full = [line, address.neighbourhood, place].filter(Boolean).join(" — ");
  return full || null;
}

// ── entry point ─────────────────────────────────────────────────────────────

export type BuildLayoutDataOptions = {
  /** Data URI for the public verification QR. */
  qrCodeDataUrl?: string | null;
};

/**
 * Engine provenance lives in two places: the engine version and the compiled
 * method's fingerprint are frozen on the method snapshot, while the result
 * fingerprint is written by the engine into `results.__compiledExecution`.
 * Both are printed at the foot of the certificate so an auditor can reproduce
 * the calculation rather than take the numbers on trust.
 */
function buildProvenance(
  job: CertificateJobData,
): CalibrationCertificateData["provenance"] {
  const compiled = job.results?.__compiledExecution;
  const resultFingerprint =
    compiled && typeof compiled === "object" && !Array.isArray(compiled)
      ? asTrimmedString(
          Object.getOwnPropertyDescriptor(compiled, "resultFingerprint")?.value,
        )
      : null;

  const engineVersion = job.methodSnapshot?.engineVersion ?? null;
  const methodFingerprint = job.methodSnapshot?.methodFingerprint ?? null;
  if (!engineVersion && !methodFingerprint && !resultFingerprint) return null;
  return { engineVersion, methodFingerprint, resultFingerprint };
}

export function buildCertificateLayoutData(
  job: CertificateJobData,
  options: BuildLayoutDataOptions = {},
): LayoutDataResult {
  const reasons: string[] = [];
  const formulas = job.methodSnapshot?.formulas ?? [];

  const tableKey = resolveResultsTableKey(formulas);
  if (!tableKey) {
    reasons.push(
      "O método não declara nenhuma fórmula com role 'expanded_uncertainty' " +
        "no grupo 'calibration_result' sobre uma tabela de pontos, então não " +
        "há tabela de resultados a montar.",
    );
  }

  const built = tableKey
    ? buildResultTables(job, formulas, tableKey)
    : { tables: [], ambiguous: [] };
  const tables = built.tables;
  if (built.ambiguous.length > 0) {
    reasons.push(
      "O método declara mais de uma fórmula para a mesma coluna na mesma fase " +
        `(${built.ambiguous.join("; ")}), então não é possível saber qual é ` +
        "qual. Reexecute o job para congelar um snapshot do método atualizado.",
    );
  }
  if (tableKey && tables.length === 0 && built.ambiguous.length === 0) {
    reasons.push(
      "Nenhum ponto de resultado foi encontrado para a tabela declarada " +
        `'${tableKey}'.`,
    );
  }

  if (!job.approvedAt) {
    reasons.push("O job não tem data de aprovação, exigida pelo §7.8.2.1(j).");
  }
  if (!job.approverName) {
    reasons.push("O job não tem aprovador, exigido pelo §7.8.2.1(b).");
  }

  if (reasons.length > 0) return { ok: false, reasons };

  const performedAtText = formatDate(job.performedAt);
  const issuedAtText = formatDate(job.approvedAt);
  if (!performedAtText || !issuedAtText) {
    return {
      ok: false,
      reasons: ["Datas de calibração ou emissão inválidas."],
    };
  }

  // #647: accreditation vigência is evaluated at the EMISSION instant.
  const accredited = shouldRenderAccreditationSeal({
    lab: job.lab,
    methodAccreditedScope: job.methodSnapshot?.accreditedScope,
    scopeOverrideJustification: job.scopeOverrideJustification,
    atDate: new Date(),
  });

  const indicatorSvg = renderEccentricityIndicatorSvgMarkup(
    certificateImageContextFromJob(job),
    job.data ?? {},
  );

  const data: CalibrationCertificateData = {
    certificateNumber: job.jobId,
    qrCodeDataUrl: options.qrCodeDataUrl ?? null,
    verificationUrl: `https://verify.calibrafacil.com/v/${job.verificationToken}`,

    lab: {
      name: job.lab.name,
      cnpj: job.lab.cnpj,
      addressText: joinAddress(job),
      phone: job.lab.phone,
      email: job.lab.email,
      website: job.lab.website,
      logoDataUrl: job.lab.logo,
      accreditationNumber: job.lab.accreditationNumber,
    },
    customer: {
      name: job.customer.name,
      taxId: job.customer.taxId,
      addressText: customerAddress(job),
    },
    item: {
      description: job.asset.name,
      manufacturer: job.asset.manufacturer,
      model: job.asset.model,
      serialNumber: job.asset.serialNumber,
      tag: job.asset.tag,
      inmetroRegistration: asTrimmedString(
        job.assetSnapshot?.specifications?.inmetroRegistration,
      ),
      conditionOnReceipt: job.serviceOrder?.intakeCondition ?? null,
      accessories: job.serviceOrder?.accessories ?? null,
    },
    dates: {
      receivedAtText: formatDate(job.serviceOrder?.receivedAt),
      performedAtText,
      issuedAtText,
    },
    method: {
      name: job.methodSnapshot.methodName,
      version: job.methodSnapshot.methodVersion,
      procedureCode: job.methodSnapshot.certificateContent?.procedureCode,
      referenceStandards:
        job.methodSnapshot.certificateContent?.referenceStandards ?? [],
    },
    locationText: job.calibrationLocationSnapshot?.addressText ?? null,
    environment: job.environmentalSnapshot
      ? {
          temperatureText: formatEnvironment(
            job.environmentalSnapshot.temperature,
            "ºC",
          ),
          humidityText: formatEnvironment(
            job.environmentalSnapshot.humidity,
            "%",
          ),
          pressureText: formatEnvironment(
            job.environmentalSnapshot.pressure,
            "hPa",
          ),
          withinLimits: job.environmentalSnapshot.withinLimits,
          outOfLimitsJustification:
            job.environmentalSnapshot.outOfLimitsJustification,
        }
      : null,

    accredited,
    resultTables: tables,
    uncertaintyStatement: buildUncertaintyStatement(tables),

    standards: buildStandards(job),
    traceabilityStatementText: buildTraceabilityStatement(job),

    methodDeviations: job.methodDeviations?.trim() || null,
    // §7.8.6.2 needs all three of: what it applies to, the specification, and
    // the decision rule. No method in the catalogue declares a decision rule
    // yet, so no certificate carries a verdict — deliberately. Inventing one
    // (as PR #587 did) is a metrological claim the laboratory never made.
    conformity: null,

    supersedesText: job.originalJobId
      ? `Este certificado substitui o certificado ${job.originalJobId}` +
        (job.amendmentReason ? ` (${job.amendmentReason}).` : ".")
      : null,

    signatory: {
      name: job.approverName ?? "",
      role: job.lab.technicalManagerTitle,
      placeAndDateText: buildPlaceAndDate(job),
      // fetchCertificateJobData resolves this from member_visual_signature and
      // has always carried it; the layout simply had nowhere to put it, so it
      // was fetched and dropped on every certificate.
      signatureImageDataUrl: job.approverSignatureUrl ?? null,
    },

    provenance: buildProvenance(job),
  };

  // Mass-only blocks. Other quantities declare neither table, so the sections
  // simply do not render.
  const eccentricity = buildEccentricity(job, formulas, indicatorSvg);
  if (eccentricity) data.eccentricity = eccentricity;
  const repeatability = buildRepeatability(job, formulas);
  if (repeatability) data.repeatability = repeatability;

  return { ok: true, data };
}

/** Specifications are a free-form bag; only a real string reaches the page. */
function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatEnvironment(value: unknown, unit: string): string | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return `${parsed.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${unit}`;
}

function buildPlaceAndDate(job: CertificateJobData): string | null {
  const date = formatLongDate(job.approvedAt);
  if (!date) return null;
  const place = [job.lab.city, job.lab.state].filter(Boolean).join("/");
  return place ? `${place}, ${date}` : date;
}

/**
 * The eccentricity block, when the method declares a table for it. Identified
 * as a row-scoped table that reports a primary result but no expanded
 * uncertainty of its own, carrying a position column — again declared, not
 * matched on the word "excentricidade".
 */
function buildEccentricity(
  job: CertificateJobData,
  formulas: MethodFormula[],
  indicatorSvg: string | null,
): CalibrationCertificateData["eccentricity"] {
  const tableKey = resolveBlockTableKey(job, formulas, "posicao");
  if (!tableKey) return null;

  const table = job.data?.[tableKey];
  const inputRows = Array.isArray(table) ? table : [];
  if (inputRows.length === 0) return null;

  const unit = blockUnit(formulas, tableKey);
  const rows = inputRows.map((row, index) => {
    const record = row && typeof row === "object" ? row : {};
    return {
      position: readString(record, "posicao") ?? `Posição ${index + 1}`,
      before: formatBlockValue(readAny(record, "antes")),
      after: formatBlockValue(readAny(record, "apos")),
    };
  });

  return { unit, rows, indicatorSvg, maxDeviationText: null };
}

/**
 * The repeatability block: one row per condition, with the individual readings
 * spelled out. cg-18 §6.1 wants the readings visible, not just the dispersion.
 */
function buildRepeatability(
  job: CertificateJobData,
  formulas: MethodFormula[],
): CalibrationCertificateData["repeatability"] {
  const tableKey = resolveBlockTableKey(job, formulas, "condicao");
  if (!tableKey) return null;

  const table = job.data?.[tableKey];
  const inputRows = Array.isArray(table) ? table : [];
  if (inputRows.length === 0) return null;

  const unit = blockUnit(formulas, tableKey);
  // The dispersion the method computes over this table — cg-18 §6.1's s, the
  // figure the readings exist to produce. It was hardcoded to null, so the
  // "Repetibilidade" column printed an em dash on every certificate while the
  // engine had the number all along.
  const dispersion = formulas.find(
    (formula) =>
      isReported(formula) &&
      tableKeyOf(formula) === tableKey &&
      formula.reporting?.role === "primary_result",
  );
  const dispersionValues = dispersion
    ? valuesAt(job.results ?? {}, dispersion.outputKey)
    : [];

  const rows = inputRows.map((row, index) => {
    const record = row && typeof row === "object" ? row : {};
    const readings: string[] = [];
    for (let reading = 1; ; reading += 1) {
      const value = readAny(record, `leitura_${reading}`);
      if (value === undefined) break;
      readings.push(formatBlockValue(value) ?? "");
    }
    return {
      phase: readString(record, "condicao") ?? `Condição ${index + 1}`,
      readings,
      value: formatBlockValue(dispersionValues[index]),
    };
  });

  return { unit, rows, note: null };
}

/**
 * Finds a row-scoped table, other than the results table, whose input rows
 * carry `markerColumn`. The marker is a declared data-field key, so this stays
 * a lookup rather than a guess about naming.
 */
function resolveBlockTableKey(
  job: CertificateJobData,
  formulas: MethodFormula[],
  markerColumn: string,
): string | null {
  const resultsTable = resolveResultsTableKey(formulas);
  const candidates = new Set(
    formulas
      .map(tableKeyOf)
      .filter((key): key is string => key !== null && key !== resultsTable),
  );

  for (const key of candidates) {
    const table = job.data?.[key];
    const first = Array.isArray(table) ? table[0] : null;
    if (first && typeof first === "object" && markerColumn in first) {
      return key;
    }
  }
  return null;
}

function blockUnit(formulas: MethodFormula[], tableKey: string): string | null {
  for (const formula of formulas) {
    if (tableKeyOf(formula) === tableKey && formula.unit) return formula.unit;
  }
  return null;
}

function readAny(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function readString(record: object, key: string): string | null {
  const value = readAny(record, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Same formatter the results table uses. It must be: toLocaleString's default
 * grouping renders 499500 g as "499.500", which in pt-BR is a thousands
 * separator but reads as a decimal point to half the world — and the very same
 * quantity appeared as "499500" two sections above. One document, one format.
 */
function formatBlockValue(value: unknown): string | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return formatDecimalPtBr(parsed, Math.min(4, fractionDigitsOf(parsed)));
}

/** Re-exported so the worker does not need a second import for the QR. */
export { formatAccreditationNumber };
