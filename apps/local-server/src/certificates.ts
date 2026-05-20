import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CertificateHtml, type JobData } from "@calibra-facil/documents";
import {
  buildLocalCertificateDraftPath,
  buildLocalCertificateDraftPdfPath,
  createLocalCertificateDraft,
  getLatestLocalCertificateDraft,
  getLocalJobDetail,
  saveLocalCertificateDraftPdf,
  type LocalCertificateDraft,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";

const LOCAL_CERTIFICATE_DRAFT_LABELS = [
  "Rascunho local",
  "Pendente de sincronização",
  "Não publicado",
] as const;

export type GeneratedLocalCertificateDraft = LocalCertificateDraft & {
  contentType: string;
  fileUrl: string;
  draftKind: "local_certificate_draft";
  published: false;
};

export async function generateLocalCertificateDraft(
  database: LocalDatabase,
  config: LocalServerConfig,
  routeId: string,
): Promise<GeneratedLocalCertificateDraft> {
  const job = getLocalJobDetail(database, routeId);
  if (!job) {
    throw new Error("Job nao encontrado");
  }

  const draftId = `certificate-draft:${randomUUID()}`;
  const localPath = buildLocalCertificateDraftPath(String(job.jobId), draftId);
  const html = renderCertificateDraftHtml(toCertificateJobData(job, config));
  const absolutePath = resolveLocalStoragePath(config.storageRoot, localPath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, html, "utf8");

  try {
    const draft = createLocalCertificateDraft(database, routeId, {
      draftId,
      localPath,
      actorUserId: config.userId,
      deviceId: config.deviceId,
      metadata: {
        contentType: "text/html",
        renderer: "@calibra-facil/documents/CertificateHtml",
      },
    });

    return {
      ...draft,
      contentType: "text/html",
      fileUrl: `/api/jobs/${encodeURIComponent(routeId)}/certificate-draft/file`,
      draftKind: "local_certificate_draft",
      published: false,
    };
  } catch (error) {
    await rm(absolutePath, { force: true });
    throw error;
  }
}

export async function readLocalCertificateDraftFile(
  database: LocalDatabase,
  config: LocalServerConfig,
  routeId: string,
) {
  const draft = getLatestLocalCertificateDraft(database, routeId);
  if (!draft?.localPath) return null;

  const absolutePath = resolveLocalStoragePath(
    config.storageRoot,
    draft.localPath,
  );
  const bytes = await readFile(absolutePath);

  return {
    draft,
    bytes,
    contentType: getContentType(draft),
    fileName: `${toSafeFileName(draft.jobId)}-rascunho-local.html`,
  };
}

export async function storeLocalCertificateDraftPdf(
  database: LocalDatabase,
  config: LocalServerConfig,
  routeId: string,
  draftId: string,
  bytes: Uint8Array,
) {
  const job = getLocalJobDetail(database, routeId);
  if (!job) {
    throw new Error("Job nao encontrado");
  }

  const localPath = buildLocalCertificateDraftPdfPath(
    String(job.jobId),
    draftId,
  );
  const absolutePath = resolveLocalStoragePath(config.storageRoot, localPath);
  const buffer = Buffer.from(bytes);
  const contentHash = createHash("sha256").update(buffer).digest("hex");

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  try {
    const draft = saveLocalCertificateDraftPdf(database, routeId, {
      draftId,
      localPath,
      contentHash,
      sizeBytes: buffer.byteLength,
      actorUserId: config.userId,
      deviceId: config.deviceId,
    });

    if (!draft) {
      throw new Error("Rascunho de certificado local nao encontrado");
    }

    return {
      ...draft,
      contentType: "application/pdf",
      fileUrl: `/api/jobs/${encodeURIComponent(
        routeId,
      )}/certificate-draft/file`,
      draftKind: "local_certificate_draft",
      published: false,
    };
  } catch (error) {
    await rm(absolutePath, { force: true });
    throw error;
  }
}

function renderCertificateDraftHtml(job: JobData) {
  const html = `<!DOCTYPE html>${renderToStaticMarkup(
    createElement(CertificateHtml, { job }),
  )}`;

  return addLocalCertificateDraftBanner(html);
}

function addLocalCertificateDraftBanner(html: string) {
  const labels = LOCAL_CERTIFICATE_DRAFT_LABELS.map(
    (label) => `<span>${label}</span>`,
  ).join("");
  const style = `<style id="local-certificate-draft-style">
.local-certificate-draft-banner {
  box-sizing: border-box;
  margin: 0 0 12px;
  padding: 10px 14px;
  border: 2px solid #991b1b;
  background: #fff7ed;
  color: #7f1d1d;
  font-family: Arial, sans-serif;
  font-size: 10pt;
  font-weight: 700;
  line-height: 1.3;
  text-transform: uppercase;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.local-certificate-draft-banner span {
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 3px 8px;
}
@media print {
  .local-certificate-draft-banner {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    page-break-inside: avoid;
  }
}
</style>`;
  const banner = `<div class="local-certificate-draft-banner" role="note" aria-label="Rascunho de certificado local">${labels}</div>`;

  const withStyle = html.includes("</head>")
    ? html.replace("</head>", `${style}</head>`)
    : `${style}${html}`;

  return withStyle.replace(/<body([^>]*)>/, `<body$1>${banner}`);
}

function toCertificateJobData(
  job: NonNullable<ReturnType<typeof getLocalJobDetail>>,
  config: LocalServerConfig,
): JobData {
  const assetSnapshot = toRecord(job.assetSnapshot);
  const methodSnapshot = toCertificateMethodSnapshot(job.methodSnapshot);
  const environmentalSnapshot = toRecordOrNull(
    job.environmentalSnapshot,
  ) as JobData["environmentalSnapshot"];
  const calibrationLocationSnapshot = toRecordOrNull(
    job.calibrationLocationSnapshot,
  ) as JobData["calibrationLocationSnapshot"];
  const calibrationPhaseSnapshot = toRecordOrNull(
    job.calibrationPhaseSnapshot,
  ) as JobData["calibrationPhaseSnapshot"];

  return {
    jobId: job.jobId,
    certificateName: `Rascunho local - ${job.jobId}`,
    organizationId: config.organizationId,
    unitId: job.unitId,
    performedAt: parseDate(job.updatedAt),
    approvedAt: null,
    environmentalSnapshot,
    calibrationLocationSnapshot,
    calibrationPhaseSnapshot,
    lab: {
      name: config.organizationId ?? "CalibraFacil",
    },
    customer: {
      name: job.customerName || "Cliente",
      taxId: null,
      phone: null,
      email: null,
      address: null,
    },
    asset: {
      name: getString(assetSnapshot, "name") ?? job.assetName,
      serialNumber: getString(assetSnapshot, "serialNumber") ?? "",
      tag: getString(assetSnapshot, "tag") ?? job.assetTag,
      model: getNullableString(assetSnapshot, "model"),
      manufacturer: getNullableString(assetSnapshot, "manufacturer"),
    },
    methodSnapshot,
    assetSnapshot: {
      assetId: getNumber(assetSnapshot, "assetId") ?? Number(job.id),
      assetTypeId:
        getNumber(assetSnapshot, "assetTypeId") ?? Number(job.assetTypeId),
      assetTypeName:
        getString(assetSnapshot, "assetTypeName") ?? job.assetName ?? "Ativo",
      assetTypeSlug: getString(assetSnapshot, "assetTypeSlug") ?? "local",
      baseMeasurementUnit: getNullableString(
        assetSnapshot,
        "baseMeasurementUnit",
      ) as NonNullable<JobData["assetSnapshot"]>["baseMeasurementUnit"],
      name: getString(assetSnapshot, "name") ?? job.assetName,
      tag: getString(assetSnapshot, "tag") ?? job.assetTag,
      serialNumber: getString(assetSnapshot, "serialNumber") ?? "",
      manufacturer: getNullableString(assetSnapshot, "manufacturer"),
      model: getNullableString(assetSnapshot, "model"),
      specifications:
        toRecordOrNull(assetSnapshot["specifications"]) ??
        ({} as Record<string, unknown>),
      capturedAt: getString(assetSnapshot, "capturedAt") ?? job.createdAt,
    },
    standardsSnapshot: Array.isArray(job.standardsSnapshot)
      ? (job.standardsSnapshot as JobData["standardsSnapshot"])
      : null,
    serviceOrder: null,
    data: toRecordOrNull(job.data),
    results: toRecordOrNull(job.results),
    approverName: null,
    certificateTemplateSnapshot: null,
  };
}

function resolveLocalStoragePath(storageRoot: string, localPath: string) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, localPath);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Caminho de certificado local invalido");
  }

  return target;
}

function getContentType(draft: LocalCertificateDraft) {
  const metadata = toRecord(draft.metadata);
  return getString(metadata, "contentType") ?? "text/html";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  const record = toRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function toCertificateMethodSnapshot(
  value: unknown,
): JobData["methodSnapshot"] {
  const methodSnapshot = toRecord(value) as JobData["methodSnapshot"] & {
    formulas?: unknown[];
  };

  return {
    ...methodSnapshot,
    formulas: Array.isArray(methodSnapshot.formulas)
      ? methodSnapshot.formulas.map(toCertificateFormula)
      : [],
  };
}

function toCertificateFormula(value: unknown) {
  const formula = toRecord(value);
  const outputKey =
    getString(formula, "outputKey") ?? getString(formula, "key");

  return {
    ...formula,
    outputKey: outputKey ?? "",
    expression: getString(formula, "expression") ?? "",
    label: getString(formula, "label") ?? outputKey ?? undefined,
    unit:
      getNullableString(formula, "unit") ??
      getNullableString(formula, "outputUnit") ??
      undefined,
  };
}

function getString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function toSafeFileName(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "certificado"
  );
}
