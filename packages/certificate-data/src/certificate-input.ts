/**
 * The frozen input of a certificate (ISO/IEC 17025 §7.8: the report reflects
 * the approved record).
 *
 * At approval the API assembles everything the renderer needs into ONE
 * document, hashes it and stores it next to the job (`certificate_input`). The
 * worker renders from that document only, so a lab, signatory, customer,
 * asset or standard edited after the approval — or a re-render years later —
 * cannot change what the certificate says.
 *
 * Two pure steps, shared by the API (frozen path) and the worker (legacy path
 * for jobs approved before the document existed):
 *
 *   1. `assembleCertificateJobData` — the flat, already-read rows to the
 *      `CertificateJobData` the layout consumes. This is the worker's old
 *      live-read assembly with the SQL taken out of it.
 *   2. `buildCertificateInput` — that data plus the decisions that must not be
 *      re-taken at render time (the accreditation seal as of `approved_at`, the
 *      verification URL, the layout and engine identity), normalised to JSON.
 *
 * Nothing here reads the clock, the environment or a database, except
 * `certificateVerificationUrl` (deployment config) which the builder calls once,
 * at approval, and stores.
 */

import { createHash } from "node:crypto";
import {
  decideAccreditationSeal,
  type AccreditationSealWithheldReason,
} from "@calibra-facil/shared";
import { certificateVerificationUrl } from "@calibra-facil/shared/public-urls";
import {
  evaluateTraceability,
  type FrozenCalibratingBody,
  type FrozenSignatory,
} from "./frozen-content.js";
import type {
  AssetSnapshot,
  CalibrationLocationSnapshot,
  CalibrationPhaseSnapshot,
  CertificateJobData,
  CustomerAddress,
  EnvironmentalSnapshot,
  MethodSnapshot,
  StandardSnapshot,
} from "./certificate-data.js";

/**
 * Identifies the layout that produces a certificate. Frozen with the input and
 * stored on every issued snapshot so a re-render years later can be told apart
 * from tampering.
 *
 * Bump CERTIFICATE_LAYOUT_VERSION whenever the rendered output changes in a way
 * an auditor could see. It is not the package version: the layout can change
 * while nothing else does, and only the layout affects the bytes.
 */
export const CERTIFICATE_LAYOUT_KEY = "calibration-certificate-fixed";
export const CERTIFICATE_LAYOUT_VERSION = "1.1.0";

/**
 * Which statement rules a frozen input is rendered under. 1.0.0 inputs predate
 * roadmap 2 C1/C2 and must re-render byte-identically, so they keep the
 * statements they were issued with ("legacy": traceability from the free-text
 * `calibratedBy`, the fixed coverage sentence, the lab profile's title for the
 * signatory, no calibrating body). From 1.1.0 the statements are built from the
 * decisions frozen with the input ("current").
 */
export type CertificateContentRules = "legacy" | "current";

export function certificateContentRulesFor(
  layoutVersion: string | null | undefined,
): CertificateContentRules {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(layoutVersion ?? "");
  if (!match) return "legacy";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 1) ? "current" : "legacy";
}

/** Bump when the shape of `CertificateInput` changes. */
export const CERTIFICATE_INPUT_SCHEMA_VERSION = 1;

// ── the document ────────────────────────────────────────────────────────────

/**
 * The accredited-scope (CMC) evaluation of the job as approved
 * (`calibration_job.scope_compliance_*`, frozen at approval): the status and the
 * findings. Null where no evaluation was made (the lab or the method is not
 * eligible for the seal, so the guard did not run).
 */
export type FrozenScopeEvaluation = {
  status: string;
  findings: ReadonlyArray<{ kind: string; message?: string }> | null;
};

