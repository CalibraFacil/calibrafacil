import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildLocalCertificateDraftPdfPath,
  getLatestLocalCertificateDraft,
  getLocalJobDetail,
  saveLocalCertificateDraftPdf,
  type LocalCertificateDraft,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";

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
  void config;
  const job = getLocalJobDetail(database, routeId);
  if (!job) {
    throw new Error("Job nao encontrado");
  }

  // The XLSX template this message used to name no longer exists (#865): the
  // lab-authored path was removed and the fixed system layouts are not wired
  // yet. Telling an operator to publish a template would send them looking for
  // a screen that is gone, so say what is actually true.
  throw new Error(
    "Rascunho local de certificado indisponivel: o layout do certificado esta em redesenho e nenhum certificado pode ser emitido no momento.",
  );
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toSafeFileName(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "certificado"
  );
}
