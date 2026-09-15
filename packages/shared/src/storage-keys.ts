/**
 * Centralized Cloudflare R2 object-storage key + bucket logic.
 *
 * This is the single source of truth for how object keys are built and which
 * logical bucket each kind of object lives in. Both `apps/api` and `apps/worker`
 * import from here so the read side, the write side, and the backfill migration
 * all agree on the exact same scheme.
 *
 * The module is intentionally pure: builders take every variable part as an
 * argument (timestamps, uuids) instead of calling `Date.now()`/`randomUUID()`,
 * so they are deterministic and unit-testable. It pulls in no AWS SDK and reads
 * no environment — callers resolve the concrete bucket name from the logical
 * `StorageBucket` (see `resolveBucketName` in `apps/api/src/lib/storage.ts`).
 *
 * Layout overview:
 *   documents bucket  org/{slug}-{id}/{year}/jobs/{jobId}/issued/{issuedId}/{descriptive}.pdf|.xlsx
 *                     org/{slug}-{id}/{year}/jobs/{jobId}/label.pdf
 *                     org/{slug}-{id}/{year}/jobs/{jobId}/desktop-{draftId}.pdf
 *                     org/{slug}-{id}/{year}/{month}/service-orders/{number}/...
 *                     org/{slug}-{id}/standards/{stdId}/certificates/{docId}-{file}
 *                     org/{slug}-{id}/sync-attachments/{entityType}/{entityId}/{file}
 *   media bucket      organization-logos/{slug}-{id}/{ts}-{uuid}
 *                     signatures/{slug}-{id}/{memberId}.png
 *                     avatars/{userId}
 */

/** Logical storage buckets. Concrete names are resolved per-app from env. */
export type StorageBucket = "documents" | "media";

/** A fully-resolved storage location: which logical bucket + the object key. */
export interface StorageObject {
  bucket: StorageBucket;
  key: string;
}

/** Categories of stored objects, used to decide the logical bucket. */
export type StorageCategory =
  | "ISSUED_CERTIFICATE"
  | "SERVICE_ORDER_DOC"
  | "JOB_LABEL"
  | "DESKTOP_CERTIFICATE"
  | "STANDARD_DOC"
  | "SYNC_ATTACHMENT"
  | "PORTAL_EXPORT"
  | "OOT_NOTIFICATION"
  | "ORG_LOGO"
  | "SIGNATURE"
  | "AVATAR"
  | "BRANDING_LOGO";

/**
 * Map an object category to its logical bucket. This single function is where
 * the two-bucket vs one-bucket decision lives — return "documents" everywhere
 * to collapse back to a single bucket.
 */
export function bucketFor(category: StorageCategory): StorageBucket {
  switch (category) {
    case "ORG_LOGO":
    case "SIGNATURE":
    case "AVATAR":
    case "BRANDING_LOGO":
      return "media";
    case "ISSUED_CERTIFICATE":
    case "SERVICE_ORDER_DOC":
    case "JOB_LABEL":
    case "DESKTOP_CERTIFICATE":
    case "STANDARD_DOC":
    case "SYNC_ATTACHMENT":
    case "PORTAL_EXPORT":
    case "OOT_NOTIFICATION":
      return "documents";
  }
}

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

/**
 * Encode an opaque key part that must round-trip (org id, job id, issued id).
 * Throws on empty input so we never silently build a malformed key.
 */
export function encodeKeyPart(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`R2 key part "${label}" is empty`);
  }
  return encodeURIComponent(trimmed);
}

/**
 * Sanitize a free-form path segment (sync entity ids, file identities). Mirrors
 * the previous `safeR2Segment` in sync.ts: keeps alphanumerics/`._-`, collapses
 * the rest to `-`, and falls back to "local" when nothing survives.
 */
export function safeR2Segment(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local"
  );
}

/**
 * Slugify a human-facing string for use inside a descriptive filename or the
 * readable org prefix (company name, asset tag, brand, org slug).
 */
export function slugify(value: string, maxLength = 40): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

type Dateish = Date | string | null | undefined;

