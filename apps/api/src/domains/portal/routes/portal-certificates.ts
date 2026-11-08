// The portal's certificates: list, detail, download and the reference standards' certificate documents.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import { CERTIFICATE_ISSUED_JOB_STATUSES } from "@calibra-facil/schemas";
import { requirePortalLabScope } from "../portal-lab-scope";
import {
  organization,
  calibrationJob,
  calibrationMethod,
  asset,
  service,
  referenceStandardCertificateDocument,
} from "@calibra-facil/db/schema";
import { portalCertificateEndpoints } from "@calibra-facil/contracts";
import { eq, and, inArray, desc, count, ilike, or, sql } from "drizzle-orm";
import { normalizeAccreditationNumber } from "@calibra-facil/shared";
import {
  issuedSealOf,
  loadFrozenSeal,
  createPortalAmendmentChainLoader,
  resolvePortalAmendmentInfo,
  loadCertificateLifecycles,
  withdrawalOf,
} from "../../jobs";
import { isRecord } from "@calibra-facil/shared/record";
import { finalizedStandardCertificateDocument } from "@calibra-facil/db/standard-certificate-documents";
import { isPendingObjectKey } from "@calibra-facil/shared/storage-keys";
import {
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  attachmentDisposition,
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  type R2Env,
} from "../../../lib/storage";
import {
  applyPortalCertificateReleaseGate,
  loadPortalReleaseStatuses,
} from "../portal-certificate-release-gate";
import { buildPortalCertificateVerdict } from "../portal-certificate-verdict";
import { resolvePortalAccessibleCustomers } from "../portal-customer-scope";
import { orgSetDb } from "../../../lib/org-db";
import { conflict, invalid, notFound } from "../../../lib/domain-errors";
import type { OrgDb } from "@calibra-facil/db/for-org";

/**
 * Resolve a `/certificates/:id` URL param to a Drizzle predicate. Customers see
 * the human-readable certificate number (`jobId`, e.g. `CAL-2026-9001`) in the
 * URL rather than the sequential database id, but older links carrying the
 * numeric id keep resolving. `jobId` is unique within a lab and every portal
 * query is already scoped to the customer's lab, so there is no cross-lab clash.
 */
function matchPortalCertificateParam(rawParam: string) {
  const numericId = Number(rawParam);
  return Number.isInteger(numericId) && numericId > 0
    ? eq(calibrationJob.id, numericId)
    : eq(calibrationJob.jobId, rawParam);
}

type PortalReferenceStandardDocument = {
  documentId: number;
  r2Key: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  uploadedAt: string | Date;
  certificateNumber: string;
  calibrationDate: string | Date;
  nextCalibrationDate: string | Date;
};

type PortalReferenceStandardSnapshot = {
  id: number;
  name: string;
  type?: string | null;
  certificateNumber: string;
  calibratedBy?: string | null;
  calibrationDate: string | Date;
  nextCalibrationDate: string | Date | null;
  certificateDocument?: PortalReferenceStandardDocument | null;
};

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePortalDocument(
  value: unknown,
): PortalReferenceStandardDocument | null {
  if (!isRecord(value)) return null;
  const documentId = getNumber(value.documentId);
  const r2Key = getString(value.r2Key);
  const fileName = getString(value.fileName);
  const fileSize = getNumber(value.fileSize);
  const sha256 = getString(value.sha256);
  const certificateNumber = getString(value.certificateNumber);
  const calibrationDate =
    getString(value.calibrationDate) ??
    (value.calibrationDate instanceof Date ? value.calibrationDate : null);
  const nextCalibrationDate =
    getString(value.nextCalibrationDate) ??
    (value.nextCalibrationDate instanceof Date
      ? value.nextCalibrationDate
      : null);
  const uploadedAt =
    getString(value.uploadedAt) ??
    (value.uploadedAt instanceof Date ? value.uploadedAt : null);

  if (
    documentId === null ||
    !r2Key ||
    isPendingObjectKey(r2Key) ||
    !fileName ||
    fileSize === null ||
    !sha256 ||
    !certificateNumber ||
    !calibrationDate ||
    !nextCalibrationDate ||
    !uploadedAt
  ) {
    return null;
  }

  return {
    documentId,
    r2Key,
    fileName,
    fileSize,
    sha256,
    uploadedAt,
    certificateNumber,
    calibrationDate,
    nextCalibrationDate,
  };
}

