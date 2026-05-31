import type { Browser, Page } from "puppeteer-core";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { renderToString } from "react-dom/server";
import {
  LabelHtml,
  type LabelData,
  ServiceOrderDeliveryReceiptHtml,
  ServiceOrderIntakeDocumentHtml,
  ServiceOrderQuoteHtml,
  ServiceOrderTagHtml,
  type ServiceOrderDeliveryReceiptData,
  type ServiceOrderDocumentData,
  type ServiceOrderQuoteData,
  type ServiceOrderTagData,
} from "@calibra-facil/documents";
import React from "react";
import QRCode from "qrcode";
import { Resvg } from "@resvg/resvg-js";
import {
  ExcelTsCertificateWorkbookEngine,
  GotenbergXlsxToPdfConverter,
  LocalLibreOfficeXlsxToPdfConverter,
  validateCertificateXlsxBindingManifest,
  type CertificateXlsxBindingManifest,
  type ImageCellBinding,
  type WorkbookImage,
  type XlsxToPdfConverter,
  type WorkbookWarning,
} from "@calibra-facil/certificate-xlsx-template";
import { processScheduledNotifications } from "./scheduled.js";
import {
  signPdf,
  decryptPassword,
  decryptBinary,
  type SignatureMetadata,
} from "@calibra-facil/signing";
import {
  processIntegrationSync,
  processScheduledIntegrationSyncs,
  type IntegrationSyncQueueMessage,
} from "./integrations.js";
import {
  type BackgroundJobMessage,
  type CertificateXlsxPreviewBackgroundJobMessage,
  type DocumentBackgroundJobMessage,
} from "@calibra-facil/shared";
import {
  convertMassValue,
  isMassMeasurementUnit,
  type MassUnit,
} from "@calibra-facil/shared/mass-units";
import {
  getLogoKeyFromUrl,
  getYear,
  getYearMonth,
  issuedCertificatePdfKey,
  issuedCertificateXlsxKey,
  jobLabelKey,
  serviceOrderDocKey,
  templatePreviewKey,
  type OrgRef,
  type StorageBucket,
} from "@calibra-facil/shared/storage-keys";
import { notifyCertificateReady } from "@calibra-facil/notifications";

export interface R2BucketBinding {
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  put(
    key: string,
    body: Buffer | Uint8Array | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
}

export interface Env {
  CERTIFICATES_BUCKET: R2BucketBinding;
  MEDIA_BUCKET: R2BucketBinding;
  RUNTIME_ASSETS_BUCKET?: {
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  };
  DATABASE_URL: string;
  CHROME_EXECUTABLE_PATH?: string;
  CHROMIUM_PACK_R2_KEY?: string;
  CHROMIUM_PACK_URL?: string;
  GOTENBERG_URL?: string;
  SIGNING_MASTER_KEY?: string; // Optional - if not set, PDFs won't be signed
  INTEGRATIONS_MASTER_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
}

type CustomerAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
};

type MethodInputField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "table";
  unit?: string;
  required?: boolean;
  options?: string[];
  defaultValue?: string | number;
  source?: "manual" | "asset_spec";
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

type MethodFormulaReporting = {
  includeInCertificate?: boolean;
  role?:
    | "primary_result"
    | "expanded_uncertainty"
    | "coverage_factor"
    | "conformity_margin"
    | "uncertainty_component"
    | "auxiliary";
  group?: "calibration_result" | "uncertainty_budget" | "raw_calculation";
};

type MethodFormula = {
  outputKey: string;
  expression: string;
  label?: string;
  unit?: string;
  reporting?: MethodFormulaReporting;
};

type MethodCertificateContent = {
  procedureCode?: string;
  referenceStandards?: string[];
  certifiedValuesDisplay?: "full" | "hidden";
  massCompositionDisplay?: "full" | "hidden";
  uncertaintyBudgetDisplay?: "full" | "hidden";
};

type MethodSnapshot = {
  methodId: number;
  methodName: string;
  methodVersion: number;
  dataFields?: MethodInputField[];
  formulas?: MethodFormula[];
  certificateContent?: MethodCertificateContent | null;
};

