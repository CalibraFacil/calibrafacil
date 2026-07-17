import {
  BANNED_PLACEHOLDER_SEGMENTS,
  type CertificateDocument,
  collectPlaceholderPaths,
} from "./document-schema.js";
import { type PlaceholderFormat, applyPlaceholderFormat } from "./format.js";

/**
 * Typed placeholder catalog (spec 02 §2) — the leaf-enumerated successor of
 * `CERTIFICATE_XLSX_FIELD_ROOTS`. The data object being addressed is EXACTLY
 * the output of `buildXlsxCertificateData(job)` (apps/worker/src/index.ts),
 * which is persisted verbatim as `issued_certificate_snapshot.input_data_snapshot`.
 *
 * Rules:
 * - a placeholder path not in this catalog is a TEMPLATE COMPILE ERROR;
 * - `required: true` + value missing at render is a RENDER ERROR (fail-loud);
 * - `required: false` + missing renders as "" — only by this explicit opt-in;
 * - §7.8.4.3 ban is re-checked here (defense in depth with document-schema).
 */
export type PlaceholderCatalogEntry = {
  path: string;
  /** pt-BR label shown in the editor autocomplete/inspector. */
  label: string;
  /** Editor grouping. */
  group:
    | "Certificado"
    | "Calibração"
    | "Cliente"
    | "Item"
    | "Laboratório"
    | "Acreditação"
    | "Método"
    | "Condições ambientais"
    | "Incerteza"
    | "Aprovação"
    | "Ordem de serviço";
  type: "text" | "number" | "date" | "boolean";
  /** Provenance for auditors: table.column or builder derivation. */
  source: string;
  required: boolean;
  format: PlaceholderFormat;
  /** Weighing-flavored or otherwise instrument-specific field (UI hint). */
  instrumentSpecific?: boolean;
};

const entry = (
  path: string,
  label: string,
  group: PlaceholderCatalogEntry["group"],
  type: PlaceholderCatalogEntry["type"],
  source: string,
  required: boolean,
  format: PlaceholderFormat = "text",
  extra?: Partial<PlaceholderCatalogEntry>,
): PlaceholderCatalogEntry => ({
  path,
  label,
  group,
  type,
  source,
  required,
  format,
  ...extra,
});