function normalizePortalReferenceStandards(
  value: unknown,
): PortalReferenceStandardSnapshot[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = getNumber(item.id);
    const name = getString(item.name);
    const certificateNumber = getString(item.certificateNumber);
    const calibrationDate =
      getString(item.calibrationDate) ??
      (item.calibrationDate instanceof Date ? item.calibrationDate : null);
    const nextCalibrationDate =
      getString(item.nextCalibrationDate) ??
      (item.nextCalibrationDate instanceof Date
        ? item.nextCalibrationDate
        : null);

    if (id === null || !name || !certificateNumber || !calibrationDate) {
      return [];
    }

    return [
      {
        id,
        name,
        type: getString(item.type),
        certificateNumber,
        calibratedBy: getString(item.calibratedBy),
        calibrationDate,
        nextCalibrationDate,
        certificateDocument: normalizePortalDocument(item.certificateDocument),
      },
    ];
  });
}

function portalStandardDocumentResponse(
  document: typeof referenceStandardCertificateDocument.$inferSelect,
): PortalReferenceStandardDocument {
  return {
    documentId: document.id,
    r2Key: document.r2Key,
    fileName: document.fileName,
    fileSize: document.fileSize,
    sha256: document.sha256,
    uploadedAt: document.uploadedAt,
    certificateNumber: document.certificateNumber,
    calibrationDate: document.calibrationDate,
    nextCalibrationDate: document.nextCalibrationDate,
  };
}

async function withMatchingPortalStandardDocuments(
  o: Pick<OrgDb, "select">,
  referenceStandards: PortalReferenceStandardSnapshot[],
): Promise<PortalReferenceStandardSnapshot[]> {
  const missingDocumentStandards = referenceStandards.filter(
    (standard) => !standard.certificateDocument,
  );

  if (missingDocumentStandards.length === 0) {
    return referenceStandards;
  }

  const conditions = missingDocumentStandards.map((standard) =>
    and(
      eq(referenceStandardCertificateDocument.standardId, standard.id),
      eq(referenceStandardCertificateDocument.isCurrent, true),
      eq(
        referenceStandardCertificateDocument.certificateNumber,
        standard.certificateNumber,
      ),
      finalizedStandardCertificateDocument(),
    ),
  );

  const documents = await o
    .select()
    .from(referenceStandardCertificateDocument)
    .where(or(...conditions))
    .orderBy(
      desc(referenceStandardCertificateDocument.isCurrent),
      desc(referenceStandardCertificateDocument.uploadedAt),
    );

  const documentsByKey = new Map<string, PortalReferenceStandardDocument>();
  for (const document of documents) {
    const key = `${document.standardId}:${document.certificateNumber}`;
    if (!documentsByKey.has(key)) {
      documentsByKey.set(key, portalStandardDocumentResponse(document));
    }
  }

  return referenceStandards.map((standard) => {
    if (standard.certificateDocument) return standard;
    return {
      ...standard,
      certificateDocument:
        documentsByKey.get(`${standard.id}:${standard.certificateNumber}`) ??
        null,
    };
  });
}