export type CertificateInput = {
  schemaVersion: typeof CERTIFICATE_INPUT_SCHEMA_VERSION;
  /** The layout (and its revision) this input was frozen for. */
  layout: { key: string; version: string };
  /** Engine that produced the frozen results, as recorded on the method snapshot. */
  engineVersion: string | null;
  /** Public verification link printed on (and encoded in the QR of) the certificate. */
  verificationUrl: string;
  /**
   * The accreditation-seal decision taken at approval (Q42). It is a decision,
   * not a computation to repeat: the vigência window is evaluated at
   * `evaluatedAt` (= `approved_at`), never at the clock of whoever renders, and
   * the scope (CMC) verdict it rests on is frozen alongside it.
   *
   * `withheldReason` and `scopeEvaluation` are absent on inputs frozen before
   * Q42 (their `accredited` was decided without the scope verdict); every input
   * built now writes both. Verification and the portal read `accredited` from
   * here and never re-decide it from the lab's live fields.
   */
  seal: {
    accredited: boolean;
    evaluatedAt: string;
    /** Why the seal was withheld; null when it was applied. */
    withheldReason?: AccreditationSealWithheldReason | null;
    /** The scope evaluation the decision rests on; null = none was made. */
    scopeEvaluation?: FrozenScopeEvaluation | null;
  };
  /**
   * Lab identity and accreditation, signatory, customer, asset, method,
   * standards, environment, execution data and results. JSON-safe: instants
   * are ISO strings.
   */
  job: CertificateJobData;
};

// ── step 1: rows → CertificateJobData ───────────────────────────────────────

/**
 * What `assembleCertificateJobData` needs, already read. Both loaders (the
 * API's drizzle reads at approval, the worker's SQL for legacy jobs) produce
 * this shape, so the mapping lives in one place.
 */
export type CertificateJobSource = {
  /** The certificate number (`calibration_job.job_id`). */
  jobId: string;
  verificationToken: string;
  certificateName: string | null;
  organizationId: string;
  organizationSlug: string | null;
  unitId: number | null;
  performedAt: Date | string | null;
  approvedAt: Date | string | null;
  methodSnapshot: MethodSnapshot;
  /** The method's CURRENT `accredited_scope`, the fallback for old snapshots. */
  methodAccreditedScopeCurrent: boolean | null;
  assetSnapshot: AssetSnapshot | null;
  standardsSnapshot: StandardSnapshot[] | null;
  environmentalSnapshot: EnvironmentalSnapshot | null;
  calibrationLocationSnapshot: CalibrationLocationSnapshot | null;
  calibrationPhaseSnapshot: CalibrationPhaseSnapshot | null;
  data: Record<string, unknown> | null;
  results: Record<string, unknown> | null;
  scopeOverrideJustification: string | null;
  methodDeviations: string | null;
  supersedesId: number | null;
  supersededById: number | null;
  amendmentNumber: number | null;
  amendmentReason: string | null;
  lab: {
    name: string | null;
    cnpj: string | null;
    accreditationNumber: string | null;
    accreditationBody: string | null;
    accreditationActive: boolean | null;
    accreditationValidFrom: Date | string | null;
    accreditationValidUntil: Date | string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    neighbourhood: string | null;
    city: string | null;
    state: string | null;
    cep: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    /** Already resolved: a self-contained data URI, or the stored reference when no object backs it. */
    logo: string | null;
    technicalManagerName: string | null;
    technicalManagerTitle: string | null;
  };
  customer: {
    name: string;
    taxId: string | null;
    phone: string | null;
    email: string | null;
    address: CustomerAddress | null;
  };
  asset: {
    name: string;
    serialNumber: string;
    tag: string;
    model: string | null;
    manufacturer: string | null;
  };
  approver: {
    name: string | null;
    /** The drawn signature as a data URI, when the approver has one. */
    signatureDataUrl: string | null;
  };
  /**
   * C1: the approver's authorized-signatory record, resolved at approval;
   * null = the approver has none (the gate was not enforced for the org).
   * Left undefined by the legacy worker read, which predates it.
   */
  signatory?: FrozenSignatory | null;
  /** C2: the calibrating body, resolved at approval. */
  calibratingBody?: FrozenCalibratingBody;
  /** The certificate this job amends. */
  original: { jobId: string; approvedAt: Date | string | null } | null;
  /** The service order the job is linked to (latest link), §7.8.2.1(g)/(h). */
  serviceOrder: {
    inmetroRepairMarkNumber: string | null;
    receivedAt: Date | string | null;
    intakeCondition: string | null;
    accessories: string | null;
  } | null;
};

