import {
  formatAccreditationNumber,
  shouldRenderAccreditationSeal,
} from "@calibra-facil/shared";
import {
  convertMassValue,
  isMassMeasurementUnit,
  type MassUnit,
} from "@calibra-facil/shared/mass-units";
import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  type CertificateImageContext,
} from "./eccentricity-indicator.js";
import { formatDecimalPtBr } from "./decimal-format.js";

/**
 * The job snapshot a certificate is rendered from — every value that can land
 * in a certificate cell flows through this shape. It is deliberately a plain
 * data type (no DB row types) so `buildCertificateData` stays unit-testable
 * from a fixture.
 */
export type CertificateJobData = {
  jobId: string;
  verificationToken: string;
  certificateName?: string | null;
  organizationId?: string | null;
  organizationSlug?: string | null;
  unitId?: number | null;
  performedAt: Date | null;
  approvedAt: Date | null;
  environmentalSnapshot?: EnvironmentalSnapshot | null;
  calibrationLocationSnapshot?: CalibrationLocationSnapshot | null;
  calibrationPhaseSnapshot?: CalibrationPhaseSnapshot | null;
  lab: {
    name: string;
    cnpj?: string | null;
    accreditationNumber?: string | null;
    accreditationBody?: string | null;
    accreditationActive?: boolean | null;
    accreditationValidFrom?: Date | string | null;
    accreditationValidUntil?: Date | string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    neighbourhood?: string | null;
    city?: string | null;
    state?: string | null;
    cep?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    logo?: string | null;
    technicalManagerName?: string | null;
    technicalManagerTitle?: string | null;
  };
  customer: {
    name: string;
    taxId?: string | null;
    phone?: string | null;
    email?: string | null;
    address: CustomerAddress | null;
  };
  asset: {
    name: string;
    serialNumber: string;
    tag: string;
    model: string | null;
    manufacturer: string | null;
  };
  methodSnapshot: MethodSnapshot;
  assetSnapshot?: AssetSnapshot | null;
  /**
   * #427 Phase 1: frozen scope-violation override. Non-null means the
   * approval was downgraded to non-accredited issuance (seal suppressed).
   */
  scopeOverrideJustification?: string | null;
  standardsSnapshot: StandardSnapshot[] | null;
  /**
   * ISO/IEC 17025 §7.8.2.1(n): additions to, deviations from, or exclusions
   * from the method, as actually executed. Distinct from
   * `scopeOverrideJustification` (an accreditation-scope override that
   * suppresses the seal) and from
   * `environmentalSnapshot.outOfLimitsJustification` (environmental limits
   * only) — those answer different questions and must not be conflated.
   */
  methodDeviations?: string | null;
  serviceOrder?: {
    inmetroRepairMarkNumber?: string | null;
    /**
     * §7.8.2.1(h) date of receipt of the item and (g) its condition on
     * receipt. Both live on the originating service order; a job with no
     * service order (item calibrated in loco, or delivered straight to the
     * bench) legitimately has neither — §7.8.2.1 allows omission "unless the
     * laboratory has valid reasons for not doing so".
     */
    receivedAt?: Date | string | null;
    intakeCondition?: string | null;
    accessories?: string | null;
  } | null;
  data: Record<string, unknown> | null;
  results: Record<string, unknown> | null;
  approverName: string | null;
  certificateTemplateSnapshot?: Record<string, unknown> | null;
  approverSignatureUrl?: string | null;
  supersedesId?: number | null;
  supersededById?: number | null;
  amendmentNumber?: number | null;
  amendmentReason?: string | null;
  originalJobId?: string | null;
  originalApprovedAt?: Date | null;
};

export type CustomerAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
};

