/**
 * The typed prop for the fixed calibration certificate.
 *
 * Deliberately a flat, already-formatted view — no DB rows, no `unknown`
 * bags. `buildCertificateData` (@calibra-facil/certificate-data) produces the
 * domain projection; a thin adapter maps it onto this shape. Keeping the two
 * apart means the layout can be designed and reviewed against fixtures with no
 * database, and the projection can change shape without dragging the layout
 * with it.
 *
 * Every value here is print-ready. The component formats nothing numeric: the
 * rounding rule (NIT-DICLA-021 A.6.3 — U at no more than two significant
 * figures, the measured value rounded to U's last significant digit) is a
 * metrology decision, not a presentation one, so it happens upstream.
 */

export type CertificateLabIdentity = {
  name: string;
  cnpj?: string | null;
  addressText?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** Data URI. The HTML sent to Gotenberg must be self-contained. */
  logoDataUrl?: string | null;
  /** Digits only; the seal and the §11.5.2 sentence format it as "CAL 9999". */
  accreditationNumber?: string | null;
};

export type CertificateCustomer = {
  name: string;
  taxId?: string | null;
  addressText?: string | null;
};

export type CertificateItem = {
  description: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  tag?: string | null;
  /** Registro Inmetro, for instruments under legal-metrology control. */
  inmetroRegistration?: string | null;
  capacityText?: string | null;
  divisionText?: string | null;
  /** §7.8.2.1(g) — condition on receipt. Null when there was no receipt. */
  conditionOnReceipt?: string | null;
  accessories?: string | null;
};

export type CertificateDates = {
  /** §7.8.2.1(h). Null for in-loco work or an item handed straight over. */
  receivedAtText?: string | null;
  /** §7.8.2.1(i). */
  performedAtText: string;
  /** §7.8.2.1(j) — always printed, even when equal to the calibration date. */
  issuedAtText: string;
};

export type CertificateMethod = {
  name: string;
  version?: number | null;
  procedureCode?: string | null;
  referenceStandards?: string[];
};

export type CertificateEnvironment = {
  temperatureText?: string | null;
  humidityText?: string | null;
  pressureText?: string | null;
  withinLimits?: boolean;
  outOfLimitsJustification?: string | null;
};

/** One row of the results table. All values already formatted as strings. */
export type CertificateResultRow = {
  /** Nominal / applied reference value, e.g. "500 kg". */
  point: string;
  /** Conventional true value (VVC) when the quantity has one. */
  referenceValue?: string | null;
  /** Mean indication. */
  indication?: string | null;
  /** Error of indication — the one column every quantity has. */
  error?: string | null;
  /**
   * Expanded uncertainty. NEVER prefixed with ±: NIT-DICLA-021 A.6.1 Nota 1
   * forbids the sign when values and uncertainties are presented in a table.
   */
  expandedUncertainty?: string | null;
  coverageFactor?: string | null;
  /** Effective degrees of freedom; "∞" when the Type-A term is zero. */
  effectiveDegreesOfFreedom?: string | null;
};

export type CertificateResultTable = {
  /** e.g. "Resultados antes do ajuste" / "após o ajuste" (§7.8.4.1 d). */
  title: string;
  /** Column unit, factored into the header as the real certificates do. */
  unit?: string | null;
  note?: string | null;
  rows: CertificateResultRow[];
};

/**
 * Mass-specific blocks (§7.8.4.1 d covers as-found/as-left; these two are the
 * method's own additional determinations). Only the mass methods produce
 * them — every other quantity in the catalogue leaves both undefined and the
 * sections simply do not render.
 */
export type CertificateRepeatability = {
  unit?: string | null;
  /** One row per phase, e.g. "Antes do ajuste" / "Depois do ajuste". */
  rows: Array<{
    phase: string;
    readings: string[];
    /** Dispersion for the phase. */
    value?: string | null;
  }>;
  note?: string | null;
};

export type CertificateEccentricity = {
  unit?: string | null;
  /** Load positions A–E (circular platform) or 1–4 (road scale). */
  rows: Array<{
    position: string;
    before?: string | null;
    after?: string | null;
  }>;
  /** Largest deviation, the figure that feeds the uncertainty budget. */
  maxDeviationText?: string | null;
  /**
   * Raw SVG from `renderEccentricityIndicatorSvgMarkup`
   * (@calibra-facil/certificate-data) — the platform diagram with the
   * indicator position marked. Injected verbatim; it is our own markup, not
   * user input. Null when the method declares no indicator.
   */
  indicatorSvg?: string | null;
  note?: string | null;
};

export type CertificateStandard = {
  name: string;
  certificateNumber: string;
  /** The calibrating body. Null when unknown — never guessed. */
  issuer?: string | null;
  validUntilText?: string | null;
};

/** §7.8.6.2 — only rendered when the method actually declares all of it. */
export type CertificateConformity = {
  /** (a) which results the statement applies to. */
  appliesTo: string;
  /** (b) which specification is met or not. */
  specification: string;
  /** (c) the decision rule applied. */
  decisionRule: string;
  verdict: string;
};

export type CertificateSignatory = {
  name: string;
  role?: string | null;
  /** Place and date line, e.g. "Canoas/RS, 25 de junho de 2026". */
  placeAndDateText?: string | null;
  /**
   * The signatory's handwritten signature, as a data URI.
   *
   * The layout first shipped without this on the reasoning that the German and
   * French certificates authorise by name alone and the file itself carries a
   * PAdES signature. That reasoning does not survive contact with the Brazilian
   * convention: the RBC certificate surveyed, and a pilot lab's legacy document,
   * both show a handwritten signature above the rule, and laboratories expect
   * it. Null when the signatory has not uploaded one — the name and role below
   * the rule still authorise the document on their own.
   */
  signatureImageDataUrl?: string | null;
};

export type CalibrationCertificateData = {
  certificateNumber: string;
  /** Data URI for the verification QR. */
  qrCodeDataUrl?: string | null;
  verificationUrl?: string | null;

  lab: CertificateLabIdentity;
  customer: CertificateCustomer;
  item: CertificateItem;
  dates: CertificateDates;
  method: CertificateMethod;
  locationText?: string | null;
  environment?: CertificateEnvironment | null;

  /** Whether the accreditation symbol may be shown at all. */
  accredited: boolean;

  resultTables: CertificateResultTable[];
  repeatability?: CertificateRepeatability | null;
  eccentricity?: CertificateEccentricity | null;
  /** The canonical uncertainty sentence (NIT-DICLA-021 A.6.1.1 / A.6.2). */
  uncertaintyStatement: string;

  standards: CertificateStandard[];
  /** §7.8.4.1(c). Null when no standard names its calibrating body. */
  traceabilityStatementText?: string | null;

  /** §7.8.2.1(n). Null when the method was followed without deviation. */
  methodDeviations?: string | null;
  conformity?: CertificateConformity | null;
  observations?: string | null;

  /** §7.8.8 — replacement certificate. */
  supersedesText?: string | null;

  signatory: CertificateSignatory;

  /** Engine provenance, printed small at the foot for auditability. */
  provenance?: {
    engineVersion?: string | null;
    methodFingerprint?: string | null;
    resultFingerprint?: string | null;
  } | null;
};