type CertifiedValue = {
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

type StandardSnapshot = {
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

type EnvironmentalSnapshot = {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  recordedAt: string;
  recordedBy: string;
  limits: Record<string, unknown> | null;
  withinLimits: boolean;
  outOfLimitsJustification: string | null;
};

type CalibrationLocationSnapshot = {
  type: "customer_site" | "lab" | "other";
  addressText: string;
  notes?: string | null;
  recordedAt?: string;
  recordedBy?: string;
};

type CalibrationPhaseSnapshot = {
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

type AssetSnapshot = {
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

type JobData = {
  jobId: string;
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
  standardsSnapshot: StandardSnapshot[] | null;
  serviceOrder?: {
    inmetroRepairSealNumber?: string | null;
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

const CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE =
  "Certificate generation requires a published XLSX certificate template assignment";

function createXlsxToPdfConverter(env: Env): XlsxToPdfConverter {
  if (env.GOTENBERG_URL) {
    return new GotenbergXlsxToPdfConverter(env.GOTENBERG_URL);
  }

  return new LocalLibreOfficeXlsxToPdfConverter();
}

export type QueueMessage = BackgroundJobMessage;

export interface MessageBatch<T> {
  messages: {
    body: T;
    ack: () => void;
    retry: () => void;
  }[];
}

type Dateish = Date | string | null | undefined;

/** Pick the concrete R2 binding for a logical storage bucket. */
function bucketBinding(env: Env, bucket: StorageBucket): R2BucketBinding {
  return bucket === "media" ? env.MEDIA_BUCKET : env.CERTIFICATES_BUCKET;
}

/**
 * Read an object whose key is stored in the DB. The stored key tells us the key
 * but not which bucket the object physically lives in: during/after the bucket
 * split, newly written objects live in `preferred` while not-yet-backfilled
 * ones may still be in the other bucket. Try the preferred binding, then fall
 * back to the other so reads keep working across the migration window.
 */
async function getStoredObject(
  env: Env,
  preferred: StorageBucket,
  key: string,
) {
  const primary = await bucketBinding(env, preferred).get(key);
  if (primary) return primary;
  const fallback: StorageBucket = preferred === "media" ? "documents" : "media";
  return bucketBinding(env, fallback).get(key);
}

/** Look up the stable org id + readable slug for org-scoped key building. */
async function fetchOrgRefById(
  client: Client,
  organizationId: string,
): Promise<OrgRef> {
  const result = await client.query<{ id: string; slug: string | null }>(
    `SELECT id, slug FROM organization WHERE id = $1`,
    [organizationId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Organization not found: ${organizationId}`);
  }
  return { id: row.id, slug: row.slug ?? "" };
}

function sha256Hex(bytes: Uint8Array | ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

type EccentricityIndicatorVariant = "circular_platform" | "road_scale";
type EccentricityIndicatorPosition =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "1"
  | "2"
  | "3"
  | "4";

const ECCENTRICITY_INDICATOR_SPEC_KEY = "eccentricityIndicatorPosition";
const CIRCULAR_ECCENTRICITY_INDICATOR_POSITIONS = new Set([
  "top",
  "right",
  "bottom",
  "left",
]);
const ROAD_SCALE_ECCENTRICITY_INDICATOR_POSITIONS = new Set([
  "1",
  "2",
  "3",
  "4",
]);
const CIRCULAR_ECCENTRICITY_LOAD_POINTS = ["A", "B", "C", "D", "E"];
const ECCENTRICITY_INDICATOR_FONT_FAMILY =
  "Carlito, Calibri, Aptos, sans-serif";

function prepareXlsxWorkbookForRender(input: Uint8Array): Uint8Array {
  return input;
}

async function fillXlsxWorkbookFromManifest(
  engine: ExcelTsCertificateWorkbookEngine,
  source: Uint8Array,
  manifest: CertificateXlsxBindingManifest,
  data: Record<string, unknown>,
  job?: JobData,
): Promise<{ workbook: Uint8Array; warnings: WorkbookWarning[] }> {
  const scalarResult = await engine.fillScalarsWithWarnings(
    source,
    manifest.scalarBindings,
    data,
  );
  let workbook = scalarResult.workbook;
  const warnings = [...scalarResult.warnings];

  for (const tableBinding of manifest.tableBindings) {
    const tableResult = await engine.fillTableRows(
      workbook,
      tableBinding,
      data,
    );
    workbook = tableResult.workbook;
    warnings.push(...tableResult.warnings);
  }

  const images = await resolveXlsxImageBindings(
    manifest.imageBindings,
    data,
    job,
  );
  if (manifest.imageBindings.length > 0) {
    workbook = await engine.insertImages(
      workbook,
      manifest.imageBindings,
      images,
    );
  }

  return { workbook, warnings };
}

async function resolveXlsxImageBindings(
  bindings: CertificateXlsxBindingManifest["imageBindings"],
  data: Record<string, unknown>,
  job?: JobData,
): Promise<Record<string, WorkbookImage>> {
  const images: Record<string, WorkbookImage> = {};

  for (const binding of bindings) {
    const image = await resolveXlsxImageBinding(binding, data, job);
    if (image) {
      images[binding.sourcePath] = image;
      images[binding.id] = image;
    }
  }

  return images;
}

async function resolveXlsxImageBinding(
  binding: ImageCellBinding,
  data: Record<string, unknown>,
  job?: JobData,
): Promise<WorkbookImage | null> {
  if (binding.imageKind === "qr_code") {
    const value = getPathValue(data, binding.sourcePath);
    return typeof value === "string" && value.trim()
      ? new Uint8Array(
          await QRCode.toBuffer(value, {
            type: "png",
            errorCorrectionLevel: "M",
            margin: 1,
            width: 440,
          }),
        )
      : null;
  }

  if (binding.imageKind === "signature") {
    const value = getPathValue(data, binding.sourcePath);
    return typeof value === "string" ? workbookImageFromDataUrl(value) : null;
  }

  if (
    binding.imageKind === "organization_logo" ||
    binding.imageKind === "accreditation_seal"
  ) {
    const value = getPathValue(data, binding.sourcePath);
    return typeof value === "string" ? workbookImageFromDataUrl(value) : null;
  }

  if (binding.imageKind === "eccentricity_indicator") {
    return renderEccentricityIndicatorPng(job, data);
  }

  return null;
}

function workbookImageFromDataUrl(value: string): WorkbookImage | null {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("data:")) {
    return null;
  }

  const commaIndex = trimmed.indexOf(",");
  if (commaIndex === -1) return null;

  const metadata = trimmed.slice("data:".length, commaIndex).split(";");
  const contentType = metadata[0]?.toLowerCase();
  const payload = trimmed.slice(commaIndex + 1);
  if (!contentType || !payload) return null;

  if (!contentType.startsWith("image/")) {
    return null;
  }

  const isBase64 = metadata
    .slice(1)
    .some((item) => item.toLowerCase() === "base64");
  const bytes = isBase64
    ? new Uint8Array(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));

  if (contentType === "image/svg+xml") {
    try {
      const svg = new TextDecoder().decode(bytes);
      return {
        bytes: new Resvg(svg).render().asPng(),
        contentType: "image/png",
        extension: "png",
      };
    } catch {
      return null;
    }
  }

  if (contentType === "image/png") {
    return { bytes, contentType: "image/png", extension: "png" };
  }

  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return { bytes, contentType: "image/jpeg", extension: "jpeg" };
  }

  if (contentType === "image/webp") {
    return { bytes, contentType: "image/webp", extension: "webp" };
  }

  if (contentType === "image/gif") {
    return { bytes, contentType: "image/gif", extension: "gif" };
  }

  return null;
}

function parseSignatureMetadata(value: unknown): SignatureMetadata | undefined {
  if (value == null) return undefined;

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parseSignatureMetadata(parsed);
    } catch {
      return undefined;
    }
  }

  const metadata = recordFromUnknown(value);
  const signedAt = metadata.signedAt;
  const signerCertificateSerial = metadata.signerCertificateSerial;
  const signerName = metadata.signerName;
  const signerCpfCnpj = metadata.signerCpfCnpj;
  const pdfHash = metadata.pdfHash;
  const ltvEnabled = metadata.ltvEnabled;
  if (
    typeof signedAt !== "string" ||
    typeof signerCertificateSerial !== "string" ||
    typeof signerName !== "string" ||
    (signerCpfCnpj !== null && typeof signerCpfCnpj !== "string") ||
    typeof pdfHash !== "string" ||
    typeof ltvEnabled !== "boolean"
  ) {
    return undefined;
  }

  return {
    signedAt,
    signerCertificateSerial,
    signerName,
    signerCpfCnpj,
    pdfHash,
    ltvEnabled,
  };
}

function renderEccentricityIndicatorPng(
  job: JobData | undefined,
  data: Record<string, unknown>,
): Uint8Array {
  const variant = resolveEccentricityIndicatorVariant(job, data);
  const selectedPosition = resolveEccentricityIndicatorPosition(
    job,
    data,
    variant,
  );
  const loadPositions =
    variant === "circular_platform"
      ? resolveCircularEccentricityLoadPositions(job, data)
      : undefined;
  const svg = renderEccentricityIndicatorSvg({
    variant,
    selectedPosition,
    loadPositions,
  });
  const rendered = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 960,
    },
  }).render();

  return rendered.asPng();
}

function resolveEccentricityIndicatorVariant(
  job: JobData | undefined,
  data: Record<string, unknown>,
): EccentricityIndicatorVariant {
  const fields = job?.methodSnapshot?.dataFields ?? [];
  const configuredField = fields.find(
    (field) => field.eccentricityIndicator?.enabled,
  );
  const value =
    configuredField?.eccentricityIndicator?.variant ??
    getPathValue(data, "graphics.eccentricityIndicatorVariant");

  return value === "road_scale" ? "road_scale" : "circular_platform";
}

function resolveEccentricityIndicatorPosition(
  job: JobData | undefined,
  data: Record<string, unknown>,
  variant: EccentricityIndicatorVariant,
): EccentricityIndicatorPosition | null {
  const value =
    job?.assetSnapshot?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY] ??
    job?.data?.[ECCENTRICITY_INDICATOR_SPEC_KEY] ??
    getPathValue(
      data,
      "assetSnapshot.specifications.eccentricityIndicatorPosition",
    ) ??
    getPathValue(data, "data.eccentricityIndicatorPosition") ??
    getPathValue(data, "graphics.eccentricityIndicatorPosition");
  return typeof value === "string" &&
    isEccentricityIndicatorPosition(value, variant)
    ? value
    : null;
}

function isEccentricityIndicatorPosition(
  value: string,
  variant: EccentricityIndicatorVariant,
): value is EccentricityIndicatorPosition {
  const allowed =
    variant === "road_scale"
      ? ROAD_SCALE_ECCENTRICITY_INDICATOR_POSITIONS
      : CIRCULAR_ECCENTRICITY_INDICATOR_POSITIONS;

  return allowed.has(value);
}

function resolveCircularEccentricityLoadPositions(
  job: JobData | undefined,
  data: Record<string, unknown>,
): string[] {
  const field = job?.methodSnapshot?.dataFields?.find(
    (item) => item.eccentricityIndicator?.enabled,
  );
  const configuredRows = field ? job?.data?.[field.key] : undefined;
  const rows =
    field && Array.isArray(configuredRows)
      ? configuredRows
      : getPathValue(data, "dataDisplay.excentricidade");

  if (!field?.columns || !Array.isArray(rows)) {
    return CIRCULAR_ECCENTRICITY_LOAD_POINTS;
  }

  const positionColumn = field.columns.find((column) => {
    const text = normalizeSearchText(`${column.key} ${column.label}`);
    return text.includes("posicao") || text.includes("ponto");
  });

  if (!positionColumn) {
    return CIRCULAR_ECCENTRICITY_LOAD_POINTS;
  }

  const positions: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const value = String(recordFromUnknown(row)[positionColumn.key] ?? "")
      .trim()
      .toUpperCase();
    if (
      CIRCULAR_ECCENTRICITY_LOAD_POINTS.includes(value) &&
      !positions.includes(value)
    ) {
      positions.push(value);
    }
  }

  return positions.length > 0 ? positions : CIRCULAR_ECCENTRICITY_LOAD_POINTS;
}

function renderEccentricityIndicatorSvg({
  variant,
  selectedPosition,
  loadPositions,
}: {
  variant: EccentricityIndicatorVariant;
  selectedPosition: EccentricityIndicatorPosition | null;
  loadPositions?: string[];
}) {
  return variant === "road_scale"
    ? renderRoadScaleEccentricitySvg(selectedPosition)
    : renderCircularEccentricitySvg(selectedPosition, loadPositions);
}

function renderCircularEccentricitySvg(
  selectedPosition: EccentricityIndicatorPosition | null,
  loadPositions = CIRCULAR_ECCENTRICITY_LOAD_POINTS,
) {
  const selectedFill = "#2563eb";
  const ink = "#111111";
  const fontFamily = ECCENTRICITY_INDICATOR_FONT_FAMILY;
  const marker = (
    position: EccentricityIndicatorPosition,
    x: number,
    y: number,
  ) => {
    const selected = selectedPosition === position;
    return `<g><rect x="${x}" y="${y}" width="16" height="16" fill="#ffffff" stroke="${ink}" stroke-width="1.3"/>${
      selected
        ? `<path d="M ${x + 3.5} ${y + 3.5} L ${x + 12.5} ${y + 12.5} M ${x + 12.5} ${y + 3.5} L ${x + 3.5} ${y + 12.5}" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"/>`
        : ""
    }</g>`;
  };
  const point = (label: string, x: number, y: number, anchor = "start") =>
    loadPositions.includes(label)
      ? `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${fontFamily}" font-size="16" font-weight="700" fill="${ink}">${label}</text>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="100" viewBox="0 0 170 100">
  <g transform="translate(44.5 4) scale(0.54)">
    <rect x="38" y="38" width="74" height="74" rx="37" fill="#ffffff" stroke="${ink}" stroke-width="1.5"/>
    <rect x="74.5" y="10" width="1" height="130" fill="${ink}"/>
    <rect x="10" y="74.5" width="130" height="1" fill="${ink}"/>
    <rect x="66" y="66" width="18" height="18" fill="#ffffff"/>
    ${point("A", 75, 80, "middle")}
    ${point("B", 54, 63)}
    ${point("C", 86, 63)}
    ${point("D", 86, 101)}
    ${point("E", 54, 101)}
    ${marker("top", 67, 0)}
    ${marker("right", 134, 67)}
    ${marker("bottom", 67, 134)}
    ${marker("left", 0, 67)}
  </g>
  <text x="85" y="95" text-anchor="middle" font-family="${fontFamily}" font-size="8.5" font-weight="600" fill="${ink}">Posição do indicador</text>
</svg>`;
}

function renderRoadScaleEccentricitySvg(
  selectedPosition: EccentricityIndicatorPosition | null,
) {
  const selectedFill = "#2563eb";
  const ink = "#111111";
  const fontFamily = ECCENTRICITY_INDICATOR_FONT_FAMILY;
  const sections = ["1", "2", "3", "4"]
    .map((section, index) => {
      const x = 12 + index * 42;
      const selected = selectedPosition === section;
      return `<rect x="${x}" y="58" width="42" height="34" fill="${selected ? selectedFill : "#ffffff"}" stroke="${ink}" stroke-width="1.5"/>
        <text x="${x + 21}" y="75" text-anchor="middle" dominant-baseline="central" font-family="${fontFamily}" font-size="14" font-weight="700" fill="${selected ? "#ffffff" : ink}">${section}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="100" viewBox="0 0 170 100">
  <g transform="translate(2 -35)">
    ${sections}
    <rect x="78" y="116" width="34" height="18" fill="#ffffff" stroke="${ink}" stroke-width="1.5"/>
  </g>
  <text x="85" y="97" text-anchor="middle" font-family="${fontFamily}" font-size="8.5" font-weight="600" fill="${ink}">Posição do indicador</text>
</svg>`;
}

function getPathValue(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number.parseInt(segment, 10)];
    }
    if (typeof current === "object") {
      return Reflect.get(current, segment);
    }
    return undefined;
  }, data);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeSvgText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchJobData(
  client: Client,
  jobId: number,
  env: Env,
): Promise<JobData | null> {
  const result = await client.query(
    `
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
      cj.certificate_template_id,
      cj.certificate_template_snapshot,
      cj.results,
      cj.data,
      cj.organization_id,
      cj.approved_by,
      -- Amendment fields - ISO 17025 Clause 7.8.4.1
      cj.supersedes_id,
      cj.superseded_by_id,
      cj.amendment_number,
      cj.amendment_reason,
      -- Organization (Lab) info
      o.name as lab_name,
      o.cnpj as lab_cnpj,
      o.accreditation_number as lab_accreditation_number,
      o.accreditation_body as lab_accreditation_body,
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
      -- Customer info (complete)
      c.name as customer_name,
      c.tax_id as customer_tax_id,
      c.phone as customer_phone,
      c.email as customer_email,
      c.address as customer_address,
      -- Asset info
      a.name as asset_name,
      a.serial_number,
      a.tag,
      a.model,
      a.manufacturer,
      -- Approver
      u.name as approver_name,
      -- Original job info (if this is an amendment)
      original.job_id as original_job_id,
      original.approved_at as original_approved_at,
      service_order_link.inmetro_repair_seal_number
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN customer c ON cj.customer_id = c.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    LEFT JOIN "user" u ON cj.approved_by = u.id
    LEFT JOIN calibration_job original ON cj.supersedes_id = original.id
    LEFT JOIN LATERAL (
      SELECT so.inmetro_repair_seal_number
      FROM service_order_certificate_link socl
      INNER JOIN service_order so ON so.id = socl.service_order_id
      WHERE socl.certificate_job_id = cj.id
      ORDER BY socl.linked_at DESC
      LIMIT 1
    ) service_order_link ON true
    WHERE cj.id = $1
    `,
    [jobId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  let certificateTemplateSnapshot = row.certificate_template_snapshot;
  let certificateTemplateId = row.certificate_template_id;

  if (!certificateTemplateSnapshot) {
    const templateResult = await client.query(
      `
            SELECT id, name, slug, version
            FROM certificate_template
            WHERE organization_id = $1
              AND is_default = true
              AND status = 'ACTIVE'
            LIMIT 1
            `,
      [row.organization_id],
    );

    const templateRow = templateResult.rows[0];
    certificateTemplateSnapshot = templateRow
      ? {
          id: templateRow.id,
          name: templateRow.name,
          slug: templateRow.slug,
          version: templateRow.version,
        }
      : {
          id: null,
          name: "Padrão do Sistema",
          slug: "padrao-sistema",
          version: 1,
        };

    certificateTemplateId = templateRow?.id ?? null;

    await client.query(
      `
            UPDATE calibration_job
            SET certificate_template_id = $2,
                certificate_template_snapshot = $3::jsonb
            WHERE id = $1
            `,
      [
        jobId,
        certificateTemplateId,
        JSON.stringify(certificateTemplateSnapshot),
      ],
    );
  }

  const labLogoUrl = await resolveOrganizationLogoDataUrl(
    env,
    row.lab_logo,
    jobId,
  );

  // Fetch approver's visual signature if exists
  let approverSignatureUrl: string | null = null;
  if (row.approved_by && row.organization_id) {
    const sigResult = await client.query(
      `
            SELECT mvs.r2_key, mvs.content_type
            FROM member_visual_signature mvs
            INNER JOIN member m ON mvs.member_id = m.id
            WHERE m.user_id = $1 AND mvs.organization_id = $2
            `,
      [row.approved_by, row.organization_id],
    );

    if (sigResult.rows.length > 0) {
      const sigRow = sigResult.rows[0];
      // Fetch signature from R2 and convert to base64 data URL
      try {
        const signatureObject = await getStoredObject(
          env,
          "media",
          sigRow.r2_key,
        );
        if (signatureObject) {
          const signatureBuffer = await signatureObject.arrayBuffer();
          const base64 = arrayBufferToBase64(signatureBuffer);
          approverSignatureUrl = `data:${sigRow.content_type};base64,${base64}`;
        }
      } catch (err) {
        console.warn(`[JOB ${jobId}] Failed to fetch approver signature:`, err);
      }
    }
  }

  return {
    jobId: row.job_id,
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
    methodSnapshot: row.method_snapshot,
    assetSnapshot: row.asset_snapshot,
    standardsSnapshot: row.standards_snapshot,
    serviceOrder: {
      inmetroRepairSealNumber: row.inmetro_repair_seal_number,
    },
    environmentalSnapshot: row.environmental_snapshot,
    calibrationLocationSnapshot: row.calibration_location_snapshot,
    calibrationPhaseSnapshot: row.calibration_phase_snapshot,
    certificateTemplateSnapshot,
    data: row.data,
    results: row.results,
    approverName: row.approver_name,
    approverSignatureUrl, // Visual signature as base64 data URL
    // Amendment fields - ISO 17025 Clause 7.8.4.1
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    amendmentNumber: row.amendment_number,
    amendmentReason: row.amendment_reason,
    originalJobId: row.original_job_id,
    originalApprovedAt: row.original_approved_at,
  };
}

type XlsxTemplateSelection = {
  templateId: number;
  templateVersionId: number;
  xlsxR2Key: string;
  bindingManifest: unknown;
  bindingManifestSha256: string;
  renderPolicy: unknown;
};

async function fetchXlsxTemplateSelectionForJob(
  client: Client,
  jobId: number,
): Promise<XlsxTemplateSelection | null> {
  const result = await client.query<{
    template_id: number;
    template_version_id: number;
    xlsx_r2_key: string;
    binding_manifest: unknown;
    binding_manifest_sha256: string;
    render_policy: unknown;
  }>(
    `
      select
        a.template_id,
        a.template_version_id,
        v.xlsx_r2_key,
        v.binding_manifest,
        v.binding_manifest_sha256,
        v.render_policy
      from calibration_job cj
      left join service s on s.id = cj.service_id
      inner join certificate_template_assignment a
        on a.organization_id = cj.organization_id
       and a.status = 'ACTIVE'
       and a.certificate_type = 'calibration'
       and (a.unit_id is null or a.unit_id = cj.unit_id)
       and (a.service_id is null or a.service_id = cj.service_id)
       and (a.method_id is null or a.method_id = s.method_id)
      inner join certificate_template_version v
        on v.id = a.template_version_id
       and v.status = 'PUBLISHED'
      inner join certificate_template t
        on t.id = a.template_id
       and t.status = 'ACTIVE'
      where cj.id = $1
      order by a.priority desc, a.created_at desc
      limit 1
    `,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    templateId: row.template_id,
    templateVersionId: row.template_version_id,
    xlsxR2Key: row.xlsx_r2_key,
    bindingManifest: row.binding_manifest,
    bindingManifestSha256: row.binding_manifest_sha256,
    renderPolicy: row.render_policy,
  };
}

function inferImageContentType(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
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

async function resolveOrganizationLogoDataUrl(
  env: Env,
  logoUrl: string | null | undefined,
  jobId: number,
) {
  const key = getLogoKeyFromUrl(logoUrl);
  if (!key) return logoUrl ?? null;

  try {
    const logoObject = await getStoredObject(env, "media", key);
    if (!logoObject) return logoUrl ?? null;

    const logoBuffer = await logoObject.arrayBuffer();
    const contentType =
      logoObject.httpMetadata?.contentType ?? inferImageContentType(logoBuffer);
    const base64 = arrayBufferToBase64(logoBuffer);
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn(`[JOB ${jobId}] Failed to fetch organization logo:`, err);
    return logoUrl ?? null;
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Signing certificate data fetched from database
 */
interface SigningCertificateData {
  encryptedP12: string;
  encryptedPassword: string;
  passwordIv: string;
  subjectCn: string;
}

/**
 * Fetch organization's default signing certificate
 */
async function fetchSigningCertificate(
  client: Client,
  organizationId: string,
  unitId: number,
): Promise<SigningCertificateData | null> {
  const result = await client.query(
    `
        SELECT encrypted_p12, encrypted_password, password_iv, subject_cn
        FROM organization_signing_certificate
        WHERE organization_id = $1
          AND unit_id = $2
          AND is_active = true
          AND is_default = true
          AND valid_until > NOW()
        LIMIT 1
        `,
    [organizationId, unitId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    encryptedP12: row.encrypted_p12,
    encryptedPassword: row.encrypted_password,
    passwordIv: row.password_iv,
    subjectCn: row.subject_cn,
  };
}

async function updateJobWithCertificate(
  client: Client,
  jobId: number,
  certificateUrl: string,
  userId: string,
  signatureMetadata?: SignatureMetadata,
  options: { preserveSignatureMetadata?: boolean } = {},
): Promise<void> {
  const now = new Date();

  // Check if job is SUPERSEDED (being regenerated with watermark)
  const statusResult = await client.query<{
    status: string;
    signature_metadata: unknown;
  }>(`SELECT status, signature_metadata FROM calibration_job WHERE id = $1`, [
    jobId,
  ]);
  const currentStatus = statusResult.rows[0]?.status;
  const isSuperseded = currentStatus === "SUPERSEDED";
  const shouldPreserveSignatureMetadata =
    options.preserveSignatureMetadata === true &&
    signatureMetadata === undefined;
  const auditSignatureMetadata =
    signatureMetadata ??
    (shouldPreserveSignatureMetadata
      ? parseSignatureMetadata(statusResult.rows[0]?.signature_metadata)
      : undefined);

  // Only update status to APPROVED if not already SUPERSEDED
  // SUPERSEDED jobs are being regenerated with watermark and should keep their status
  await client.query(
    `
    UPDATE calibration_job
    SET
      status = CASE WHEN status = 'SUPERSEDED' THEN 'SUPERSEDED' ELSE 'APPROVED' END,
      certificate_url = $2,
      signature_metadata = CASE WHEN $5 THEN signature_metadata ELSE $3::jsonb END,
      updated_at = $4
    WHERE id = $1
    `,
    [
      jobId,
      certificateUrl,
      signatureMetadata ? JSON.stringify(signatureMetadata) : null,
      now,
      shouldPreserveSignatureMetadata,
    ],
  );

  // Log appropriate action based on whether this is a watermark regeneration
  const action = isSuperseded
    ? "certificate_watermarked"
    : "certificate_generated";
  const statusChange = isSuperseded
    ? { status: "SUPERSEDED (watermark added)" }
    : { status: { old: "GENERATING_PDF", new: "APPROVED" } };

  await client.query(
    `
    INSERT INTO job_audit_log (job_id, action, changes, performed_by, performed_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      jobId,
      action,
      JSON.stringify({
        ...statusChange,
        certificateUrl: { old: null, new: certificateUrl },
        signatureMetadata: auditSignatureMetadata
          ? { signed: true, signerName: auditSignatureMetadata.signerName }
          : { signed: false },
      }),
      userId,
      now,
    ],
  );

  if (!isSuperseded) {
    try {
      await notifyCertificateReady(jobId);
    } catch (error) {
      console.error(
        `[JOB ${jobId}] Failed to send certificate ready notification:`,
        error,
      );
    }
  }
}

async function signPdfWithUnitCertificate(
  env: Env,
  jobId: number,
  organizationId: string | null | undefined,
  unitId: number | null | undefined,
  pdfBuffer: Buffer,
): Promise<{ pdfBuffer: Buffer; signatureMetadata?: SignatureMetadata }> {
  if (!env.SIGNING_MASTER_KEY) {
    return { pdfBuffer };
  }

  const signStart = performance.now();
  if (!organizationId) {
    console.warn(`[JOB ${jobId}] Missing organization_id for signing`);
  }
  if (!unitId) {
    console.warn(`[JOB ${jobId}] Missing unit_id for signing`);
  }

  const signingCert =
    organizationId && unitId
      ? await withDbClient(env, (client) =>
          fetchSigningCertificate(client, organizationId, unitId),
        )
      : null;

  if (!signingCert) {
    console.log(`[JOB ${jobId}] No signing certificate available`);
    return { pdfBuffer };
  }

  try {
    const password = decryptPassword(
      signingCert.encryptedPassword,
      signingCert.passwordIv,
      env.SIGNING_MASTER_KEY,
    );
    const p12Buffer = decryptBinary(
      signingCert.encryptedP12,
      env.SIGNING_MASTER_KEY,
    );
    const result = await signPdf(pdfBuffer, {
      p12Buffer,
      password,
      reason: "Certificado de Calibracao - CalibraFacil",
      location: "Brasil",
      enableLtv: false,
    });

    console.log(
      `[JOB ${jobId}] signPdf: ${Math.round(performance.now() - signStart)}ms (signed by ${signingCert.subjectCn})`,
    );
    return {
      pdfBuffer: Buffer.from(result.signedPdf),
      signatureMetadata: result.metadata,
    };
  } catch (signError) {
    console.error(
      `[JOB ${jobId}] PDF signing failed (continuing without signature):`,
      signError,
    );
    return { pdfBuffer };
  }
}

async function setJobError(
  client: Client,
  jobId: number,
  error: string,
  userId: string,
): Promise<void> {
  const now = new Date();

  await client.query(
    `
    UPDATE calibration_job
    SET 
      status = 'REJECTED',
      rejection_reason = $2,
      rejected_by = $3,
      rejected_at = $4,
      updated_at = $4
    WHERE id = $1
    `,
    [jobId, `Erro ao gerar certificado: ${error}`, userId, now],
  );

  await client.query(
    `
    INSERT INTO job_audit_log (job_id, action, changes, performed_by, performed_at, reason)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      jobId,
      "certificate_error",
      JSON.stringify({ status: { old: "GENERATING_PDF", new: "REJECTED" } }),
      userId,
      now,
      error,
    ],
  );
}

// =============================================================================
// LABEL GENERATION FUNCTIONS
// =============================================================================

async function fetchLabelData(
  client: Client,
  jobId: number,
): Promise<{
  label: LabelData;
  verificationToken: string;
  organizationId: string | null;
  approvedAt: Date | string | null;
} | null> {
  const result = await client.query(
    `
    SELECT
      cj.job_id,
      cj.performed_at,
      cj.approved_at,
      cj.organization_id,
      cj.verification_token,
      o.name as lab_name,
      a.tag as asset_tag
    FROM calibration_job cj
    LEFT JOIN organization o ON cj.organization_id = o.id
    LEFT JOIN asset a ON cj.asset_id = a.id
    WHERE cj.id = $1
    `,
    [jobId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  return {
    label: {
      jobId: row.job_id,
      labName: row.lab_name || "Laboratório",
      assetTag: row.asset_tag || "-",
      calibrationDate: row.performed_at,
      qrCodeDataUrl: "", // Will be filled after QR generation
    },
    verificationToken: row.verification_token,
    organizationId: row.organization_id,
    approvedAt: row.approved_at,
  };
}

async function updateJobWithLabel(
  client: Client,
  jobId: number,
  labelUrl: string,
  userId: string,
): Promise<void> {
  const now = new Date();

  await client.query(
    `
    UPDATE calibration_job
    SET label_url = $2, updated_at = $3
    WHERE id = $1
    `,
    [jobId, labelUrl, now],
  );

  await client.query(
    `
    INSERT INTO job_audit_log (job_id, action, changes, performed_by, performed_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      jobId,
      "label_generated",
      JSON.stringify({ labelUrl: { old: null, new: labelUrl } }),
      userId,
      now,
    ],
  );
}

function formatAddress(parts: Record<string, unknown> | null | undefined) {
  if (!parts || typeof parts !== "object") return null;
  return [
    parts.street,
    parts.number,
    parts.complement,
    parts.neighbourhood,
    parts.city,
    parts.state,
    parts.cep,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(", ");
}

async function fetchServiceOrderDocumentData(
  client: Client,
  serviceOrderId: number,
): Promise<ServiceOrderDocumentData | null> {
  const result = await client.query(
    `
    SELECT
      so.id,
      so.organization_id,
      so.unit_id,
      so.service_order_number,
      so.priority,
      so.opened_at,
      so.claimed_defect,
      so.intake_condition,
      so.accessories,
      so.invoice_remittance_number,
      so.invoice_remittance_key,
      so.carrier_name,
      so.third_party_name,
      so.old_seal_number,
      so.new_seal_number,
      so.inmetro_repair_seal_number,
      so.client_visible_notes,
      so.internal_notes,
      o.name as lab_name,
      o.cnpj as lab_cnpj,
      o.phone as lab_phone,
      o.email as lab_email,
      ou.name as unit_name,
      c.name as customer_name,
      c.tax_id as customer_tax_id,
      c.phone as customer_phone,
      c.email as customer_email,
      c.address as customer_address,
      snap.asset_name,
      snap.asset_type,
      snap.manufacturer,
      snap.model,
      snap.serial_number,
      snap.patrimony_number,
      snap.capacity,
      snap.resolution,
      snap.observed_identification,
      settings.default_intake_terms
    FROM service_order so
    LEFT JOIN organization o ON so.organization_id = o.id
    LEFT JOIN organization_unit ou ON so.unit_id = ou.id
    LEFT JOIN customer c ON so.customer_id = c.id
    LEFT JOIN service_order_asset_snapshot snap ON snap.service_order_id = so.id
    LEFT JOIN service_order_settings settings ON settings.organization_id = so.organization_id
    WHERE so.id = $1
    `,
    [serviceOrderId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const qrSvg = await QRCode.toString(
    `https://portal.calibrafacil.com/service-orders/${row.id}`,
    {
      type: "svg",
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
    },
  );

  return {
    serviceOrderNumber: row.service_order_number,
    openedAt: row.opened_at,
    requestedServices:
      row.priority === "warranty"
        ? ["Garantia"]
        : ["Orçamento", "Manutenção corretiva"],
    lab: {
      name: row.lab_name ?? "Laboratório",
      cnpj: row.lab_cnpj,
      phone: row.lab_phone,
      email: row.lab_email,
      address: null,
    },
    unit: { name: row.unit_name },
    customer: {
      name: row.customer_name ?? "Cliente",
      taxId: row.customer_tax_id,
      phone: row.customer_phone,
      email: row.customer_email,
      address: formatAddress(row.customer_address),
    },
    asset: {
      name: row.asset_name ?? "Instrumento",
      type: row.asset_type,
      manufacturer: row.manufacturer,
      model: row.model,
      serialNumber: row.serial_number,
      patrimonyNumber: row.patrimony_number,
      capacity: row.capacity,
      resolution: row.resolution,
      observedIdentification: row.observed_identification,
    },
    intake: {
      claimedDefect: row.claimed_defect,
      intakeCondition: row.intake_condition,
      accessories: row.accessories,
      invoiceRemittanceNumber: row.invoice_remittance_number,
      invoiceRemittanceKey: row.invoice_remittance_key,
      carrierName: row.carrier_name,
      thirdPartyName: row.third_party_name,
      oldSealNumber: row.old_seal_number,
      newSealNumber: row.new_seal_number,
      inmetroRepairSealNumber: row.inmetro_repair_seal_number,
      clientVisibleNotes: row.client_visible_notes,
      internalNotes: row.internal_notes,
      terms: row.default_intake_terms,
    },
    qrCodeDataUrl: `data:image/svg+xml;base64,${btoa(qrSvg)}`,
    publicUrl: `https://portal.calibrafacil.com/service-orders/${row.id}`,
  };
}

async function processServiceOrderIntakeDocument(
  env: Env,
  page: Page,
  serviceOrderId: number,
  documentId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(client, serviceOrderId),
    );
    if (!data) return { success: false, error: "Service order not found" };
    const html = renderToString(
      React.createElement(ServiceOrderIntakeDocumentHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const { year, month } = getYearMonth(data.openedAt, "openedAt");
    const org = await withDbClient(env, (client) =>
      fetchServiceOrderOrg(client, serviceOrderId),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: data.serviceOrderNumber,
      year,
      month,
      type: "INTAKE",
      version: 1,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, async (client) => {
      if (documentId) {
        await client.query(
          `UPDATE service_order_intake_document SET pdf_r2_key = $2, issued_at = COALESCE(issued_at, now()), issued_by_user_id = COALESCE(issued_by_user_id, $3) WHERE id = $1`,
          [documentId, key, userId],
        );
      } else {
        await client.query(
          `INSERT INTO service_order_intake_document (service_order_id, document_number, version, type, pdf_r2_key, issued_at, issued_by_user_id)
           VALUES ($1, $2, 1, 'combined', $3, now(), $4)
           ON CONFLICT DO NOTHING`,
          [serviceOrderId, `${data.serviceOrderNumber}/REC`, key, userId],
        );
      }
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchServiceOrderOrg(
  client: Client,
  serviceOrderId: number,
): Promise<OrgRef> {
  const result = await client.query<{ id: string; slug: string | null }>(
    `SELECT o.id, o.slug
     FROM service_order so
     INNER JOIN organization o ON o.id = so.organization_id
     WHERE so.id = $1`,
    [serviceOrderId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Service order organization not found");
  }
  return { id: row.id, slug: row.slug ?? "" };
}

async function processServiceOrderTag(
  env: Env,
  page: Page,
  serviceOrderId: number,
  tagId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await withDbClient(env, async (client) => {
      const result = await client.query(
        `
        SELECT so.organization_id, so.service_order_number, so.opened_at,
          c.name AS customer_name, snap.asset_name, snap.serial_number, snap.patrimony_number,
          tag.id AS tag_id, tag.tag_number
        FROM service_order so
        LEFT JOIN customer c ON so.customer_id = c.id
        LEFT JOIN service_order_asset_snapshot snap ON snap.service_order_id = so.id
        LEFT JOIN service_order_tag tag ON tag.service_order_id = so.id
        WHERE so.id = $1
        ORDER BY tag.id DESC
        LIMIT 1
        `,
        [serviceOrderId],
      );
      return result.rows[0];
    });
    if (!data) return { success: false, error: "Service order not found" };
    const qrSvg = await QRCode.toString(
      `https://calibrafacil.com/dashboard/service-orders/${serviceOrderId}`,
      { type: "svg", width: 200, margin: 1, errorCorrectionLevel: "M" },
    );
    const tag: ServiceOrderTagData = {
      serviceOrderNumber: data.service_order_number,
      customerName: data.customer_name ?? "Cliente",
      assetName: data.asset_name ?? "Instrumento",
      serialNumber: data.serial_number,
      patrimonyNumber: data.patrimony_number,
      openedAt: data.opened_at,
      qrCodeDataUrl: `data:image/svg+xml;base64,${btoa(qrSvg)}`,
    };
    const html = renderToString(
      React.createElement(ServiceOrderTagHtml, { tag }),
    );
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const { year, month } = getYearMonth(data.opened_at, "openedAt");
    const tagNumber =
      data.tag_number ?? `${data.service_order_number}-TAG-${serviceOrderId}`;
    const org = await withDbClient(env, (client) =>
      fetchServiceOrderOrg(client, serviceOrderId),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: data.service_order_number,
      year,
      month,
      type: "TAG",
      tagNumber,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, async (client) => {
      if (tagId ?? data.tag_id) {
        await client.query(
          `UPDATE service_order_tag SET pdf_r2_key = $2, printed_at = COALESCE(printed_at, now()), printed_by_user_id = COALESCE(printed_by_user_id, $3) WHERE id = $1`,
          [tagId ?? data.tag_id, key, userId],
        );
      } else {
        await client.query(
          `INSERT INTO service_order_tag (service_order_id, tag_number, pdf_r2_key, printed_at, printed_by_user_id)
           VALUES ($1, $2, $3, now(), $4)`,
          [serviceOrderId, tagNumber, key, userId],
        );
      }
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function processServiceOrderQuote(
  env: Env,
  page: Page,
  serviceOrderId: number,
  quoteId: number | undefined,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!quoteId) return { success: false, error: "Missing quoteId" };
    const base = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(client, serviceOrderId),
    );
    if (!base) return { success: false, error: "Service order not found" };
    const quote = await withDbClient(env, async (client) => {
      const quoteResult = await client.query(
        `SELECT * FROM service_order_quote WHERE id = $1`,
        [quoteId],
      );
      const itemsResult = await client.query(
        `SELECT description, quantity, unit, unit_price_cents, total_price_cents, type
         FROM service_order_quote_item WHERE quote_id = $1 ORDER BY sort_order, id`,
        [quoteId],
      );
      return { row: quoteResult.rows[0], items: itemsResult.rows };
    });
    if (!quote.row) return { success: false, error: "Quote not found" };
    const data: ServiceOrderQuoteData = {
      ...base,
      quote: {
        quoteNumber: quote.row.quote_number,
        version: quote.row.version,
        validUntil: quote.row.valid_until,
        paymentTerms: quote.row.payment_terms,
        deliveryEstimate: quote.row.delivery_estimate,
        warrantyTerms: quote.row.warranty_terms,
        clientMessage: quote.row.client_message,
        items: quote.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unit_price_cents,
          totalPriceCents: item.total_price_cents,
          type: item.type,
        })),
        subtotalServicesCents: quote.row.subtotal_services_cents,
        subtotalPartsCents: quote.row.subtotal_parts_cents,
        discountCents: quote.row.discount_cents,
        freightCents: quote.row.freight_cents,
        totalCents: quote.row.total_cents,
      },
    };
    const html = renderToString(
      React.createElement(ServiceOrderQuoteHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const { year, month } = getYearMonth(base.openedAt, "openedAt");
    const org = await withDbClient(env, (client) =>
      fetchServiceOrderOrg(client, serviceOrderId),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      month,
      type: "QUOTE",
      quoteNumber: quote.row.quote_number,
      version: quote.row.version,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, (client) =>
      client.query(
        `UPDATE service_order_quote SET pdf_r2_key = $2 WHERE id = $1`,
        [quoteId, key],
      ),
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function processServiceOrderDeliveryReceipt(
  env: Env,
  page: Page,
  serviceOrderId: number,
  documentId: number | undefined,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const base = await withDbClient(env, (client) =>
      fetchServiceOrderDocumentData(client, serviceOrderId),
    );
    if (!base) return { success: false, error: "Service order not found" };

    const payload = await withDbClient(env, async (client) => {
      const documentResult = await client.query(
        `
        SELECT *
        FROM service_order_delivery_document
        WHERE service_order_id = $1
          AND ($2::integer IS NULL OR id = $2)
        ORDER BY version DESC
        LIMIT 1
        `,
        [serviceOrderId, documentId ?? null],
      );
      const orderResult = await client.query(
        `
        SELECT organization_id, service_order_number, opened_at, delivered_at,
          delivered_to_name, delivered_to_document, delivery_method, delivery_notes,
          inmetro_repair_seal_number, inmetro_repair_seal_issued_at
        FROM service_order
        WHERE id = $1
        `,
        [serviceOrderId],
      );
      const executionResult = await client.query(
        `
        SELECT *
        FROM service_order_execution
        WHERE service_order_id = $1
        LIMIT 1
        `,
        [serviceOrderId],
      );
      const execution = executionResult.rows[0];
      const itemsResult = execution
        ? await client.query(
            `
            SELECT description, quantity, unit, unit_price_cents, total_price_cents, type
            FROM service_order_execution_item
            WHERE execution_id = $1
            ORDER BY sort_order, id
            `,
            [execution.id],
          )
        : { rows: [] };
      return {
        document: documentResult.rows[0],
        order: orderResult.rows[0],
        execution,
        items: itemsResult.rows,
      };
    });

    if (!payload.document) {
      return { success: false, error: "Delivery document not found" };
    }
    if (!payload.order)
      return { success: false, error: "Service order not found" };

    const items = payload.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unit_price_cents,
      totalPriceCents: item.total_price_cents,
      type: item.type,
    }));
    const subtotalPartsCents = items
      .filter((item) => item.type === "part")
      .reduce((total, item) => total + item.totalPriceCents, 0);
    const subtotalServicesCents = items
      .filter((item) => item.type !== "part")
      .reduce((total, item) => total + item.totalPriceCents, 0);
    const totalCents = items.reduce(
      (total, item) => total + item.totalPriceCents,
      0,
    );

    const data: ServiceOrderDeliveryReceiptData = {
      ...base,
      delivery: {
        documentNumber: payload.document.document_number,
        version: payload.document.version,
        issuedAt: payload.document.issued_at,
        deliveredAt: payload.order.delivered_at,
        deliveredToName: payload.order.delivered_to_name,
        deliveredToDocument: payload.order.delivered_to_document,
        deliveryMethod: payload.order.delivery_method,
        deliveryNotes: payload.order.delivery_notes,
        inmetroRepairSealNumber: payload.order.inmetro_repair_seal_number,
        inmetroRepairSealIssuedAt: payload.order.inmetro_repair_seal_issued_at,
        technicianSignature: payload.document.technician_signature_data,
        clientSignature: payload.document.client_signature_data,
      },
      execution: {
        servicePerformed: payload.execution?.service_performed,
        partsUsedSummary: payload.execution?.parts_used_summary,
        technicalNotes: payload.execution?.technical_notes,
        result: payload.execution?.result,
        finishedAt: payload.execution?.finished_at,
        items,
        subtotalServicesCents,
        subtotalPartsCents,
        totalCents,
      },
    };

    const html = renderToString(
      React.createElement(ServiceOrderDeliveryReceiptHtml, { data }),
    );
    const pdfBuffer = await generatePdfFromHtml(page, html);
    const { year, month } = getYearMonth(base.openedAt, "openedAt");
    const org = await withDbClient(env, (client) =>
      fetchOrgRefById(client, payload.order.organization_id),
    );
    const { bucket, key } = serviceOrderDocKey({
      org,
      serviceOrderNumber: base.serviceOrderNumber,
      year,
      month,
      type: "DELIVERY",
      version: payload.document.version,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await withDbClient(env, (client) =>
      client.query(
        `UPDATE service_order_delivery_document
         SET pdf_r2_key = $2, issued_at = COALESCE(issued_at, now()), issued_by_user_id = COALESCE(issued_by_user_id, $3)
         WHERE id = $1`,
        [payload.document.id, key, userId],
      ),
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generates a small PDF for thermal printer labels
 */
async function generateLabelPdf(page: Page, html: string): Promise<Uint8Array> {
  const fullHtml = `<!DOCTYPE html>${html}`;

  await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });

  return await page.pdf({
    width: "50mm",
    height: "30mm",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", bottom: "0", left: "0", right: "0" },
  });
}

/**
 * Process a label generation job
 */
async function processLabelJob(
  env: Env,
  page: Page,
  jobId: number,
  userId: string,
): Promise<{ success: boolean; labelUrl?: string; error?: string }> {
  const totalStart = performance.now();
  console.log(`[LABEL ${jobId}] Starting`);

  try {
    // 1. Fetch label data
    const dbFetchStart = performance.now();
    const data = await withDbClient(env, (client) =>
      fetchLabelData(client, jobId),
    );
    console.log(
      `[LABEL ${jobId}] fetchLabelData: ${Math.round(performance.now() - dbFetchStart)}ms`,
    );

    if (!data) {
      return { success: false, error: "Job not found" };
    }

    // 2. Generate QR code as SVG (canvas not available in Workers)
    const qrStart = performance.now();
    const verificationUrl = `https://verify.calibrafacil.com/v/${data.verificationToken}`;
    const qrSvg = await QRCode.toString(verificationUrl, {
      type: "svg",
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    // Convert SVG to data URL for embedding in HTML
    const qrCodeDataUrl = `data:image/svg+xml;base64,${btoa(qrSvg)}`;
    console.log(
      `[LABEL ${jobId}] QR generation: ${Math.round(performance.now() - qrStart)}ms`,
    );

    // 3. Render HTML
    const renderStart = performance.now();
    const labelData: LabelData = {
      ...data.label,
      qrCodeDataUrl,
    };
    const html = renderToString(
      React.createElement(LabelHtml, { label: labelData }),
    );
    console.log(
      `[LABEL ${jobId}] renderToString: ${Math.round(performance.now() - renderStart)}ms`,
    );

    // 4. Generate PDF
    const pdfStart = performance.now();
    const pdfBuffer = await generateLabelPdf(page, html);
    console.log(
      `[LABEL ${jobId}] generatePdf: ${Math.round(performance.now() - pdfStart)}ms (${pdfBuffer.length} bytes)`,
    );

    // 5. Upload to R2
    const r2Start = performance.now();
    const orgId = data.organizationId;
    if (!orgId) {
      throw new Error("Missing organization_id for label generation");
    }
    const year = getYear(
      data.approvedAt ?? data.label.calibrationDate,
      "approvedAt/performedAt",
    );
    const org = await withDbClient(env, (client) =>
      fetchOrgRefById(client, orgId),
    );
    const { bucket, key } = jobLabelKey({
      org,
      jobId: data.label.jobId,
      year,
    });
    await bucketBinding(env, bucket).put(key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });
    console.log(
      `[LABEL ${jobId}] R2 upload: ${Math.round(performance.now() - r2Start)}ms`,
    );

    // 6. Build public URL
    const labelUrl = `https://certificates.calibrafacil.com/${key}`;

    // 7. Update DB
    const dbUpdateStart = performance.now();
    await withDbClient(env, (client) =>
      updateJobWithLabel(client, jobId, labelUrl, userId),
    );
    console.log(
      `[LABEL ${jobId}] updateDB: ${Math.round(performance.now() - dbUpdateStart)}ms`,
    );

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[LABEL ${jobId}] DONE in ${totalMs}ms: ${labelUrl}`);

    return { success: true, labelUrl };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[LABEL ${jobId}] Error:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

// Helper to run a database operation with a fresh connection
async function withDbClient<T>(
  env: Env,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: env.DATABASE_URL,
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

/**
 * Configures a page for optimal PDF generation
 */
async function configurePage(page: Page): Promise<void> {
  // Block all external network requests for maximum speed
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    // Allow data: URLs (inline resources) and about:blank
    if (url.startsWith("data:") || url.startsWith("about:")) {
      req.continue();
    } else {
      req.abort();
    }
  });

  // Set viewport for A4 at 96dpi
  await page.setViewport({ width: 794, height: 1123 });

  // Emulate print media BEFORE loading content (avoids re-render)
  await page.emulateMediaType("print");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryChromiumPackDownload<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const retryDelaysMs = [1_000, 3_000, 7_000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const retryDelay = retryDelaysMs[attempt];
      if (retryDelay === undefined) break;

      console.warn(
        `[JOB] Chromium pack download failed (attempt ${attempt + 1}/${retryDelaysMs.length + 1}); retrying in ${retryDelay}ms: ${getErrorMessage(error)}`,
      );
      await delay(retryDelay);
    }
  }

  throw lastError;
}

function readTarString(bytes: Uint8Array, start: number, length: number) {
  let end = start;
  const maxEnd = start + length;
  while (end < maxEnd && bytes[end] !== 0) end += 1;
  return Buffer.from(bytes.subarray(start, end)).toString("utf8").trim();
}

function readTarSize(bytes: Uint8Array, start: number) {
  const rawSize = readTarString(bytes, start, 12).replaceAll("\0", "").trim();
  if (!rawSize) return 0;

  const size = Number.parseInt(rawSize, 8);
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Invalid Chromium pack tar entry size: ${rawSize}`);
  }
  return size;
}

function isEmptyTarBlock(bytes: Uint8Array, offset: number) {
  for (let index = offset; index < offset + 512; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

async function extractTarToDirectory(
  bytes: Uint8Array,
  destinationDirectory: string,
) {
  const path = await import("node:path");
  const { mkdir, writeFile } = await import("node:fs/promises");

  let offset = 0;
  while (offset + 512 <= bytes.byteLength) {
    if (isEmptyTarBlock(bytes, offset)) break;

    const name = readTarString(bytes, offset, 100);
    const prefix = readTarString(bytes, offset + 345, 155);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const size = readTarSize(bytes, offset + 124);
    const type = String.fromCharCode(bytes[offset + 156] ?? 0);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (!entryName) {
      throw new Error("Invalid Chromium pack tar entry name");
    }

    const normalizedName = path.posix.normalize(entryName);
    if (
      normalizedName.startsWith("../") ||
      normalizedName === ".." ||
      path.posix.isAbsolute(normalizedName)
    ) {
      throw new Error(`Unsafe Chromium pack tar entry: ${entryName}`);
    }

    if (dataEnd > bytes.byteLength) {
      throw new Error(`Invalid Chromium pack tar entry length: ${entryName}`);
    }

    const destinationPath = path.join(destinationDirectory, normalizedName);
    if (type === "5") {
      await mkdir(destinationPath, { recursive: true });
    } else if (type === "0" || type === "\0") {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, bytes.subarray(dataStart, dataEnd));
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
}

async function downloadChromiumPackFromR2(env: Env): Promise<string> {
  if (!env.CHROMIUM_PACK_R2_KEY) {
    throw new Error(
      "CHROMIUM_PACK_R2_KEY is required for authenticated Chromium pack download",
    );
  }
  if (!env.RUNTIME_ASSETS_BUCKET) {
    throw new Error(
      "CHROMIUM_PACK_R2_BUCKET is required when CHROMIUM_PACK_R2_KEY is set",
    );
  }

  const { existsSync } = await import("node:fs");
  const { mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const packDirectory = path.join(tmpdir(), "chromium-pack-r2");

  if (existsSync(path.join(packDirectory, "chromium.br"))) {
    return packDirectory;
  }

  const object = await env.RUNTIME_ASSETS_BUCKET.get(env.CHROMIUM_PACK_R2_KEY);
  if (!object) {
    throw new Error(
      `Chromium pack object not found in runtime R2 bucket: ${env.CHROMIUM_PACK_R2_KEY}`,
    );
  }

  const arrayBuffer = await object.arrayBuffer();
  await rm(packDirectory, { recursive: true, force: true });
  await mkdir(packDirectory, { recursive: true });
  await extractTarToDirectory(new Uint8Array(arrayBuffer), packDirectory);

  if (!existsSync(path.join(packDirectory, "chromium.br"))) {
    throw new Error("Chromium pack R2 object did not contain chromium.br");
  }

  return packDirectory;
}

async function getChromiumPackInput(env: Env): Promise<string> {
  if (env.CHROMIUM_PACK_R2_KEY) {
    return downloadChromiumPackFromR2(env);
  }

  if (env.CHROMIUM_PACK_URL) {
    return env.CHROMIUM_PACK_URL;
  }

  throw new Error(
    "CHROMIUM_PACK_R2_KEY with CHROMIUM_PACK_R2_BUCKET, or CHROMIUM_PACK_URL, is required for Vercel PDF generation",
  );
}

async function launchBrowser(env: Env): Promise<Browser> {
  const puppeteerCore = await import("puppeteer-core");

  if (env.CHROME_EXECUTABLE_PATH) {
    return puppeteerCore.default.launch({
      executablePath: env.CHROME_EXECUTABLE_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }

  if (process.env.VERCEL) {
    const chromium = await import("@sparticuz/chromium-min");
    const executablePath = await retryChromiumPackDownload(async () =>
      chromium.default.executablePath(await getChromiumPackInput(env)),
    );

    return puppeteerCore.default.launch({
      executablePath,
      headless: "shell",
      args: [
        ...chromium.default.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
  }

  throw new Error(
    "CHROME_EXECUTABLE_PATH is required for local PDF generation",
  );
}

/**
 * Generates a PDF from HTML content using an existing page
 */
async function generatePdfFromHtml(
  page: Page,
  html: string,
): Promise<Uint8Array> {
  const fullHtml = `<!DOCTYPE html>${html}`;
  const isFullPageCertificate = html.includes('data-pdf-layout="full-page"');

  // Load HTML - use domcontentloaded, NOT networkidle0!
  await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });

  if (isFullPageCertificate) {
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
  }

  return await page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `
            <div style="width: 100%; font-size: 9px; text-align: center; color: #666;">
                Página <span class="pageNumber"></span> de <span class="totalPages"></span>
            </div>
        `,
    margin: { top: "10mm", bottom: "15mm", left: "10mm", right: "10mm" },
  });
}

/**
 * Process a single job with an existing browser/page
 */
async function processJob(
  env: Env,
  page: Page,
  jobId: number,
  userId: string,
): Promise<{ success: boolean; certificateUrl?: string; error?: string }> {
  void page;
  const totalStart = performance.now();
  console.log(`[JOB ${jobId}] Starting`);

  try {
    // 1. Fetch job data
    const dbFetchStart = performance.now();
    const job = await withDbClient(env, (client) =>
      fetchJobData(client, jobId, env),
    );
    console.log(
      `[JOB ${jobId}] fetchJobData: ${Math.round(performance.now() - dbFetchStart)}ms`,
    );

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const xlsxSelection = await withDbClient(env, (client) =>
      fetchXlsxTemplateSelectionForJob(client, jobId),
    );
    if (xlsxSelection) {
      return processXlsxIssuedCertificate(
        env,
        jobId,
        job,
        userId,
        xlsxSelection,
      );
    }

    const totalMs = Math.round(performance.now() - totalStart);
    console.warn(
      `[JOB ${jobId}] ${CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE} (${totalMs}ms)`,
    );
    return {
      success: false,
      error: CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[JOB ${jobId}] Error:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

function isDocumentMessage(
  message: BackgroundJobMessage,
): message is DocumentBackgroundJobMessage {
  return (
    message.type !== "INTEGRATION_SYNC" &&
    message.type !== "SCHEDULED_NOTIFICATIONS" &&
    message.type !== "CERTIFICATE_XLSX_PREVIEW"
  );
}

function isIntegrationSyncMessage(
  message: BackgroundJobMessage,
): message is IntegrationSyncQueueMessage {
  return message.type === "INTEGRATION_SYNC";
}

function isServiceOrderDocumentMessage(
  message: DocumentBackgroundJobMessage,
): message is Extract<
  DocumentBackgroundJobMessage,
  {
    type:
      | "SERVICE_ORDER_INTAKE_DOCUMENT"
      | "SERVICE_ORDER_TAG"
      | "SERVICE_ORDER_QUOTE"
      | "SERVICE_ORDER_DELIVERY_RECEIPT";
  }
> {
  return (
    message.type === "SERVICE_ORDER_INTAKE_DOCUMENT" ||
    message.type === "SERVICE_ORDER_TAG" ||
    message.type === "SERVICE_ORDER_QUOTE" ||
    message.type === "SERVICE_ORDER_DELIVERY_RECEIPT"
  );
}

function isCalibrationCertificateMessage(
  message: BackgroundJobMessage,
): message is DocumentBackgroundJobMessage & {
  type?: "CERTIFICATE";
  jobId: number;
  userId: string;
} {
  if (!isDocumentMessage(message)) return false;
  if (isServiceOrderDocumentMessage(message)) return false;

  return (
    (message.type === undefined || message.type === "CERTIFICATE") &&
    typeof message.jobId === "number" &&
    typeof message.userId === "string"
  );
}

async function recordCertificateInfrastructureError(
  env: Env,
  message: BackgroundJobMessage,
  error: unknown,
) {
  if (!isCalibrationCertificateMessage(message)) return;

  const errorMessage = getErrorMessage(error);
  await withDbClient(env, (client) =>
    setJobError(client, message.jobId, errorMessage, message.userId),
  ).catch((dbError) => {
    console.error(
      `[JOB ${message.jobId}] Failed to record infrastructure error:`,
      dbError,
    );
  });
}

async function processDocumentMessage(
  env: Env,
  page: Page,
  body: DocumentBackgroundJobMessage,
) {
  if (isServiceOrderDocumentMessage(body)) {
    let result: { success: boolean; error?: string };
    if (body.type === "SERVICE_ORDER_INTAKE_DOCUMENT") {
      result = await processServiceOrderIntakeDocument(
        env,
        page,
        body.serviceOrderId,
        body.documentId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_TAG") {
      result = await processServiceOrderTag(
        env,
        page,
        body.serviceOrderId,
        body.tagId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_QUOTE") {
      result = await processServiceOrderQuote(
        env,
        page,
        body.serviceOrderId,
        body.quoteId,
      );
    } else {
      result = await processServiceOrderDeliveryReceipt(
        env,
        page,
        body.serviceOrderId,
        body.documentId,
        body.userId,
      );
    }

    if (!result.success) {
      throw new Error(result.error ?? `${body.type} failed`);
    }
    return;
  }

  const messageType = body.type || "CERTIFICATE";
  const result =
    messageType === "LABEL"
      ? await processLabelJob(env, page, body.jobId, body.userId)
      : await processJob(env, page, body.jobId, body.userId);

  if (!result.success && messageType !== "LABEL") {
    await withDbClient(env, (client) =>
      setJobError(
        client,
        body.jobId,
        result.error || "Unknown error",
        body.userId,
      ),
    ).catch((dbError) => {
      console.error(`[JOB ${body.jobId}] Failed to record error:`, dbError);
    });
  }

  if (!result.success) {
    throw new Error(result.error ?? `${messageType} generation failed`);
  }
}

async function processXlsxCertificateMessageIfSelected(
  env: Env,
  message: BackgroundJobMessage,
): Promise<boolean> {
  if (!isCalibrationCertificateMessage(message)) {
    return false;
  }

  const job = await withDbClient(env, (client) =>
    fetchJobData(client, message.jobId, env),
  );

  if (!job) {
    await withDbClient(env, (client) =>
      setJobError(client, message.jobId, "Job not found", message.userId),
    );
    throw new Error("Job not found");
  }

  const xlsxSelection = await withDbClient(env, (client) =>
    fetchXlsxTemplateSelectionForJob(client, message.jobId),
  );

  if (!xlsxSelection) {
    return false;
  }

  const result = await processXlsxIssuedCertificate(
    env,
    message.jobId,
    job,
    message.userId,
    xlsxSelection,
  );

  if (!result.success) {
    await withDbClient(env, (client) =>
      setJobError(
        client,
        message.jobId,
        result.error || "Unknown error",
        message.userId,
      ),
    ).catch((dbError) => {
      console.error(
        `[JOB ${message.jobId}] Failed to record XLSX error:`,
        dbError,
      );
    });
    throw new Error(result.error ?? "XLSX certificate generation failed");
  }

  return true;
}

async function processXlsxPreviewJob(
  env: Env,
  message: CertificateXlsxPreviewBackgroundJobMessage,
) {
  const totalStart = performance.now();
  console.log(`[XLSX PREVIEW ${message.previewId}] Starting`);

  try {
    const preview = await withDbClient(env, async (client) => {
      const result = await client.query<{
        id: number;
        organization_id: string;
        organization_slug: string | null;
        sample_data: Record<string, unknown> | null;
        xlsx_r2_key: string;
        xlsx_sha256: string;
        binding_manifest: unknown;
        binding_manifest_sha256: string;
      }>(
        `
          select
            p.id,
            p.organization_id,
            o.slug as organization_slug,
            p.sample_data,
            v.xlsx_r2_key,
            v.xlsx_sha256,
            v.binding_manifest,
            v.binding_manifest_sha256
          from certificate_template_preview p
          inner join certificate_template_version v
            on v.id = p.template_version_id
          inner join organization o
            on o.id = p.organization_id
          where p.id = $1
            and p.template_version_id = $2
        `,
        [message.previewId, message.templateVersionId],
      );
      return result.rows[0] ?? null;
    });

    if (!preview) {
      throw new Error("XLSX preview not found");
    }

    const sourceObject = await getStoredObject(
      env,
      "media",
      preview.xlsx_r2_key,
    );
    if (!sourceObject) {
      throw new Error(`Template XLSX not found: ${preview.xlsx_r2_key}`);
    }

    const manifest = validateCertificateXlsxBindingManifest(
      preview.binding_manifest,
    );
    const source = prepareXlsxWorkbookForRender(
      new Uint8Array(await sourceObject.arrayBuffer()),
    );
    const engine = new ExcelTsCertificateWorkbookEngine();
    const filled = await fillXlsxWorkbookFromManifest(
      engine,
      source,
      manifest,
      preview.sample_data ?? {},
    );
    const converter = createXlsxToPdfConverter(env);
    const converted = await converter.convert(filled.workbook, {
      fileName: `preview-${message.previewId}.xlsx`,
      singlePageSheets: false,
    });

    const previewOrg: OrgRef = {
      id: preview.organization_id,
      slug: preview.organization_slug ?? "",
    };
    const filledXlsx = templatePreviewKey({
      org: previewOrg,
      previewId: preview.id,
      extension: "xlsx",
    });
    const pdfPreview = templatePreviewKey({
      org: previewOrg,
      previewId: preview.id,
      extension: "pdf",
    });
    const filledXlsxR2Key = filledXlsx.key;
    const pdfR2Key = pdfPreview.key;

    await bucketBinding(env, filledXlsx.bucket).put(
      filledXlsxR2Key,
      filled.workbook,
      {
        httpMetadata: {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      },
    );
    await bucketBinding(env, pdfPreview.bucket).put(pdfR2Key, converted.bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const renderMetadata = {
      converter: converted.metadata,
      xlsxSha256: preview.xlsx_sha256,
      bindingManifestSha256: preview.binding_manifest_sha256,
      workbookWarnings: filled.warnings,
      durationMs: Math.round(performance.now() - totalStart),
    };

    await withDbClient(env, (client) =>
      client.query(
        `
          update certificate_template_preview
          set status = 'RENDERED',
              filled_xlsx_r2_key = $1,
              pdf_r2_key = $2,
              pdf_sha256 = $3,
              render_metadata = $4::jsonb,
              error = null,
              updated_at = now()
          where id = $5
        `,
        [
          filledXlsxR2Key,
          pdfR2Key,
          sha256Hex(converted.bytes),
          JSON.stringify(renderMetadata),
          preview.id,
        ],
      ),
    );

    console.log(
      `[XLSX PREVIEW ${message.previewId}] DONE in ${renderMetadata.durationMs}ms`,
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await withDbClient(env, (client) =>
      client.query(
        `
          update certificate_template_preview
          set status = 'FAILED',
              error = $1,
              updated_at = now()
          where id = $2
        `,
        [errorMessage, message.previewId],
      ),
    ).catch((dbError) => {
      console.error(
        `[XLSX PREVIEW ${message.previewId}] Failed to record error:`,
        dbError,
      );
    });
    throw error;
  }
}

function formatCustomerAddress(
  address: JobData["customer"]["address"],
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

function formatLabAddress(job: JobData): string {
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

function parseDateish(value: Dateish): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateForXlsx(value: Dateish): string {
  const date = parseDateish(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumberForXlsx(value: number, fractionDigits?: number): string {
  const decimals =
    fractionDigits ??
    (Number.isInteger(value)
      ? 0
      : Math.min(6, Math.max(1, String(value).split(".")[1]?.length ?? 1)));

  return value.toLocaleString("pt-BR", {
    useGrouping: false,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMeasuredValueForXlsx(
  value: unknown,
  unit: string,
  fractionDigits = 1,
): string {
  const numeric = asFiniteNumber(value);
  return numeric === null
    ? ""
    : `${formatNumberForXlsx(numeric, fractionDigits)} ${unit}`;
}

function formatMethodValueForXlsx(
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
      ? formatNumberForXlsx(numeric)
      : formatNumberForXlsx(converted);
  }

  return formatNumberForXlsx(numeric);
}

function isEffectiveDegreesOfFreedomKey(key: string): boolean {
  return key === "veff" || key.startsWith("veff_");
}

function formatEffectiveDegreesOfFreedomForXlsx(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value.map((item) => formatEffectiveDegreesOfFreedomForXlsx(item));
  }

  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.toLowerCase() === "infinito" || raw === "Infinity") {
    return "infinito";
  }

  const numeric = asFiniteNumber(value);
  if (numeric === null) return value;
  return numeric >= 1_000_000_000
    ? "infinito"
    : formatNumberForXlsx(numeric, 0);
}

function formatAssetMeasurementForXlsx(
  job: JobData,
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
      return `${formatNumberForXlsx(converted)} ${targetUnit}`;
    }
  }

  return isMassMeasurementUnit(sourceUnit)
    ? `${formatNumberForXlsx(numeric)} ${sourceUnit}`
    : formatNumberForXlsx(numeric);
}

function getFirstWeighingRangeSpec(
  job: JobData,
): Record<string, unknown> | undefined {
  const ranges = job.assetSnapshot?.specifications?.weighingRanges;
  if (!Array.isArray(ranges)) {
    return undefined;
  }

  const firstRange = recordFromUnknown(ranges[0]);
  return Object.keys(firstRange).length > 0 ? firstRange : undefined;
}

function collectMethodDataUnits(job: JobData): Map<string, unknown> {
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

function normalizeMethodDataDisplayForXlsx(job: JobData) {
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

    return formatMethodValueForXlsx(value, units.get(path), targetUnit);
  };

  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, formatByPath(value, key)]),
  );
}

function normalizeMethodResultsDisplayForXlsx(job: JobData) {
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

    return formatMethodValueForXlsx(value, unit, targetUnit);
  };

  return Object.fromEntries(
    Object.entries(results)
      .filter(([key]) => !key.startsWith("__"))
      .map(([key, value]) => [
        key,
        isEffectiveDegreesOfFreedomKey(key)
          ? formatEffectiveDegreesOfFreedomForXlsx(value)
          : formatResultValue(value, formulaUnits.get(key)),
      ]),
  );
}

function normalizeStandardsForXlsx(job: JobData) {
  return (job.standardsSnapshot ?? []).map((standard, index) => ({
    index,
    id: standard.id,
    name: standard.name,
    type: standard.type,
    certificateNumber: standard.certificateNumber,
    issuer: standard.calibratedBy || standard.certificateNumber.split("-")[0],
    calibratedBy: standard.calibratedBy,
    calibrationDate: toIsoDateish(standard.calibrationDate),
    calibrationDateText: formatDateForXlsx(standard.calibrationDate),
    validUntil: toIsoDateish(standard.nextCalibrationDate),
    validUntilText: formatDateForXlsx(standard.nextCalibrationDate),
    nextCalibrationDate: toIsoDateish(standard.nextCalibrationDate),
    nextCalibrationDateText: formatDateForXlsx(standard.nextCalibrationDate),
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

function normalizeCertifiedValuesForXlsx(
  standards: ReturnType<typeof normalizeStandardsForXlsx>,
) {
  return standards.flatMap((standard) => standard.certifiedValues);
}

function normalizeResultRowsForXlsx(job: JobData) {
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
  rows: ReturnType<typeof normalizeResultRowsForXlsx>,
  role: string,
) {
  return rows.find((row) => row.role === role) ?? null;
}

function normalizeMassCompositionsForXlsx(job: JobData) {
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

function buildXlsxCertificateData(job: JobData): Record<string, unknown> {
  const standards = normalizeStandardsForXlsx(job);
  const resultRows = normalizeResultRowsForXlsx(job);
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
  const lab = {
    name: job.lab.name,
    cnpj: job.lab.cnpj,
    accreditationNumber: job.lab.accreditationNumber,
    accreditationBody: job.lab.accreditationBody,
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
    logo: job.lab.logo,
    technicalManagerName: job.lab.technicalManagerName,
    technicalManagerTitle: job.lab.technicalManagerTitle,
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
      capacityText: formatAssetMeasurementForXlsx(
        job,
        assetSpecifications.capacity,
        assetSpecifications.capacityUnit ?? firstWeighingRange?.rangeUnit,
      ),
      division: assetSpecifications.resolution,
      divisionText: formatAssetMeasurementForXlsx(
        job,
        assetSpecifications.resolution,
        assetSpecifications.resolutionUnit ??
          firstWeighingRange?.resolutionUnit,
      ),
    },
    certificate: {
      number: job.jobId,
      name: job.certificateName,
      issuedAt: toIsoDateish(job.approvedAt),
      issuedAtText: formatDateForXlsx(job.approvedAt),
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
      performedAtText: formatDateForXlsx(job.performedAt),
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
      inmetroRepairSealNumber: job.serviceOrder?.inmetroRepairSealNumber,
    },
    graphics: {
      eccentricityIndicator: null,
      eccentricityIndicatorPosition:
        job.assetSnapshot?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY] ??
        job.data?.[ECCENTRICITY_INDICATOR_SPEC_KEY],
    },
    environment: {
      temperature: job.environmentalSnapshot?.temperature,
      temperatureText: formatMeasuredValueForXlsx(
        job.environmentalSnapshot?.temperature,
        "ºC",
      ),
      relativeHumidity: job.environmentalSnapshot?.humidity,
      relativeHumidityText: formatMeasuredValueForXlsx(
        job.environmentalSnapshot?.humidity,
        "%",
      ),
      pressure: job.environmentalSnapshot?.pressure,
      pressureText: formatMeasuredValueForXlsx(
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
    certifiedValues: normalizeCertifiedValuesForXlsx(standards),
    resultRows,
    calibrationResults,
    uncertainty: {
      expanded: expandedUncertainty,
      coverageFactor,
      budget: uncertaintyBudget,
    },
    uncertaintyBudget,
    massCompositions: normalizeMassCompositionsForXlsx(job),
    calibrationPhase: job.calibrationPhaseSnapshot,
    approval: {
      approvedBy: {
        name: job.approverName,
      },
      signatureUrl: job.approverSignatureUrl,
    },
    results: job.results,
    resultsDisplay: normalizeMethodResultsDisplayForXlsx(job),
    data: job.data,
    dataDisplay: normalizeMethodDataDisplayForXlsx(job),
  };
}

async function processXlsxIssuedCertificate(
  env: Env,
  jobId: number,
  job: JobData,
  userId: string,
  selection: XlsxTemplateSelection,
): Promise<{ success: boolean; certificateUrl?: string; error?: string }> {
  const existingSnapshot = await withDbClient(env, async (client) => {
    const result = await client.query<{
      pdf_r2_key: string;
      signature_metadata: unknown;
    }>(
      `
        select ics.pdf_r2_key, cj.signature_metadata
        from issued_certificate_snapshot ics
        join calibration_job cj on cj.id = ics.job_id
        where ics.job_id = $1
        limit 1
      `,
      [jobId],
    );
    return result.rows[0] ?? null;
  });

  if (existingSnapshot) {
    const certificateUrl = `https://certificates.calibrafacil.com/${existingSnapshot.pdf_r2_key}`;
    await withDbClient(env, (client) =>
      updateJobWithCertificate(
        client,
        jobId,
        certificateUrl,
        userId,
        parseSignatureMetadata(existingSnapshot.signature_metadata),
        { preserveSignatureMetadata: true },
      ),
    );
    return { success: true, certificateUrl };
  }

  if (!job.organizationId) {
    return { success: false, error: "Missing organization_id" };
  }

  try {
    const sourceObject = await getStoredObject(
      env,
      "media",
      selection.xlsxR2Key,
    );
    if (!sourceObject) {
      throw new Error(`Template XLSX not found: ${selection.xlsxR2Key}`);
    }

    const manifest = validateCertificateXlsxBindingManifest(
      selection.bindingManifest,
    );
    const source = prepareXlsxWorkbookForRender(
      new Uint8Array(await sourceObject.arrayBuffer()),
    );
    const inputDataSnapshot = buildXlsxCertificateData(job);
    const engine = new ExcelTsCertificateWorkbookEngine();
    const filled = await fillXlsxWorkbookFromManifest(
      engine,
      source,
      manifest,
      inputDataSnapshot,
      job,
    );
    const converter = createXlsxToPdfConverter(env);
    const converted = await converter.convert(filled.workbook, {
      fileName: `${job.jobId}.xlsx`,
      singlePageSheets: false,
    });
    const signed = await signPdfWithUnitCertificate(
      env,
      jobId,
      job.organizationId,
      job.unitId,
      Buffer.from(converted.bytes),
    );
    const pdfBuffer = signed.pdfBuffer;

    const year = getYear(
      job.approvedAt ?? job.performedAt,
      "approvedAt/performedAt",
    );
    const issuedObjectId = randomUUID();
    const certDescriptor = {
      org: {
        id: job.organizationId,
        slug: job.organizationSlug ?? "",
      },
      jobId: job.jobId,
      issuedId: issuedObjectId,
      certNumber: job.certificateName ?? job.jobId,
      year,
      companyName: job.customer.name,
      assetTag: job.asset.tag,
      brand: job.asset.manufacturer,
    };
    const pdf = issuedCertificatePdfKey(certDescriptor);
    const filledXlsx = issuedCertificateXlsxKey(certDescriptor);
    const pdfR2Key = pdf.key;
    const filledXlsxR2Key = filledXlsx.key;

    await bucketBinding(env, filledXlsx.bucket).put(
      filledXlsxR2Key,
      filled.workbook,
      {
        httpMetadata: {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      },
    );
    await bucketBinding(env, pdf.bucket).put(pdfR2Key, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const renderMetadata = {
      converter: converted.metadata,
      workbookWarnings: filled.warnings,
      signature: signed.signatureMetadata
        ? { signed: true, signerName: signed.signatureMetadata.signerName }
        : { signed: false },
      renderedAt: new Date().toISOString(),
    };

    const issuedPdfR2Key = await withDbClient(env, async (client) => {
      const insertResult = await client.query<{ pdf_r2_key: string }>(
        `
          insert into issued_certificate_snapshot (
            organization_id,
            job_id,
            template_id,
            template_version_id,
            certificate_number,
            filled_xlsx_r2_key,
            filled_xlsx_sha256,
            pdf_r2_key,
            pdf_sha256,
            binding_manifest_sha256,
            render_policy,
            render_metadata,
            input_data_snapshot,
            status,
            issued_by
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, 'ISSUED', $14)
          on conflict (job_id) do nothing
          returning pdf_r2_key
        `,
        [
          job.organizationId,
          jobId,
          selection.templateId,
          selection.templateVersionId,
          job.jobId,
          filledXlsxR2Key,
          sha256Hex(filled.workbook),
          pdfR2Key,
          sha256Hex(pdfBuffer),
          selection.bindingManifestSha256,
          JSON.stringify(selection.renderPolicy),
          JSON.stringify(renderMetadata),
          JSON.stringify(inputDataSnapshot),
          userId,
        ],
      );

      const insertedSnapshotPdfR2Key = insertResult.rows[0]?.pdf_r2_key;
      const existingSnapshotAfterConflict = insertedSnapshotPdfR2Key
        ? null
        : (
            await client.query<{
              pdf_r2_key: string;
              signature_metadata: unknown;
            }>(
              `
                select ics.pdf_r2_key, cj.signature_metadata
                from issued_certificate_snapshot ics
                join calibration_job cj on cj.id = ics.job_id
                where ics.job_id = $1
                limit 1
              `,
              [jobId],
            )
          ).rows[0];
      const snapshotPdfR2Key =
        insertedSnapshotPdfR2Key ?? existingSnapshotAfterConflict?.pdf_r2_key;

      if (!snapshotPdfR2Key) {
        throw new Error("Issued certificate snapshot was not persisted");
      }

      const snapshotCertificateUrl = `https://certificates.calibrafacil.com/${snapshotPdfR2Key}`;
      await updateJobWithCertificate(
        client,
        jobId,
        snapshotCertificateUrl,
        userId,
        insertedSnapshotPdfR2Key
          ? signed.signatureMetadata
          : parseSignatureMetadata(
              existingSnapshotAfterConflict?.signature_metadata,
            ),
        { preserveSignatureMetadata: !insertedSnapshotPdfR2Key },
      );
      return snapshotPdfR2Key;
    });

    const certificateUrl = `https://certificates.calibrafacil.com/${issuedPdfR2Key}`;
    return { success: true, certificateUrl };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function processBackgroundJob(
  env: Env,
  message: BackgroundJobMessage,
) {
  if (message.type === "CERTIFICATE_XLSX_PREVIEW") {
    await processXlsxPreviewJob(env, message);
    return;
  }

  if (message.type === "INTEGRATION_SYNC") {
    await processIntegrationSync(env, message);
    return;
  }

  if (message.type === "SCHEDULED_NOTIFICATIONS") {
    await processScheduledNotifications(env);
    return;
  }

  if (await processXlsxCertificateMessageIfSelected(env, message)) {
    return;
  }

  if (isCalibrationCertificateMessage(message)) {
    await withDbClient(env, (client) =>
      setJobError(
        client,
        message.jobId,
        CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE,
        message.userId,
      ),
    ).catch((dbError) => {
      console.error(
        `[JOB ${message.jobId}] Failed to record missing XLSX template error:`,
        dbError,
      );
    });
    throw new Error(CERTIFICATE_XLSX_TEMPLATE_REQUIRED_MESSAGE);
  }

  const browserStart = performance.now();
  let browser: Browser | undefined;
  let documentProcessingStarted = false;

  try {
    browser = await launchBrowser(env);
    console.log(
      `[JOB] puppeteer.launch: ${Math.round(performance.now() - browserStart)}ms`,
    );

    const pageStart = performance.now();
    const page = await browser.newPage();
    await configurePage(page);
    console.log(
      `[JOB] browser.newPage + configure: ${Math.round(performance.now() - pageStart)}ms`,
    );
    documentProcessingStarted = true;
    await processDocumentMessage(env, page, message);
  } catch (error) {
    if (!documentProcessingStarted) {
      await recordCertificateInfrastructureError(env, message, error);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch((e) => {
        console.error("[JOB] browser.close failed:", e);
      });
    }
  }
}

export async function processBackgroundJobBatch(
  env: Env,
  messages: BackgroundJobMessage[],
) {
  const integrationMessages = messages.filter(isIntegrationSyncMessage);
  const scheduledNotificationMessages = messages.filter(
    (message) => message.type === "SCHEDULED_NOTIFICATIONS",
  );
  const xlsxPreviewMessages = messages.filter(
    (message): message is CertificateXlsxPreviewBackgroundJobMessage =>
      message.type === "CERTIFICATE_XLSX_PREVIEW",
  );
  const documentMessages = messages.filter(isDocumentMessage);

  for (const message of integrationMessages) {
    await processIntegrationSync(env, message);
  }

  for (const _message of scheduledNotificationMessages) {
    await processScheduledNotifications(env);
  }

  for (const message of xlsxPreviewMessages) {
    await processXlsxPreviewJob(env, message);
  }

  const browserDocumentMessages: DocumentBackgroundJobMessage[] = [];
  for (const message of documentMessages) {
    if (await processXlsxCertificateMessageIfSelected(env, message)) {
      continue;
    }
    browserDocumentMessages.push(message);
  }

  if (browserDocumentMessages.length === 0) return;

  const browserStart = performance.now();
  let browser: Browser | undefined;
  let readyForDocumentMessages = false;

  try {
    browser = await launchBrowser(env);
    console.log(
      `[BATCH] puppeteer.launch: ${Math.round(performance.now() - browserStart)}ms`,
    );

    const pageStart = performance.now();
    const page = await browser.newPage();
    await configurePage(page);
    console.log(
      `[BATCH] browser.newPage + configure: ${Math.round(performance.now() - pageStart)}ms`,
    );
    readyForDocumentMessages = true;

    for (const message of browserDocumentMessages) {
      await processDocumentMessage(env, page, message);
    }
  } catch (error) {
    if (!readyForDocumentMessages) {
      await Promise.all(
        browserDocumentMessages.map((message) =>
          recordCertificateInfrastructureError(env, message, error),
        ),
      );
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch((e) => {
        console.error("[BATCH] browser.close failed:", e);
      });
    }
  }
}

export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const batchSize = batch.messages.length;
    console.log(`[BATCH] Processing ${batchSize} job(s)`);
    const batchStart = performance.now();

    for (const msg of batch.messages) {
      try {
        await processBackgroundJob(env, msg.body);
        msg.ack();
      } catch (error) {
        console.error("[BATCH] Failed to process message:", {
          error,
          body: msg.body,
        });
        msg.retry();
      }
    }

    const batchMs = Math.round(performance.now() - batchStart);
    console.log(
      `[BATCH] Completed ${batchSize} job(s) in ${batchMs}ms (avg: ${Math.round(batchMs / batchSize)}ms/job)`,
    );
  },

  // Health check endpoint
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", worker: "calibra-facil-worker" }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        name: "Calibra Fácil - Certificate Worker",
        description: "Queue consumer for PDF certificate generation",
        endpoints: {
          "/health": "Health check",
        },
        note: "This worker processes queue messages. Queue testing requires deployment.",
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  },

  // Scheduled handlers for compliance notifications and integration syncs
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (event.cron === "*/30 * * * *") {
      console.log("[Scheduled] Starting integration scheduler");
      const start = performance.now();

      try {
        const result = await processScheduledIntegrationSyncs(env);
        const duration = Math.round(performance.now() - start);
        console.log(
          `[Scheduled] Integration scheduler completed in ${duration}ms: ` +
            `${result.scheduledRuns} run(s) dispatched`,
        );
      } catch (error) {
        console.error("[Scheduled] Error processing integrations:", error);
        throw error;
      }

      return;
    }

    console.log("[Scheduled] Starting daily compliance notification check");
    const start = performance.now();

    try {
      const result = await processScheduledNotifications(env);
      const duration = Math.round(performance.now() - start);

      console.log(
        `[Scheduled] Completed in ${duration}ms: ` +
          `${result.assetsProcessed} assets, ` +
          `${result.standardsProcessed} standards, ` +
          `${result.jobsProcessed} jobs`,
      );
    } catch (error) {
      console.error("[Scheduled] Error processing notifications:", error);
      throw error;
    }
  },
};