export type MethodInputField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "table";
  unit?: string;
  required?: boolean;
  options?: string[];
  defaultValue?: string | number;
  source?: "manual" | "asset_spec";
  /**
   * What the field MEASURES, as declared by the method. The certificate layout
   * uses "reference" to find which column of a points table holds the applied
   * reference value, so it can label each row without knowing the method.
   */
  quantityKind?:
    | "indication"
    | "reference"
    | "environment"
    | "correction"
    | "tolerance"
    | "uncertainty"
    | "resolution"
    | "other";
  assetSpecKey?: string;
  allowOverride?: boolean;
  phaseBlockKey?: string;
  phaseBlockLabel?: string;
  eccentricityIndicator?: {
    enabled?: boolean;
    variant?: "circular_platform" | "road_scale";
  };
  weighingRangeResolver?: {
    enabled?: boolean;
    assetSpecKey?: string;
    pointColumn?: string;
    pointUnit?: "mg" | "g" | "kg";
    targetColumns?: {
      rangeLabel?: string;
      rangeMin?: string;
      rangeMax?: string;
      rangeUnit?: string;
      resolution?: string;
      resolutionUnit?: string;
    };
  };
  columns?: Array<{
    key: string;
    label: string;
    type: "text" | "number";
    unit?: string;
    role?: "standard_value" | "mass_standard_composition";
    phase?: "before" | "after" | "always";
    massComposition?: {
      targetUnit?: "mg" | "g" | "kg";
      optionSource?: "certified_values" | "composition_profiles";
      targetColumns?: {
        certifiedValue?: string;
        compositionLabel?: string;
        expandedUncertainty?: string;
        maxError?: string;
        drift?: string;
        buoyancy?: string;
      };
    };
  }>;
};

export type MethodFormulaReporting = {
  includeInCertificate?: boolean;
  role?:
    | "primary_result"
    | "mean_indication"
    | "reference_value"
    | "expanded_uncertainty"
    | "coverage_factor"
    | "conformity_margin"
    | "conformity_verdict"
    | "uncertainty_component"
    | "auxiliary";
  group?: "calibration_result" | "uncertainty_budget" | "raw_calculation";
  /**
   * as-found ("before") vs as-left ("after"), §7.8.4.1(d). A method that
   * measures once leaves this undefined; one that measures either side of an
   * adjustment declares it per formula, and the layout renders one results
   * table per declared phase.
   */
  phase?: "before" | "after";
};

/**
 * Which table a formula evaluates over. "table_row" means it produces one
 * value per row of `tableKey`, i.e. an ARRAY in `results`. This is how the
 * layout separates the main results table from the eccentricity and
 * repeatability blocks: they are different tables, declared as such, not
 * guessed from the output key.
 */
export type MethodFormulaScope =
  | { kind: "scalar" }
  | { kind: "table_row"; tableKey: string };

export type MethodFormula = {
  outputKey: string;
  expression: string;
  label?: string;
  unit?: string;
  scope?: MethodFormulaScope;
  reporting?: MethodFormulaReporting;
};

export type MethodCertificateContent = {
  procedureCode?: string;
  referenceStandards?: string[];
  certifiedValuesDisplay?: "full" | "hidden";
  massCompositionDisplay?: "full" | "hidden";
  uncertaintyBudgetDisplay?: "full" | "hidden";
  /** Free-text decision rule (ISO/IEC 17025 §7.8.6) printed verbatim. */
  decisionRuleStatement?: string;
  /** Calibration curve charts (deterministic SVG in the html engine). */
  resultCharts?: Array<{
    tableKey: string;
    xKey: string;
    yKey: string;
    uncertaintyKey?: string | null;
    label?: string | null;
  }>;
};

export type MethodSnapshot = {
  methodId: number;
  methodName: string;
  methodVersion: number;
  dataFields?: MethodInputField[];
  formulas?: MethodFormula[];
  certificateContent?: MethodCertificateContent | null;
  accreditedScope?: boolean;
  /**
   * Engine provenance, frozen with the method. Printed small at the foot of the
   * certificate so an auditor can reproduce the calculation: which engine ran,
   * and against which compiled method.
   */
  engineVersion?: string | null;
  methodFingerprint?: string | null;
};

export type CertifiedValue = {
  nominal: string;
  authentication?: string | null;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  compositionProfile?: boolean;
  profileKey?: string | null;
  profileClass?: string | null;
};

export type StandardSnapshot = {
  id: number;
  name: string;
  type?: string | null;
  certificateNumber: string;
  calibratedBy?: string | null;
  calibrationDate: Date | string;
  nextCalibrationDate?: Date | string | null;
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  coverageFactor: number;
  certifiedValues?: CertifiedValue[] | null;
};

export type EnvironmentalSnapshot = {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  recordedAt: string;
  recordedBy: string;
  limits: Record<string, unknown> | null;
  withinLimits: boolean;
  outOfLimitsJustification: string | null;
};