export const PLACEHOLDER_CATALOG: readonly PlaceholderCatalogEntry[] = [
  // ------------------------------------------------------------- Certificado
  entry("certificate.number", "Número do certificado", "Certificado", "text", "calibration_job.job_id", true),
  entry("certificate.name", "Nome do certificado", "Certificado", "text", "calibration_job.certificate_name", false),
  entry("certificate.issuedAt", "Data de emissão", "Certificado", "date", "calibration_job.approved_at", true, "date-br"),
  entry("certificate.issuedAtText", "Data de emissão (texto)", "Certificado", "text", "builder: formatDateForXlsx(approved_at)", true),
  entry("certificate.verificationUrl", "URL de verificação", "Certificado", "text", "builder: verify.calibrafacil.com/v/{verification_token}", true),
  entry("certificate.amendmentNumber", "Número da retificação", "Certificado", "number", "calibration_job.amendment_number", false, "number-br"),
  entry("certificate.amendmentReason", "Motivo da retificação", "Certificado", "text", "calibration_job.amendment_reason", false),
  entry("certificate.originalJobId", "Certificado original (retificado)", "Certificado", "text", "calibration_job.supersedes -> job_id", false),
  entry("certificate.originalApprovedAt", "Emissão do certificado original", "Certificado", "date", "calibration_job.supersedes -> approved_at", false, "date-br"),
  // -------------------------------------------------------------- Calibração
  entry("job.id", "Identificação do serviço", "Calibração", "text", "calibration_job.job_id", true),
  entry("job.performedAt", "Data da calibração", "Calibração", "date", "calibration_job.performed_at", true, "date-br"),
  entry("job.performedAtText", "Data da calibração (texto)", "Calibração", "text", "builder: formatDateForXlsx(performed_at)", true),
  entry("job.location", "Local da calibração", "Calibração", "text", "calibration_job.calibration_location_snapshot.addressText", false),
  entry("job.locationType", "Tipo de local", "Calibração", "text", "calibration_job.calibration_location_snapshot.type", false),
  // ----------------------------------------------------------------- Cliente
  entry("customer.name", "Razão social do cliente", "Cliente", "text", "customer.name", true),
  entry("customer.taxId", "CNPJ/CPF do cliente", "Cliente", "text", "customer.tax_id", false, "cnpj"),
  entry("customer.address", "Endereço do cliente", "Cliente", "text", "builder: formatCustomerAddress(customer.address)", false),
  entry("customer.phone", "Telefone do cliente", "Cliente", "text", "customer.phone", false),
  entry("customer.email", "E-mail do cliente", "Cliente", "text", "customer.email", false),
  // -------------------------------------------------------------------- Item
  entry("asset.kind", "Tipo do item", "Item", "text", "asset.name (via snapshot)", true),
  entry("asset.tag", "TAG do item", "Item", "text", "asset.tag", false),
  entry("asset.serialNumber", "Número de série", "Item", "text", "asset.serial_number (via snapshot)", false),
  entry("asset.manufacturer", "Fabricante", "Item", "text", "asset.manufacturer (via snapshot)", false),
  entry("asset.model", "Modelo", "Item", "text", "asset.model (via snapshot)", false),
  entry("asset.baseMeasurementUnit", "Unidade base de medição", "Item", "text", "asset_snapshot.baseMeasurementUnit", false),
  entry("asset.capacityText", "Capacidade (texto)", "Item", "text", "asset_snapshot.specifications.capacity + unidade", false, "text", { instrumentSpecific: true }),
  entry("asset.divisionText", "Divisão/resolução (texto)", "Item", "text", "asset_snapshot.specifications.resolution + unidade", false, "text", { instrumentSpecific: true }),
  entry("asset.inmetroRegistration", "Portaria/registro Inmetro", "Item", "text", "asset_snapshot.specifications.inmetroRegistration", false, "text", { instrumentSpecific: true }),
  // ------------------------------------------------------------- Laboratório
  entry("lab.name", "Nome do laboratório", "Laboratório", "text", "organization.name", true),
  entry("lab.cnpj", "CNPJ do laboratório", "Laboratório", "text", "organization.cnpj", false, "cnpj"),
  entry("lab.address", "Endereço do laboratório", "Laboratório", "text", "builder: formatLabAddress(organization.*)", false),
  entry("lab.city", "Cidade do laboratório", "Laboratório", "text", "organization.city", false),
  entry("lab.state", "UF do laboratório", "Laboratório", "text", "organization.state", false),
  entry("lab.phone", "Telefone do laboratório", "Laboratório", "text", "organization.phone", false),
  entry("lab.email", "E-mail do laboratório", "Laboratório", "text", "organization.email", false),
  entry("lab.website", "Site do laboratório", "Laboratório", "text", "organization.website", false),
  entry("lab.technicalManagerName", "Responsável técnico", "Laboratório", "text", "organization.technical_manager_name", false),
  entry("lab.technicalManagerTitle", "Título do responsável técnico", "Laboratório", "text", "organization.technical_manager_title", false),
  // -------------------------------------------------------------- Acreditação
  entry("accreditation.accredited", "Emitido sob acreditação?", "Acreditação", "boolean", "builder: shouldRenderAccreditationSeal(...) @ emissão (vigência #647)", true, "bool-br"),
  entry("accreditation.numberFormatted", "Nº de acreditação (CAL)", "Acreditação", "text", "builder: formatAccreditationNumber(organization.accreditation_number)", false),
  entry("accreditation.body", "Organismo de acreditação", "Acreditação", "text", "organization.accreditation_body", false),
  // ------------------------------------------------------------------ Método
  entry("method.name", "Nome do método", "Método", "text", "method_snapshot.methodName", true),
  entry("method.version", "Versão do método", "Método", "number", "method_snapshot.methodVersion", true, "number-br"),
  entry("method.procedureCode", "Código do procedimento", "Método", "text", "method_snapshot.certificateContent.procedureCode", false),
  entry("method.referenceStandardsText", "Normas de referência (texto)", "Método", "text", "builder: certificateContent.referenceStandards.join(' e ')", false),
  // ------------------------------------------------- Condições ambientais
  entry("environment.temperatureText", "Temperatura (texto)", "Condições ambientais", "text", "environmental_snapshot.temperature + ºC", false),
  entry("environment.relativeHumidityText", "Umidade relativa (texto)", "Condições ambientais", "text", "environmental_snapshot.humidity + %", false),
  entry("environment.pressureText", "Pressão (texto)", "Condições ambientais", "text", "environmental_snapshot.pressure + hPa", false),
  entry("environment.recordedBy", "Registrado por", "Condições ambientais", "text", "environmental_snapshot.recordedBy", false),
  entry("environment.withinLimits", "Dentro dos limites?", "Condições ambientais", "boolean", "environmental_snapshot.withinLimits", false, "bool-br"),
  // --------------------------------------------------------------- Incerteza
  entry("uncertainty.expanded.value", "Incerteza expandida (U)", "Incerteza", "number", "results row role=expanded_uncertainty (frozen calibration_job.results)", false, "number-br"),
  entry("uncertainty.expanded.unit", "Unidade da incerteza", "Incerteza", "text", "results row role=expanded_uncertainty .unit", false),
  entry("uncertainty.coverageFactor.value", "Fator de abrangência (k)", "Incerteza", "number", "results row role=coverage_factor (frozen calibration_job.results)", false, "number-br"),
  // --------------------------------------------------------------- Aprovação
  entry("approval.approvedBy.name", "Aprovado por", "Aprovação", "text", "user.name via calibration_job.approved_by", true),
  // -------------------------------------------------------- Ordem de serviço
  entry("serviceOrder.inmetroRepairMarkNumber", "Nº da Marca de Reparo (Inmetro)", "Ordem de serviço", "text", "service_order.inmetro_repair_mark_number (via certificate link)", false),
] as const;