function sanitizeCertificateFilename(value: string) {
  const sanitized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return sanitized || "certificado";
}

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalCertificatesRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// GET /certificates - List certificates for portal user
// =========================================================================
// Returns approved calibration jobs (certificates) for the authenticated
// portal user's organizations.
// =========================================================================
mount(
  portalCertificatesRouter,
  PREFIX,
  portalCertificateEndpoints.list,
  [...requirePortalProtected],
  async (c, { query }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);

    // Pagination: the contract coerces the numbers, the bounds are the route's.
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = query.query?.trim();
    const { dateFrom, dateTo } = query;

    // Per-instrument archive: scope the certificate list to one asset.
    // Tenant safety is unchanged — the customerIds condition below still
    // applies, so a foreign assetId just yields an empty page.
    const assetId = query.assetId || undefined;

    // All customers this user can access (direct branch orgs + group orgs).
    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }

    const o = orgSetDb(labOrganizationIds);

    const approvedAtPortalDate = sql`(${calibrationJob.approvedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date`;

    // Superseded originals stay listed (ISO 17025 §7.8.8 — the customer
    // must be able to tell them apart, not lose them), flagged below.
    const whereCondition = and(
      inArray(calibrationJob.customerId, customerIds),
      inArray(calibrationJob.status, CERTIFICATE_ISSUED_JOB_STATUSES),
      assetId !== undefined ? eq(calibrationJob.assetId, assetId) : undefined,
      search
        ? or(
            ilike(calibrationJob.jobId, `%${search}%`),
            ilike(calibrationJob.certificateName, `%${search}%`),
            ilike(asset.name, `%${search}%`),
            ilike(asset.tag, `%${search}%`),
            ilike(asset.serialNumber, `%${search}%`),
            ilike(asset.manufacturer, `%${search}%`),
            ilike(service.name, `%${search}%`),
          )
        : undefined,
      dateFrom ? sql`${approvedAtPortalDate} >= ${dateFrom}` : undefined,
      dateTo ? sql`${approvedAtPortalDate} <= ${dateTo}` : undefined,
    );

    const [totalResult] = await o
      .select({ count: count() })
      .from(calibrationJob)
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .where(whereCondition);

    const total = totalResult?.count ?? 0;

    const certificatesRaw = await o
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        certificateName: calibrationJob.certificateName,
        status: calibrationJob.status,
        performedAt: calibrationJob.performedAt,
        approvedAt: calibrationJob.approvedAt,
        certificateUrl: calibrationJob.certificateUrl,
        verificationToken: calibrationJob.verificationToken,
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        assetId: calibrationJob.assetId,
        assetPublicId: asset.publicId,
        assetName: asset.name,
        assetTag: asset.tag,
        assetManufacturer: asset.manufacturer,
        assetModel: asset.model,
        assetSerialNumber: asset.serialNumber,
        serviceName: service.name,
        labName: organization.name,
      })
      .from(calibrationJob)
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .innerJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .where(whereCondition)
      .orderBy(desc(calibrationJob.approvedAt))
      .limit(limit)
      .offset(offset);

    // Hide certificateUrl for held releases.
    const gatedCertificates = await applyPortalCertificateReleaseGate(
      certificatesRaw,
      labOrganizationIds,
    );

    // Amendment chips (§7.8.8) — derived from the row's own links, same
    // semantics as the public verification page: superseded reads as
    // superseded even while its replacement is still in DRAFT.
    // The lifecycle (ISSUED / SUPERSEDED / WITHDRAWN) is the latest row of
    // the certificate's append-only status stream: an original whose
    // amendment is still in progress is ISSUED and stays valid.
    const lifecycles = await loadCertificateLifecycles(
      o,
      gatedCertificates.map((row) => ({
        id: row.id,
        supersededById: row.supersededById,
      })),
    );
    const certificates = gatedCertificates.map((row) => {
      const lifecycle = lifecycles.get(row.id);
      return {
        ...row,
        certificateStatus: lifecycle?.status ?? "ISSUED",
        withdrawnAt: withdrawalOf(lifecycle)?.withdrawnAt.toISOString() ?? null,
        isSuperseded:
          row.supersededById !== null || row.status === "SUPERSEDED",
        isAmendment: row.supersedesId !== null,
        supersedesId: undefined,
        supersededById: undefined,
      };
    });

    return {
      data: certificates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },
);