export type CalibrationLocationSnapshot = {
  type: "customer_site" | "lab" | "other";
  addressText: string;
  notes?: string | null;
  recordedAt?: string;
  recordedBy?: string;
};

export type CalibrationPhaseSnapshot = {
  blocks: Record<
    string,
    {
      mode: "before_and_after" | "before_only" | "after_only" | "not_performed";
      reason?: string | null;
    }
  >;
  recordedAt?: string;
  recordedBy?: string;
};

export type AssetSnapshot = {
  assetId: number;
  assetTypeId: number;
  assetTypeName: string;
  assetTypeSlug: string;
  baseMeasurementUnit?: MassUnit | null;
  name: string;
  tag: string;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  specifications: Record<string, unknown> | null;
  capturedAt: string;
};

export type BuildCertificateDataOptions = {
  /**
   * Renders the accreditation seal as an image data URL when the certificate
   * is emitted inside the accreditation window. Injected so this package does
   * not depend on the React/documents renderer that produces the SVG.
   */
  renderAccreditationSeal?: (
    accreditationNumber: string | null | undefined,
  ) => string;
};

type Dateish = Date | string | null | undefined;

function parseDateish(value: Dateish): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatCertificateDate(value: Dateish): string {
  const date = parseDateish(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function toIsoDateish(value: Dateish): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMeasuredValue(
  value: unknown,
  unit: string,
  fractionDigits = 1,
): string {
  const numeric = asFiniteNumber(value);
  return numeric === null
    ? ""
    : `${formatDecimalPtBr(numeric, fractionDigits)} ${unit}`;
}

function formatMethodValue(
  value: unknown,
  unit: unknown,
  targetUnit: unknown,
): unknown {
  if (value === null || value === undefined || value === "") return "";

  const numeric = asFiniteNumber(value);
  if (numeric === null) return value;

  if (isMassMeasurementUnit(unit) && isMassMeasurementUnit(targetUnit)) {
    const converted = convertMassValue(numeric, unit, targetUnit);
    return converted === null
      ? formatDecimalPtBr(numeric)
      : formatDecimalPtBr(converted);
  }

  return formatDecimalPtBr(numeric);
}

function isEffectiveDegreesOfFreedomKey(key: string): boolean {
  return key === "veff" || key.startsWith("veff_");
}

function formatEffectiveDegreesOfFreedom(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value.map((item) => formatEffectiveDegreesOfFreedom(item));
  }

  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.toLowerCase() === "infinito" || raw === "Infinity") {
    return "infinito";
  }

  const numeric = asFiniteNumber(value);
  if (numeric === null) return value;
  return numeric >= 1_000_000_000 ? "infinito" : formatDecimalPtBr(numeric, 0);
}

function formatAssetMeasurement(
  job: CertificateJobData,
  value: unknown,
  sourceUnit: unknown,
): string {
  const numeric = asFiniteNumber(value);
  if (numeric === null) return "";

  const targetUnit = job.assetSnapshot?.baseMeasurementUnit;
  if (isMassMeasurementUnit(targetUnit)) {
    const unit = isMassMeasurementUnit(sourceUnit) ? sourceUnit : "g";
    const converted = convertMassValue(numeric, unit, targetUnit);
    if (converted !== null) {
      return `${formatDecimalPtBr(converted)} ${targetUnit}`;
    }
  }

  return isMassMeasurementUnit(sourceUnit)
    ? `${formatDecimalPtBr(numeric)} ${sourceUnit}`
    : formatDecimalPtBr(numeric);
}

function getFirstWeighingRangeSpec(
  job: CertificateJobData,
): Record<string, unknown> | undefined {
  const ranges = job.assetSnapshot?.specifications?.weighingRanges;
  if (!Array.isArray(ranges)) {
    return undefined;
  }

  const firstRange = recordFromUnknown(ranges[0]);
  return Object.keys(firstRange).length > 0 ? firstRange : undefined;
}

function collectMethodDataUnits(job: CertificateJobData): Map<string, unknown> {
  const units = new Map<string, unknown>();

  for (const field of job.methodSnapshot.dataFields ?? []) {
    if (field.type === "table") {
      for (const column of field.columns ?? []) {
        if (column.unit) {
          units.set(`${field.key}.${column.key}`, column.unit);
        }
      }
      continue;
    }

    if (field.unit) {
      units.set(field.key, field.unit);
    }
  }

  return units;
}