/** The worker's former live-read assembly, without the reads. */
export function assembleCertificateJobData(
  source: CertificateJobSource,
): CertificateJobData {
  const { lab } = source;
  return {
    jobId: source.jobId,
    verificationToken: source.verificationToken,
    certificateName: source.certificateName,
    organizationId: source.organizationId,
    organizationSlug: source.organizationSlug,
    unitId: source.unitId,
    performedAt: source.performedAt,
    approvedAt: source.approvedAt,
    lab: {
      name: lab.name || "Laboratório de Calibração",
      cnpj: lab.cnpj,
      accreditationNumber: lab.accreditationNumber,
      accreditationBody: lab.accreditationBody,
      accreditationActive: lab.accreditationActive,
      accreditationValidFrom: lab.accreditationValidFrom,
      accreditationValidUntil: lab.accreditationValidUntil,
      street: lab.street,
      number: lab.number,
      complement: lab.complement,
      neighbourhood: lab.neighbourhood,
      city: lab.city,
      state: lab.state,
      cep: lab.cep,
      phone: lab.phone,
      email: lab.email,
      website: lab.website,
      logo: lab.logo,
      technicalManagerName: lab.technicalManagerName,
      technicalManagerTitle: lab.technicalManagerTitle,
    },
    customer: {
      name: source.customer.name,
      taxId: source.customer.taxId,
      phone: source.customer.phone,
      email: source.customer.email,
      address: source.customer.address,
    },
    asset: {
      name: source.asset.name,
      serialNumber: source.asset.serialNumber,
      tag: source.asset.tag,
      model: source.asset.model,
      manufacturer: source.asset.manufacturer,
    },
    // Legacy and offline snapshots may predate the accredited-scope flag; fall
    // back to the method's current flag so older jobs still seal correctly.
    methodSnapshot: {
      ...source.methodSnapshot,
      accreditedScope:
        source.methodSnapshot.accreditedScope ??
        source.methodAccreditedScopeCurrent ??
        false,
    },
    assetSnapshot: source.assetSnapshot,
    scopeOverrideJustification: source.scopeOverrideJustification,
    standardsSnapshot: source.standardsSnapshot,
    methodDeviations: source.methodDeviations,
    serviceOrder: {
      inmetroRepairMarkNumber:
        source.serviceOrder?.inmetroRepairMarkNumber ?? null,
      receivedAt: source.serviceOrder?.receivedAt ?? null,
      intakeCondition: source.serviceOrder?.intakeCondition ?? null,
      accessories: source.serviceOrder?.accessories ?? null,
    },
    environmentalSnapshot: source.environmentalSnapshot,
    calibrationLocationSnapshot: source.calibrationLocationSnapshot,
    calibrationPhaseSnapshot: source.calibrationPhaseSnapshot,
    data: source.data,
    results: source.results,
    approverName: source.approver.name,
    approverSignatureUrl: source.approver.signatureDataUrl,
    ...(source.signatory !== undefined ? { signatory: source.signatory } : {}),
    ...(source.calibratingBody
      ? { calibratingBody: source.calibratingBody }
      : {}),
    supersedesId: source.supersedesId,
    supersededById: source.supersededById,
    amendmentNumber: source.amendmentNumber,
    amendmentReason: source.amendmentReason,
    originalJobId: source.original?.jobId ?? null,
    originalApprovedAt: source.original?.approvedAt ?? null,
  };
}

// ── step 2: CertificateJobData → the frozen document ────────────────────────