mount(
  portalCertificatesRouter,
  PREFIX,
  portalCertificateEndpoints.get,
  [...requirePortalProtected],
  async (c, { params }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);
    const certificateParam = params.id;

    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const o = orgSetDb(labOrganizationIds);

    const [certificate] = await o
      .select({
        id: calibrationJob.id,
        organizationId: calibrationJob.organizationId,
        jobId: calibrationJob.jobId,
        status: calibrationJob.status,
        performedAt: calibrationJob.performedAt,
        approvedAt: calibrationJob.approvedAt,
        dueDate: calibrationJob.dueDate,
        certificateUrl: calibrationJob.certificateUrl,
        verificationToken: calibrationJob.verificationToken,
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        amendmentReason: calibrationJob.amendmentReason,
        supersededAt: calibrationJob.supersededAt,
        methodSnapshot: calibrationJob.methodSnapshot,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        calibrationLocationSnapshot: calibrationJob.calibrationLocationSnapshot,
        results: calibrationJob.results,
        assetId: calibrationJob.assetId,
        assetPublicId: asset.publicId,
        assetName: asset.name,
        assetTag: asset.tag,
        assetManufacturer: asset.manufacturer,
        assetModel: asset.model,
        assetSerialNumber: asset.serialNumber,
        serviceName: service.name,
        labName: organization.name,
        labLogo: organization.logo,
        labEmail: organization.email,
        labPhone: organization.phone,
        // Accreditation seal - frozen method flag with current-method fallback
        scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
        serviceMethodAccreditedScope: calibrationMethod.accreditedScope,
        labAccreditationActive: organization.accreditationActive,
        labAccreditationNumber: organization.accreditationNumber,
        labAccreditationValidFrom: organization.accreditationValidFrom,
        labAccreditationValidUntil: organization.accreditationValidUntil,
      })
      .from(calibrationJob)
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .innerJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .leftJoin(calibrationMethod, eq(service.methodId, calibrationMethod.id))
      .where(
        and(
          matchPortalCertificateParam(certificateParam),
          inArray(calibrationJob.customerId, customerIds),
          // Superseded originals stay reachable (§7.8.8) — flagged below.
          inArray(calibrationJob.status, CERTIFICATE_ISSUED_JOB_STATUSES),
        ),
      )
      .limit(1);

    if (!certificate) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const referenceStandards = await withMatchingPortalStandardDocuments(
      o,
      normalizePortalReferenceStandards(certificate.standardsSnapshot),
    );

    // Hide certificateUrl when the release is held.
    const [gated] = await applyPortalCertificateReleaseGate(
      [certificate],
      labOrganizationIds,
    );
    const releaseStatus = gated?.releaseStatus ?? "RELEASED";
    const lifecycle = (
      await loadCertificateLifecycles(o, [
        { id: certificate.id, supersededById: certificate.supersededById },
      ])
    ).get(certificate.id);

    // The seal is the decision frozen at approval; only a record
    // approved before it was frozen falls back to the rule it was issued
    // under (vigência at EMISSION).
    const frozen = await loadFrozenSeal(o, {
      id: certificate.id,
      organizationId: certificate.organizationId,
    });
    const { accredited, accreditationNumber } = issuedSealOf({
      frozenSeal: frozen.frozenSeal,
      frozenAccreditationNumber: frozen.frozenAccreditationNumber,
      legacy: {
        lab: {
          accreditationActive: certificate.labAccreditationActive,
          accreditationNumber: certificate.labAccreditationNumber,
          accreditationValidFrom: certificate.labAccreditationValidFrom,
          accreditationValidUntil: certificate.labAccreditationValidUntil,
        },
        methodAccreditedScope:
          certificate.methodSnapshot?.accreditedScope ??
          certificate.serviceMethodAccreditedScope ??
          false,
        scopeOverrideJustification: certificate.scopeOverrideJustification,
        ...(certificate.approvedAt ? { atDate: certificate.approvedAt } : {}),
      },
    });

    const verdict = buildPortalCertificateVerdict({
      results: certificate.results,
      formulas: certificate.methodSnapshot?.formulas,
    });

    // Amendment chain (§7.8.8): links only surface once the neighbour is
    // itself terminal — same gate as the public verification page. The
    // chain carries ids/jobIds only, so a held replacement leaks no
    // download URL through the banner.
    const amendment = await resolvePortalAmendmentInfo(
      {
        id: certificate.id,
        jobId: certificate.jobId,
        status: certificate.status,
        supersedesId: certificate.supersedesId,
        supersededById: certificate.supersededById,
        amendmentNumber: certificate.amendmentNumber,
        amendmentReason: certificate.amendmentReason,
        approvedAt: certificate.approvedAt,
        supersededAt: certificate.supersededAt,
      },
      createPortalAmendmentChainLoader({
        customerIds,
        organizationIds: labOrganizationIds,
      }),
    );

    // Surface where the calibration was performed (frozen at execution).
    const locationSnapshot = certificate.calibrationLocationSnapshot;
    const onSite = {
      executedOnSite: locationSnapshot?.type === "customer_site",
      addressText: locationSnapshot?.addressText?.trim() || null,
    };

    // Held back from the client (and dropped by JSON): the keys set to
    // `undefined` below, so the contract is checked on the object as a whole.
    const body = {
      ...certificate,
      certificateUrl:
        releaseStatus === "PAYMENT_PENDING" ? null : certificate.certificateUrl,
      releaseStatus,
      certificateStatus: lifecycle?.status ?? "ISSUED",
      withdrawnAt: withdrawalOf(lifecycle)?.withdrawnAt.toISOString() ?? null,
      verdict,
      onSite,
      amendment,
      supersedesId: undefined,
      supersededById: undefined,
      amendmentNumber: undefined,
      amendmentReason: undefined,
      supersededAt: undefined,
      standardsSnapshot: undefined,
      calibrationLocationSnapshot: undefined,
      referenceStandards,
      accreditation: {
        accredited,
        number: accredited
          ? normalizeAccreditationNumber(accreditationNumber ?? "")
          : null,
      },
      serviceMethodAccreditedScope: undefined,
      labAccreditationActive: undefined,
      labAccreditationNumber: undefined,
      labAccreditationValidFrom: undefined,
      labAccreditationValidUntil: undefined,
      frozenSeal: undefined,
      frozenAccreditationNumber: undefined,
      // Internal release-gate detail; the customer only sees `accredited`.
      scopeOverrideJustification: undefined,
    };
    return body;
  },
);