function normalizeMethodDataDisplay(job: CertificateJobData) {
  const data = job.data ?? {};
  const units = collectMethodDataUnits(job);
  const targetUnit = job.assetSnapshot?.baseMeasurementUnit;

  const formatByPath = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => formatByPath(item, path));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(recordFromUnknown(value)).map(([key, itemValue]) => [
          key,
          formatByPath(itemValue, path ? `${path}.${key}` : key),
        ]),
      );
    }

    return formatMethodValue(value, units.get(path), targetUnit);
  };

  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, formatByPath(value, key)]),
  );
}

function normalizeMethodResultsDisplay(job: CertificateJobData) {
  const results = job.results ?? {};
  const targetUnit = job.assetSnapshot?.baseMeasurementUnit;
  const formulaUnits = new Map(
    (job.methodSnapshot.formulas ?? []).map((formula) => [
      formula.outputKey,
      formula.unit,
    ]),
  );

  const formatResultValue = (value: unknown, unit: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => formatResultValue(item, unit));
    }

    return formatMethodValue(value, unit, targetUnit);
  };

  return Object.fromEntries(
    Object.entries(results)
      .filter(([key]) => !key.startsWith("__"))
      .map(([key, value]) => [
        key,
        isEffectiveDegreesOfFreedomKey(key)
          ? formatEffectiveDegreesOfFreedom(value)
          : formatResultValue(value, formulaUnits.get(key)),
      ]),
  );
}

/**
 * ISO/IEC 17025 §7.8.4.1(c) — "a statement identifying how the measurements
 * are metrologically traceable".
 *
 * Composed from what the standards snapshot actually carries, never invented.
 * The per-standard calibrating body (`calibratedBy`) is the same fact a real
 * RBC certificate prints in its "Rastreabilidade" column — see
 * docs/referencias/certificados-internacionais/README.md. When no standard
 * names its calibrating body we return null rather than assert traceability we
 * cannot evidence; the layout then falls back to the standards table alone.
 */