const catalogByPath = new Map(PLACEHOLDER_CATALOG.map((e) => [e.path, e]));

// Defense in depth: the catalog itself must never grow a banned entry.
for (const banned of BANNED_PLACEHOLDER_SEGMENTS) {
  for (const { path } of PLACEHOLDER_CATALOG) {
    if (path.split(".").includes(banned)) {
      throw new Error(
        `PLACEHOLDER_CATALOG contains banned path "${path}" (ISO/IEC 17025 §7.8.4.3)`,
      );
    }
  }
}

export function getPlaceholderEntry(path: string): PlaceholderCatalogEntry | undefined {
  return catalogByPath.get(path);
}

export class UnknownPlaceholderError extends Error {
  readonly paths: readonly string[];
  constructor(paths: readonly string[]) {
    super(`unknown placeholder path(s): ${paths.join(", ")}`);
    this.name = "UnknownPlaceholderError";
    this.paths = paths;
  }
}

export class MissingRequiredPlaceholderError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(
      `required placeholder "${path}" resolved to no value in the certificate input data`,
    );
    this.name = "MissingRequiredPlaceholderError";
    this.path = path;
  }
}

/**
 * Template-time validation: every placeholder used by the document must exist
 * in the catalog. Returns the offending paths (empty = valid). Used by draft
 * save, publish, and as the compiler's first step.
 */
export function findUnknownPlaceholderPaths(document: CertificateDocument): string[] {
  const unknown = new Set<string>();
  for (const path of collectPlaceholderPaths(document)) {
    if (!catalogByPath.has(path)) unknown.add(path);
  }
  return [...unknown];
}

function getByPath(data: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = data;
  for (const segment of path.split(".")) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") {
      return undefined;
    }
    cursor = Reflect.get(cursor, segment);
  }
  return cursor;
}

/**
 * Render-time resolution of one placeholder against the frozen input data.
 * Fail-loud on required-but-missing (ADR-2 rule 3 / spec 02 §2).
 */
export function resolvePlaceholder(
  data: Record<string, unknown>,
  path: string,
): string {
  const catalogEntry = catalogByPath.get(path);
  if (!catalogEntry) throw new UnknownPlaceholderError([path]);
  const value = getByPath(data, path);
  if (value === undefined || value === null || value === "") {
    if (catalogEntry.required) throw new MissingRequiredPlaceholderError(path);
    return "";
  }
  return applyPlaceholderFormat(catalogEntry.format, value);
}