mount(
  portalCertificatesRouter,
  PREFIX,
  portalCertificateEndpoints.download,
  [...requirePortalProtected],
  async (c, { params }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);
    const certificateParam = params.id;

    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const o = orgSetDb(labOrganizationIds);

    // Get certificate. Superseded originals stay downloadable — auditors
    // need the historical document (§7.8.8 keeps it identified, not gone).
    const [certificate] = await o
      .select({
        id: calibrationJob.id,
        certificateUrl: calibrationJob.certificateUrl,
        jobId: calibrationJob.jobId,
        certificateName: calibrationJob.certificateName,
      })
      .from(calibrationJob)
      .where(
        and(
          matchPortalCertificateParam(certificateParam),
          inArray(calibrationJob.customerId, customerIds),
          inArray(calibrationJob.status, CERTIFICATE_ISSUED_JOB_STATUSES),
        ),
      )
      .limit(1);

    if (!certificate) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    // Deny download when the release is held for billing
    // or for payment. Customer-facing copy is provider-neutral.
    const releaseStatuses = await loadPortalReleaseStatuses({
      organizationId: labOrganizationIds,
      calibrationJobIds: [certificate.id],
    });
    const portalReleaseStatus =
      releaseStatuses.get(certificate.id) ?? "RELEASED";
    if (portalReleaseStatus === "PAYMENT_PENDING") {
      throw conflict(
        "certificate_payment_pending",
        "Certificado aguardando confirmação financeira",
      );
    }

    if (!certificate.certificateUrl) {
      throw invalid("certificate_not_ready", "Documento ainda nao disponivel");
    }

    const env = c.env;
    const key = extractKeyFromUrl(certificate.certificateUrl);
    const client = createR2Client(env);
    const filename = `${sanitizeCertificateFilename(certificate.certificateName || `certificado-${certificate.jobId}`)}.pdf`;
    const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key, {
      responseContentDisposition: attachmentDisposition(filename),
    });

    return {
      url,
      filename,
    };
  },
);

mount(
  portalCertificatesRouter,
  PREFIX,
  portalCertificateEndpoints.referenceStandardDownload,
  [...requirePortalProtected],
  async (c, { params }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);
    const certificateParam = params.id;
    const standardId = parseInt(params.standardId);

    if (isNaN(standardId)) {
      throw invalid("invalid_request", "ID invalido");
    }

    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const o = orgSetDb(labOrganizationIds);

    const [certificate] = await o
      .select({
        standardsSnapshot: calibrationJob.standardsSnapshot,
      })
      .from(calibrationJob)
      .where(
        and(
          matchPortalCertificateParam(certificateParam),
          inArray(calibrationJob.customerId, customerIds),
          inArray(calibrationJob.status, CERTIFICATE_ISSUED_JOB_STATUSES),
        ),
      )
      .limit(1);

    if (!certificate) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const standard = normalizePortalReferenceStandards(
      certificate.standardsSnapshot,
    ).find((item) => item.id === standardId);

    if (!standard) {
      throw notFound("standard_not_found", "Padrão não encontrado");
    }

    let document = standard.certificateDocument;
    if (!document) {
      const [matchingDocument] = await o
        .select()
        .from(referenceStandardCertificateDocument)
        .where(
          and(
            eq(referenceStandardCertificateDocument.standardId, standardId),
            eq(referenceStandardCertificateDocument.isCurrent, true),
            eq(
              referenceStandardCertificateDocument.certificateNumber,
              standard.certificateNumber,
            ),
            finalizedStandardCertificateDocument(),
          ),
        )
        .orderBy(
          desc(referenceStandardCertificateDocument.isCurrent),
          desc(referenceStandardCertificateDocument.uploadedAt),
        )
        .limit(1);

      document = matchingDocument
        ? portalStandardDocumentResponse(matchingDocument)
        : null;
    }

    if (!document) {
      throw notFound(
        "standard_certificate_not_available",
        "Certificado do padrão não disponível",
      );
    }

    const env = c.env;
    const client = createR2Client(env);
    const url = await generatePresignedUrl(
      client,
      env.R2_BUCKET_NAME,
      document.r2Key,
    );

    return {
      url,
      filename: document.fileName,
    };
  },
);