function buildTraceabilityStatement(job: CertificateJobData): {
  bodies: string[];
  text: string;
} | null {
  const bodies = [
    ...new Set(
      (job.standardsSnapshot ?? [])
        .map((standard) => standard.calibratedBy?.trim())
        .filter((body): body is string => Boolean(body)),
    ),
    // sort (not toSorted, which is outside this package's lib target) is safe
    // here: the array was just spread from the Set above, so there is no
    // caller-visible original to mutate.
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  if (bodies.length === 0) return null;

  const list =
    bodies.length === 1
      ? bodies[0]
      : `${bodies.slice(0, -1).join(", ")} e ${bodies[bodies.length - 1]}`;

  return {
    bodies,
    text:
      "As medições realizadas são metrologicamente rastreáveis ao Sistema " +
      "Internacional de Unidades (SI) por meio dos padrões relacionados neste " +
      `certificado, calibrados por ${list}.`,
  };
}

function normalizeStandards(job: CertificateJobData) {
  return (job.standardsSnapshot ?? []).map((standard, index) => ({
    index,
    id: standard.id,
    name: standard.name,
    type: standard.type,
    certificateNumber: standard.certificateNumber,
    /**
     * The calibrating body, verbatim. This used to fall back to
     * `certificateNumber.split("-")[0]` — guessing a laboratory's identity by
     * string-splitting a certificate number, on a field that carries
     * metrological traceability (§7.8.4.1 c). A guess is worse than a blank:
     * null lets the layout omit the entry honestly.
     */
    issuer: standard.calibratedBy?.trim() || null,
    calibratedBy: standard.calibratedBy,
    calibrationDate: toIsoDateish(standard.calibrationDate),
    calibrationDateText: formatCertificateDate(standard.calibrationDate),
    validUntil: toIsoDateish(standard.nextCalibrationDate),
    validUntilText: formatCertificateDate(standard.nextCalibrationDate),
    nextCalibrationDate: toIsoDateish(standard.nextCalibrationDate),
    nextCalibrationDateText: formatCertificateDate(
      standard.nextCalibrationDate,
    ),
    uncertainty: standard.uncertainty,
    uncertaintyUnit: standard.uncertaintyUnit,
    coverageFactor: standard.coverageFactor,
    certifiedValues:
      standard.certifiedValues?.map((certifiedValue, certifiedValueIndex) => ({
        index: certifiedValueIndex,
        standardIndex: index,
        standardId: standard.id,
        standardName: standard.name,
        certificateNumber: standard.certificateNumber,
        nominal: certifiedValue.nominal,
        value: certifiedValue.value,
        uncertainty: certifiedValue.uncertainty,
        unit: certifiedValue.unit,
        maxError: certifiedValue.maxError,
        drift: certifiedValue.drift,
        buoyancy: certifiedValue.buoyancy,
        coverageFactor: certifiedValue.coverageFactor,
      })) ?? [],
  }));
}

function normalizeCertifiedValues(
  standards: ReturnType<typeof normalizeStandards>,
) {
  return standards.flatMap((standard) => standard.certifiedValues);
}

function normalizeResultRows(job: CertificateJobData) {
  const results = job.results ?? {};
  const formulas = job.methodSnapshot.formulas ?? [];
  const rows = formulas
    .filter((formula) => formula.outputKey in results)
    .map((formula) => ({
      key: formula.outputKey,
      label: formula.label ?? formula.outputKey,
      value: results[formula.outputKey],
      unit: formula.unit,
      role: formula.reporting?.role,
      group: formula.reporting?.group ?? "calibration_result",
      includeInCertificate: formula.reporting?.includeInCertificate ?? true,
    }));

  const formulaKeys = new Set(formulas.map((formula) => formula.outputKey));
  for (const [key, value] of Object.entries(results)) {
    if (formulaKeys.has(key)) {
      continue;
    }

    rows.push({
      key,
      label: key,
      value,
      unit: undefined,
      role: undefined,
      group: "calibration_result",
      includeInCertificate: true,
    });
  }

  return rows;
}

function findFirstResultByRole(
  rows: ReturnType<typeof normalizeResultRows>,
  role: string,
) {
  return rows.find((row) => row.role === role) ?? null;
}

function normalizeMassCompositions(job: CertificateJobData) {
  const sources = [job.data ?? {}, job.results ?? {}];
  const compositions: Array<Record<string, unknown>> = [];

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const composition = recordFromUnknown(value);
      if (composition.kind === "mass_standard_composition") {
        compositions.push({ key, ...composition });
      }
    }
  }

  return compositions;
}

function formatCustomerAddress(
  address: CertificateJobData["customer"]["address"],
): string {
  if (!address) return "";
  return [
    [address.street, address.number].filter(Boolean).join(", "),
    address.complement,
    address.neighbourhood,
    address.city && address.state
      ? `${address.city} - ${address.state}`
      : (address.city ?? address.state),
    address.cep,
  ]
    .filter(Boolean)
    .join(" - ");
}