function coerceUtcDate(value: Dateish, label: string): Date {
  if (!value) {
    throw new Error(`Missing ${label} for R2 key date`);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label} for R2 key date`);
    }
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${label} for R2 key date`);
  }
  // Normalize "YYYY-MM-DD HH:MM:SS" (Postgres-style) to ISO so Date parses UTC.
  const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label} for R2 key date`);
  }
  return parsed;
}

/** Year (UTC) from a Date or date-ish string. Throws on missing/invalid input. */
export function getYear(value: Dateish, label: string): number {
  return coerceUtcDate(value, label).getUTCFullYear();
}

/** Year + zero-padded month (UTC) from a Date or date-ish string. */
export function getYearMonth(
  value: Dateish,
  label: string,
): { year: number; month: string } {
  const date = coerceUtcDate(value, label);
  return {
    year: date.getUTCFullYear(),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
  };
}

// ---------------------------------------------------------------------------
// Org partition (stable opaque id + readable slug prefix)
// ---------------------------------------------------------------------------

/** The two stable identifiers needed to build an org-scoped key. */
export interface OrgRef {
  id: string;
  slug: string;
}

/**
 * Readable-but-stable org partition: `{slug}-{id}`. The id remains the real,
 * unique, path-safe partition; the slug is a cosmetic prefix for browsability.
 * If the slug is empty/unusable we fall back to the id alone.
 */
export function orgPartition(org: OrgRef): string {
  const id = encodeKeyPart("orgId", org.id);
  const slug = slugify(org.slug);
  return slug ? `${slug}-${id}` : id;
}

// ---------------------------------------------------------------------------
// Descriptive certificate filename
// ---------------------------------------------------------------------------

export interface CertificateDescriptor {
  /** Human certificate number (e.g. "CAL-2026-9001"); fall back to job id. */
  certNumber: string;
  year: number;
  companyName?: string | null;
  assetTag?: string | null;
  /** Equipment manufacturer / brand. */
  brand?: string | null;
}

function descriptiveCertificateFilename(
  descriptor: CertificateDescriptor,
  extension: "pdf" | "xlsx" | "html",
): string {
  const segments = [
    slugify(descriptor.certNumber),
    String(descriptor.year),
    descriptor.companyName ? slugify(descriptor.companyName) : null,
    descriptor.assetTag ? slugify(descriptor.assetTag) : null,
    descriptor.brand ? slugify(descriptor.brand) : null,
  ].filter((part): part is string => Boolean(part));
  const base = segments.join("-") || "certificado";
  return `${base}.${extension}`;
}

// ---------------------------------------------------------------------------
// Key builders — documents bucket
// ---------------------------------------------------------------------------

export interface IssuedCertificateKeyParams extends CertificateDescriptor {
  org: OrgRef;
  jobId: string;
  issuedId: string;
}

function issuedCertificateKey(
  params: IssuedCertificateKeyParams,
  extension: "pdf" | "xlsx" | "html",
): StorageObject {
  const part = orgPartition(params.org);
  const jobId = encodeKeyPart("jobId", params.jobId);
  const issuedId = encodeKeyPart("issuedId", params.issuedId);
  const filename = descriptiveCertificateFilename(params, extension);
  return {
    bucket: bucketFor("ISSUED_CERTIFICATE"),
    key: `org/${part}/${params.year}/jobs/${jobId}/issued/${issuedId}/${filename}`,
  };
}

export function issuedCertificatePdfKey(
  params: IssuedCertificateKeyParams,
): StorageObject {
  return issuedCertificateKey(params, "pdf");
}

export interface JobLabelKeyParams {
  org: OrgRef;
  jobId: string;
  year: number;
}

export function jobLabelKey(params: JobLabelKeyParams): StorageObject {
  const part = orgPartition(params.org);
  const jobId = encodeKeyPart("jobId", params.jobId);
  return {
    bucket: bucketFor("JOB_LABEL"),
    key: `org/${part}/${params.year}/jobs/${jobId}/label.pdf`,
  };
}

export interface DesktopCertificateKeyParams {
  org: OrgRef;
  jobId: string;
  year: number;
  draftId: string;
}

export function desktopCertificatePdfKey(
  params: DesktopCertificateKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  return {
    bucket: bucketFor("DESKTOP_CERTIFICATE"),
    key: `org/${part}/${params.year}/jobs/${safeR2Segment(params.jobId)}/desktop-${safeR2Segment(params.draftId)}.pdf`,
  };
}

export interface ServiceOrderDocKeyParams {
  org: OrgRef;
  serviceOrderNumber: string;
  year: number;
  month: string;
  type: "INTAKE" | "TAG" | "QUOTE" | "DELIVERY";
  version?: number;
  tagNumber?: string;
  quoteNumber?: string;
}

export function serviceOrderDocKey(
  params: ServiceOrderDocKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  const number = encodeKeyPart("serviceOrderNumber", params.serviceOrderNumber);
  const base = `org/${part}/${params.year}/${params.month}/service-orders/${number}`;
  const version = params.version ?? 1;
  let suffix: string;
  if (params.type === "INTAKE") {
    suffix = `intake-v${version}.pdf`;
  } else if (params.type === "DELIVERY") {
    suffix = `delivery-v${version}.pdf`;
  } else if (params.type === "TAG") {
    const tag = encodeKeyPart("tagNumber", params.tagNumber ?? "tag");
    suffix = `tag-${tag}.pdf`;
  } else {
    const quote = encodeKeyPart("quoteNumber", params.quoteNumber ?? "quote");
    suffix = `quotes/${quote}-v${version}.pdf`;
  }
  return { bucket: bucketFor("SERVICE_ORDER_DOC"), key: `${base}/${suffix}` };
}

export interface PortalAuditPackKeyParams {
  org: OrgRef;
  exportId: number;
  /** Enqueue date, used only for the descriptive filename. */
  generatedAt: Date;
}

/**
 * Customer-requested audit-pack ZIP (issue #738). Lives under a dedicated
 * `portal-exports/` org sub-prefix so a bucket lifecycle rule can expire these
 * short-lived, regenerate-on-demand objects without touching regulated records.
 */
export function portalAuditPackKey(
  params: PortalAuditPackKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  const date = params.generatedAt.toISOString().slice(0, 10);
  return {
    bucket: bucketFor("PORTAL_EXPORT"),
    key: `org/${part}/portal-exports/${params.exportId}/pacote-auditoria-${date}.zip`,
  };
}

export interface OotNotificationKeyParams {
  org: OrgRef;
  notificationId: number;
  /** NC number for the descriptive filename (e.g. "NC-2026-0012"). */
  ncNumber: string;
  year: number;
}

/**
 * §7.10 out-of-tolerance customer-notification letter (#426 Phase 0). Lives
 * with the other regulated documents — this is retained quality evidence, so
 * it must NOT sit under a lifecycle-expired prefix like portal-exports/.
 */
export function ootNotificationKey(
  params: OotNotificationKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  return {
    bucket: bucketFor("OOT_NOTIFICATION"),
    key: `org/${part}/${params.year}/oot-notifications/${params.notificationId}/notificacao-7-10-${slugify(params.ncNumber)}.pdf`,
  };
}

export interface StandardCertificateKeyParams {
  org: OrgRef;
  standardId: number;
  documentId: number;
  /** Already-sanitized file name (caller sanitizes domain-specifically). */
  fileName: string;
}

export function standardCertificateKey(
  params: StandardCertificateKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  return {
    bucket: bucketFor("STANDARD_DOC"),
    key: `org/${part}/standards/${params.standardId}/certificates/${params.documentId}-${params.fileName}`,
  };
}

export interface SyncAttachmentKeyParams {
  org: OrgRef;
  entityType: string;
  entityId: string;
  /** Pre-built, already-sanitized identity (e.g. hash + event id). */
  fileIdentity: string;
  /** Extension including the leading dot, or "" for none. */
  extension: string;
}

export function syncAttachmentKey(
  params: SyncAttachmentKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  return {
    bucket: bucketFor("SYNC_ATTACHMENT"),
    key: [
      "org",
      part,
      "sync-attachments",
      safeR2Segment(params.entityType),
      safeR2Segment(params.entityId),
      `${params.fileIdentity}${params.extension}`,
    ].join("/"),
  };
}

// ---------------------------------------------------------------------------
// Key builders — media bucket
// ---------------------------------------------------------------------------

export interface OrganizationLogoKeyParams {
  org: OrgRef;
  /** Caller-supplied timestamp (e.g. Date.now()). */
  timestamp: number;
  /** Caller-supplied uuid. */
  uniqueId: string;
}

export function organizationLogoKey(
  params: OrganizationLogoKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  return {
    bucket: bucketFor("ORG_LOGO"),
    key: `${ORGANIZATION_LOGO_KEY_PREFIX}${part}/${params.timestamp}-${params.uniqueId}`,
  };
}

export interface MemberSignatureKeyParams {
  org: OrgRef;
  memberId: string;
}

export function memberSignatureKey(
  params: MemberSignatureKeyParams,
): StorageObject {
  const part = orgPartition(params.org);
  const memberId = encodeKeyPart("memberId", params.memberId);
  return {
    bucket: bucketFor("SIGNATURE"),
    key: `signatures/${part}/${memberId}.png`,
  };
}

export function avatarKey(userId: string): StorageObject {
  return {
    bucket: bucketFor("AVATAR"),
    key: `avatars/${encodeKeyPart("userId", userId)}`,
  };
}

// ---------------------------------------------------------------------------
// Organization logo proxy-URL helpers (shared by api + worker)
// ---------------------------------------------------------------------------

export const ORGANIZATION_LOGO_KEY_PREFIX = "organization-logos/";
export const ORGANIZATION_LOGO_URL_MARKER = "/api/organization-media/logo/";

export function encodeLogoAssetKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeLogoAssetKey(encoded: string): string | null {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return decoded.startsWith(ORGANIZATION_LOGO_KEY_PREFIX) ? decoded : null;
  } catch {
    return null;
  }
}

export function buildOrganizationLogoUrl(key: string, origin: string): string {
  return `${origin}${ORGANIZATION_LOGO_URL_MARKER}${encodeLogoAssetKey(key)}`;
}

export function getLogoKeyFromUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const markerIndex = url.pathname.indexOf(ORGANIZATION_LOGO_URL_MARKER);
    if (markerIndex === -1) return null;
    const encodedKey = url.pathname.slice(
      markerIndex + ORGANIZATION_LOGO_URL_MARKER.length,
    );
    return decodeLogoAssetKey(encodedKey);
  } catch {
    return null;
  }
}