function toInstant(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Freezes the data the renderer reads. The seal is decided here, as of the
 * approval instant and from the scope evaluation frozen on the job. Throws when the job has no approval instant: a certificate
 * input is only ever built for an approved job.
 */
export function buildCertificateInput(
  job: CertificateJobData,
  /** The scope evaluation frozen on the job at approval; null when none was made. */
  scopeEvaluation: FrozenScopeEvaluation | null,
): CertificateInput {
  const approvedAt = toInstant(job.approvedAt);
  if (!approvedAt) {
    throw new Error("A certificate input needs the job's approval instant");
  }

  const seal = decideAccreditationSeal({
    lab: job.lab,
    methodAccreditedScope: job.methodSnapshot?.accreditedScope,
    scopeOverrideJustification: job.scopeOverrideJustification,
    scopeEvaluation,
    atDate: approvedAt,
  });

  // C2: SI traceability is decided here, from the standards snapshot as of the
  // approval instant, and frozen: a re-render never re-decides it.
  const frozenJob: CertificateJobData = {
    ...job,
    traceability: evaluateTraceability({
      standards: job.standardsSnapshot,
      performedAt: job.performedAt,
      evaluatedAt: approvedAt,
    }),
  };

  const input: CertificateInput = {
    schemaVersion: CERTIFICATE_INPUT_SCHEMA_VERSION,
    layout: {
      key: CERTIFICATE_LAYOUT_KEY,
      version: CERTIFICATE_LAYOUT_VERSION,
    },
    engineVersion: job.methodSnapshot?.engineVersion ?? null,
    verificationUrl: certificateVerificationUrl(job.verificationToken),
    seal: {
      accredited: seal.accredited,
      evaluatedAt: approvedAt.toISOString(),
      withheldReason: seal.withheldReason,
      scopeEvaluation,
    },
    job: frozenJob,
  };
  return normalizeCertificateInput(input);
}

/**
 * What a database round trip would do to the document: instants become ISO
 * strings and `undefined` disappears. Building and re-reading the document
 * therefore yield the same value, and so the same hash.
 */
function normalizeCertificateInput(input: CertificateInput): CertificateInput {
  const parsed: CertificateInput = JSON.parse(JSON.stringify(input));
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Shape check for a document read back from storage. The nested snapshots are
 * the job's own jsonb columns and are not re-validated here: integrity of the
 * whole document is the sha256 comparison (`certificateInputSha256`).
 */
export function isCertificateInput(value: unknown): value is CertificateInput {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== CERTIFICATE_INPUT_SCHEMA_VERSION) return false;
  const { layout, seal, job } = value;
  return (
    isRecord(layout) &&
    typeof layout.key === "string" &&
    typeof layout.version === "string" &&
    typeof value.verificationUrl === "string" &&
    isRecord(seal) &&
    typeof seal.accredited === "boolean" &&
    typeof seal.evaluatedAt === "string" &&
    isRecord(job) &&
    typeof job.jobId === "string" &&
    typeof job.verificationToken === "string" &&
    isRecord(job.lab) &&
    isRecord(job.customer) &&
    isRecord(job.asset) &&
    isRecord(job.methodSnapshot)
  );
}

// ── canonical form and hash ─────────────────────────────────────────────────

/**
 * JSON with object keys in code-unit order. jsonb does not keep key order, so
 * the hash cannot depend on it: this is the serialisation both the writer and
 * the reader hash.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  // What `JSON.stringify` makes of an instant, so a document hashed before and
  // after serialisation is the same document.
  if (value instanceof Date) return JSON.stringify(value);
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .flatMap((key) => {
        const item = value[key];
        return item === undefined
          ? []
          : [`${JSON.stringify(key)}:${canonicalJson(item)}`];
      });
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function certificateInputSha256(input: CertificateInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

// ── images ──────────────────────────────────────────────────────────────────

/** Sniffs the content type of an image whose stored metadata has none. */
export function inferImageContentType(bytes: Uint8Array): string {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  const textStart = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 256))
    .trimStart();
  if (textStart.startsWith("<svg") || textStart.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

/** A self-contained `data:` URI for an image object. */
export function imageDataUrl(
  bytes: Uint8Array,
  contentType: string | null | undefined,
): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return `data:${contentType || inferImageContentType(bytes)};base64,${btoa(binary)}`;
}