function formatLabAddress(job: CertificateJobData): string {
  return [
    [job.lab.street, job.lab.number].filter(Boolean).join(", "),
    job.lab.complement,
    job.lab.neighbourhood,
    job.lab.city && job.lab.state
      ? `${job.lab.city} - ${job.lab.state}`
      : (job.lab.city ?? job.lab.state),
    job.lab.cep,
  ]
    .filter(Boolean)
    .join(" - ");
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

/**
 * Shape a calibration job snapshot into the data record certificate templates
 * bind against. Every "why did this cell get this value" question is answered
 * here — keep this function pure so certificates stay reproducible and the
 * shaping stays unit-testable without a database or LibreOffice.
 */
export function buildCertificateData(
  job: CertificateJobData,
  options: BuildCertificateDataOptions = {},
): Record<string, unknown> {
  const standards = normalizeStandards(job);
  const resultRows = normalizeResultRows(job);
  const firstWeighingRange = getFirstWeighingRangeSpec(job);
  const assetSpecifications = job.assetSnapshot?.specifications ?? {};
  const expandedUncertainty = findFirstResultByRole(
    resultRows,
    "expanded_uncertainty",
  );
  const coverageFactor = findFirstResultByRole(resultRows, "coverage_factor");
  const uncertaintyBudget = resultRows.filter(
    (row) => row.group === "uncertainty_budget",
  );
  const calibrationResults = resultRows.filter(
    (row) => row.group === "calibration_result",
  );
  // #647: vigência is evaluated at the EMISSION instant — outside the window
  // the certificate is generated without the Cgcre seal (decided 2026-07-05).
  const certificateAccredited = shouldRenderAccreditationSeal({
    lab: job.lab,
    methodAccreditedScope: job.methodSnapshot?.accreditedScope,
    scopeOverrideJustification: job.scopeOverrideJustification,
    atDate: new Date(),
  });
  const accreditationNumberFormatted = formatAccreditationNumber(
    job.lab.accreditationNumber,
  );
  const lab = {
    name: job.lab.name,
    cnpj: job.lab.cnpj,
    accreditationNumber: job.lab.accreditationNumber,
    accreditationNumberFormatted,
    accreditationBody: job.lab.accreditationBody,
    accreditationActive: job.lab.accreditationActive ?? false,
    // Existing template manifests bind the seal image to
    // `organization.accreditationSealPng`; absent (null) means no seal cell.
    accreditationSealPng:
      certificateAccredited && options.renderAccreditationSeal
        ? options.renderAccreditationSeal(job.lab.accreditationNumber)
        : null,
    address: formatLabAddress(job),
    street: job.lab.street,
    number: job.lab.number,
    complement: job.lab.complement,
    neighbourhood: job.lab.neighbourhood,
    city: job.lab.city,
    state: job.lab.state,
    cep: job.lab.cep,
    phone: job.lab.phone,
    email: job.lab.email,
    website: job.lab.website,
    technicalManagerName: job.lab.technicalManagerName,
    technicalManagerTitle: job.lab.technicalManagerTitle,
    logo: job.lab.logo,
  };

  return {
    raw: job,
    snapshots: {
      method: job.methodSnapshot,
      asset: job.assetSnapshot,
      standards: job.standardsSnapshot,
      environmental: job.environmentalSnapshot,
      calibrationLocation: job.calibrationLocationSnapshot,
      calibrationPhase: job.calibrationPhaseSnapshot,
      certificateTemplate: job.certificateTemplateSnapshot,
    },
    lab,
    organization: lab,
    accreditation: {
      accredited: certificateAccredited,
      labActive: job.lab.accreditationActive ?? false,
      methodAccreditedScope: job.methodSnapshot?.accreditedScope ?? false,
      number: job.lab.accreditationNumber,
      numberFormatted: accreditationNumberFormatted,
      body: job.lab.accreditationBody,
    },
    customer: {
      name: job.customer.name,
      taxId: job.customer.taxId,
      address: formatCustomerAddress(job.customer.address),
      phone: job.customer.phone,
      email: job.customer.email,
    },
    asset: {
      kind: job.asset.name,
      serialNumber: job.asset.serialNumber,
      tag: job.asset.tag,
      model: job.asset.model,
      manufacturer: job.asset.manufacturer,
      measurementUnit: job.assetSnapshot?.baseMeasurementUnit,
      baseMeasurementUnit: job.assetSnapshot?.baseMeasurementUnit,
      capacity: assetSpecifications.capacity,
      capacityText: formatAssetMeasurement(
        job,
        assetSpecifications.capacity,
        assetSpecifications.capacityUnit ?? firstWeighingRange?.rangeUnit,
      ),
      division: assetSpecifications.resolution,
      divisionText: formatAssetMeasurement(
        job,
        assetSpecifications.resolution,
        assetSpecifications.resolutionUnit ??
          firstWeighingRange?.resolutionUnit,
      ),
      // Inmetro model approval / registration (Etiqueta de Reparo context).
      // Sourced from the asset-type blueprint spec (like "Portaria"); backs the
      // `{{asset.inmetroRegistration}}` certificate token (previously empty).
      inmetroRegistration: assetSpecifications.inmetroRegistration,
    },
    certificate: {
      number: job.jobId,
      name: job.certificateName,
      // Public verification URL — drives the QR code binding on the certificate
      // PDF (same target as the thermal-label QR). See verifyRouter / verify page.
      verificationUrl: `https://verify.calibrafacil.com/v/${job.verificationToken}`,
      issuedAt: toIsoDateish(job.approvedAt),
      issuedAtText: formatCertificateDate(job.approvedAt),
      supersedesId: job.supersedesId,
      supersededById: job.supersededById,
      amendmentNumber: job.amendmentNumber,
      amendmentReason: job.amendmentReason,
      originalJobId: job.originalJobId,
      originalApprovedAt: toIsoDateish(job.originalApprovedAt),
    },
    job: {
      id: job.jobId,
      performedAt: toIsoDateish(job.performedAt),
      performedAtText: formatCertificateDate(job.performedAt),
      location: job.calibrationLocationSnapshot?.addressText,
      locationType: job.calibrationLocationSnapshot?.type,
    },
    method: {
      id: job.methodSnapshot.methodId,
      name: job.methodSnapshot.methodName,
      version: job.methodSnapshot.methodVersion,
      procedureCode: job.methodSnapshot.certificateContent?.procedureCode,
      referenceStandards:
        job.methodSnapshot.certificateContent?.referenceStandards ?? [],
      referenceStandardsText:
        job.methodSnapshot.certificateContent?.referenceStandards
          ?.filter((item) => item.trim())
          .join(" e ") ?? "",
    },
    methodSnapshot: job.methodSnapshot,
    assetSnapshot: job.assetSnapshot,
    standardsSnapshot: job.standardsSnapshot,
    environmentalSnapshot: job.environmentalSnapshot,
    calibrationLocationSnapshot: job.calibrationLocationSnapshot,
    calibrationPhaseSnapshot: job.calibrationPhaseSnapshot,
    certificateTemplateSnapshot: job.certificateTemplateSnapshot,
    serviceOrder: {
      inmetroRepairMarkNumber: job.serviceOrder?.inmetroRepairMarkNumber,
      receivedAt: toIsoDateish(job.serviceOrder?.receivedAt ?? null),
      receivedAtText: formatCertificateDate(job.serviceOrder?.receivedAt),
      intakeCondition: job.serviceOrder?.intakeCondition ?? null,
      accessories: job.serviceOrder?.accessories ?? null,
    },
    /** §7.8.2.1(n) — printed only when the technician recorded something. */
    methodDeviations: job.methodDeviations?.trim() || null,
    /**
     * §7.8.4.1(c) — see buildTraceabilityStatement. NOT `traceability`: that
     * key is already an alias for the normalized standards array further down.
     */
    traceabilityStatement: buildTraceabilityStatement(job),
    graphics: {
      eccentricityIndicator: null,
      eccentricityIndicatorPosition:
        job.assetSnapshot?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY] ??
        job.data?.[ECCENTRICITY_INDICATOR_SPEC_KEY],
    },
    environment: {
      temperature: job.environmentalSnapshot?.temperature,
      temperatureText: formatMeasuredValue(
        job.environmentalSnapshot?.temperature,
        "ºC",
      ),
      relativeHumidity: job.environmentalSnapshot?.humidity,
      relativeHumidityText: formatMeasuredValue(
        job.environmentalSnapshot?.humidity,
        "%",
      ),
      pressure: job.environmentalSnapshot?.pressure,
      pressureText: formatMeasuredValue(
        job.environmentalSnapshot?.pressure,
        "hPa",
      ),
      recordedAt: job.environmentalSnapshot?.recordedAt,
      recordedBy: job.environmentalSnapshot?.recordedBy,
      withinLimits: job.environmentalSnapshot?.withinLimits,
      outOfLimitsJustification:
        job.environmentalSnapshot?.outOfLimitsJustification,
    },
    standards,
    traceability: standards,
    certifiedValues: normalizeCertifiedValues(standards),
    resultRows,
    calibrationResults,
    uncertainty: {
      expanded: expandedUncertainty,
      coverageFactor,
      budget: uncertaintyBudget,
    },
    uncertaintyBudget,
    massCompositions: normalizeMassCompositions(job),
    calibrationPhase: job.calibrationPhaseSnapshot,
    approval: {
      approvedBy: {
        name: job.approverName,
      },
      signatureUrl: job.approverSignatureUrl,
    },
    results: job.results,
    resultsDisplay: normalizeMethodResultsDisplay(job),
    data: job.data,
    dataDisplay: normalizeMethodDataDisplay(job),
  };
}

export function certificateImageContextFromJob(
  job: CertificateJobData,
): CertificateImageContext {
  return {
    dataFields: job.methodSnapshot?.dataFields,
    specifications: job.assetSnapshot?.specifications ?? null,
    data: job.data,
  };
}
