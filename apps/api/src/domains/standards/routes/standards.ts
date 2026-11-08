import { createRouter } from "../../../server/router";
import { createHash, randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import {
  calibrationJob,
  emailSuppression,
  jobStandard,
  massCompositionProfile,
  nonConformance,
  ootNotification,
  organization,
  referenceStandard,
  referenceStandardAuditLog,
  referenceStandardCalibration,
  referenceStandardCertificateDocument,
  standardRecall,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateReferenceStandardSchema,
  UpdateReferenceStandardSchema,
  ListReferenceStandardsQuerySchema,
  RenewCertificateSchema,
  providerAccreditationIssue,
  MassCompositionProfileCreateSchema,
  MassCompositionProfileUpdateSchema,
  ImpactedCertificatesQuerySchema,
  SendStandardRecallSchema,
} from "@calibra-facil/schemas";
import { standardEndpoints } from "@calibra-facil/contracts";
import {
  ensureStandardRecall,
  createStandardRecallNotifications,
  type RecallStandardIdentity,
  findImpactedCertificates,
  findInFlightJobsUsingStandard,
} from "../../jobs";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  eq,
  and,
  or,
  ilike,
  desc,
  count,
  isNull,
  lte,
  gte,
  inArray,
} from "drizzle-orm";
import {
  MASS_PROFILE_MACHINE,
  REFERENCE_STANDARD_MACHINE,
  STANDARD_RECALL_MACHINE,
} from "@calibra-facil/schemas/machines";
import { buildUnitScopeCondition } from "../../../lib/units";
import {
  conflict,
  forbidden,
  invalid,
  notFound,
} from "../../../lib/domain-errors";
import { requireLabStandard, requireLabStandardId } from "../standard-access";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import {
  createR2Client,
  generatePresignedUrl,
  resolveBucketName,
  uploadToR2,
  type R2Env,
} from "../../../lib/storage";
import { standardCertificateKey } from "@calibra-facil/shared/storage-keys";
import {
  addCalendarDays,
  calendarDateKey,
  isCalendarDatePast,
  labDaysUntil,
  labToday,
} from "@calibra-facil/shared";
import { finalizedStandardCertificateDocument } from "@calibra-facil/db/standard-certificate-documents";
import { pendingStandardCertificateKey } from "@calibra-facil/shared/storage-keys";

const MAX_STANDARD_CERTIFICATE_FILE_SIZE = 25 * 1024 * 1024;
const STANDARD_CERTIFICATE_CONTENT_TYPE = "application/pdf";
const STANDARD_CERTIFICATE_URL_EXPIRY = 900;

const CommandPaletteStandardSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limit: z.coerce.number().min(1).max(10).default(5),
});

// Client-facing shape of a mass composition profile (the catalog DTO). Shared
// by the list read (.select) and the CRUD writes (map over .returning()) so
// they never drift.
const compositionProfileDtoColumns = {
  id: massCompositionProfile.id,
  profileKey: massCompositionProfile.profileKey,
  profileClass: massCompositionProfile.profileClass,
  nominal: massCompositionProfile.nominal,
  nominalG: massCompositionProfile.nominalG,
  value: massCompositionProfile.value,
  uncertainty: massCompositionProfile.uncertainty,
  unit: massCompositionProfile.unit,
  maxError: massCompositionProfile.maxError,
  drift: massCompositionProfile.drift,
  buoyancy: massCompositionProfile.buoyancy,
  coverageFactor: massCompositionProfile.coverageFactor,
  quantityAvailable: massCompositionProfile.quantityAvailable,
};

function toCompositionProfileDto(
  row: typeof massCompositionProfile.$inferSelect,
) {
  return {
    id: row.id,
    profileKey: row.profileKey,
    profileClass: row.profileClass,
    nominal: row.nominal,
    nominalG: row.nominalG,
    value: row.value,
    uncertainty: row.uncertainty,
    unit: row.unit,
    maxError: row.maxError,
    drift: row.drift,
    buoyancy: row.buoyancy,
    coverageFactor: row.coverageFactor,
    quantityAvailable: row.quantityAvailable,
  };
}

type ProviderFactsOutcome =
  | { ok: true; number: string | null; mraRecognized: boolean }
  | { ok: false; message: string };

/**
 * The calibration provider's accreditation facts after a write.
 * They describe the provider named in `calibratedBy`, so a write that names a
 * DIFFERENT provider without supplying its facts resets them (not verified)
 * instead of carrying the previous provider's accreditation over. The MRA flag
 * needs an accreditation number.
 */
function nextProviderFacts(
  existing: {
    calibratedBy: string | null;
    calibrationProviderAccreditationNumber: string | null;
    calibrationProviderMraRecognized: boolean;
  },
  input: {
    calibratedBy?: string | null;
    calibrationProviderAccreditationNumber?: string | null;
    calibrationProviderMraRecognized?: boolean;
  },
): ProviderFactsOutcome {
  const normalise = (value: string | null | undefined) =>
    value?.trim().toLowerCase() || null;
  const providerChanged =
    input.calibratedBy !== undefined &&
    normalise(input.calibratedBy) !== normalise(existing.calibratedBy);
  const factsSupplied =
    input.calibrationProviderAccreditationNumber !== undefined ||
    input.calibrationProviderMraRecognized !== undefined;
  const reset = providerChanged && !factsSupplied;

  const number = reset
    ? null
    : input.calibrationProviderAccreditationNumber !== undefined
      ? input.calibrationProviderAccreditationNumber?.trim() || null
      : existing.calibrationProviderAccreditationNumber;
  const mraRecognized = reset
    ? false
    : (input.calibrationProviderMraRecognized ??
      existing.calibrationProviderMraRecognized);

  const issue = providerAccreditationIssue({
    calibrationProviderAccreditationNumber: number,
    calibrationProviderMraRecognized: mraRecognized,
  });
  return issue
    ? { ok: false, message: issue }
    : { ok: true, number, mraRecognized };
}

function sanitizeStandardCertificateFileName(value: string) {
  const trimmed = value.trim() || "certificado.pdf";
  const withoutPath = trimmed.split(/[\\/]/).pop() ?? "certificado.pdf";
  const normalized = withoutPath
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.toLowerCase().endsWith(".pdf")
    ? normalized
    : `${normalized || "certificado"}.pdf`;
}

function standardCertificateDocumentResponse(
  document: typeof referenceStandardCertificateDocument.$inferSelect,
) {
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

async function currentCertificateDocumentsByStandardId(
  standardIds: number[],
  executor: Pick<OrgExecutor, "select">,
) {
  if (standardIds.length === 0) {
    return new Map<
      number,
      ReturnType<typeof standardCertificateDocumentResponse>
    >();
  }

  const documents = await executor
    .select()
    .from(referenceStandardCertificateDocument)
    .where(
      and(
        inArray(referenceStandardCertificateDocument.standardId, standardIds),
        eq(referenceStandardCertificateDocument.isCurrent, true),
        finalizedStandardCertificateDocument(),
      ),
    );

  return new Map(
    documents.map((document) => [
      document.standardId,
      standardCertificateDocumentResponse(document),
    ]),
  );
}

/**
 * Reference Standards Router - Lab's Own Calibration Equipment (ISO 17025 Clause 6.4)
 *
 * Reference Standards are the lab's master instruments used to calibrate client equipment.
 * They are the "Truth" - their certificate values are used in uncertainty calculations.
 *
 * Key differences from Client Assets:
 * - Client Asset: The thing being tested. We measure its error.
 * - Reference Standard: The "Truth". We rely on its certificate values (U, k, Drift).
 *
 * Permissions:
 * - GET /: standard:read (all roles)
 * - GET /:id: standard:read (all roles)
 * - POST /: standard:create (admin, owner - LAB only)
 * - PUT /:id: standard:update (admin, owner - LAB only)
 * - DELETE /:id: standard:delete (admin, owner - LAB only) - soft delete
 * - POST /:id/renew: standard:renew (admin, owner - LAB only) - certificate renewal
 */
/** The calibration-history row of a standard's current certificate. */
function calibrationRecordOf(
  standard: typeof referenceStandard.$inferSelect,
  source: "create" | "renew",
  recordedBy: string,
): typeof referenceStandardCalibration.$inferInsert {
  return {
    organizationId: standard.organizationId,
    standardId: standard.id,
    certificateNumber: standard.certificateNumber,
    calibratedBy: standard.calibratedBy,
    calibrationProviderAccreditationNumber:
      standard.calibrationProviderAccreditationNumber,
    calibrationProviderMraRecognized: standard.calibrationProviderMraRecognized,
    calibrationDate: standard.calibrationDate,
    nextCalibrationDate: standard.nextCalibrationDate,
    referenceValue: standard.referenceValue,
    uncertainty: standard.uncertainty,
    uncertaintyUnit: standard.uncertaintyUnit,
    coverageFactor: standard.coverageFactor,
    certifiedValues: standard.certifiedValues,
    metrologyData: standard.metrologyData,
    source,
    recordedBy,
  };
}

const PREFIX = "/api/standards";

export const standardsRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

standardsRouter.get(
  "/search",
  ...withLabPermission({ standard: ["read"] }),
  zValidator("query", CommandPaletteStandardSearchQuerySchema),
  async (c) => {
    const member = c.get("member");
    const { query, limit } = c.req.valid("query");

    return await orgDb(member.organizationId).transaction(async (tx) => {
      const results = await tx
        .select({
          id: referenceStandard.id,
          name: referenceStandard.name,
          serialNumber: referenceStandard.serialNumber,
          manufacturer: referenceStandard.manufacturer,
        })
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.organizationId, member.organizationId),
            buildUnitScopeCondition(referenceStandard.unitId, member),
            isNull(referenceStandard.deletedAt),
            or(
              ilike(referenceStandard.name, `%${query}%`),
              ilike(referenceStandard.serialNumber, `%${query}%`),
              ilike(referenceStandard.certificateNumber, `%${query}%`),
              ilike(referenceStandard.manufacturer, `%${query}%`),
              ilike(referenceStandard.model, `%${query}%`),
              ilike(referenceStandard.type, `%${query}%`),
            )!,
          ),
        )
        .orderBy(referenceStandard.name)
        .limit(limit);

      return c.json(results);
    });
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.list,
  withLabPermission({ standard: ["read"] }),
  async (c, { query: { page, limit, query, status, expiringWithinDays } }) => {
    const member = c.get("member");
    const offset = (page - 1) * limit;

    const conditions = [
      eq(referenceStandard.organizationId, member.organizationId),
      buildUnitScopeCondition(referenceStandard.unitId, member),
      isNull(referenceStandard.deletedAt),
    ];

    if (query) {
      conditions.push(
        or(
          ilike(referenceStandard.name, `%${query}%`),
          ilike(referenceStandard.serialNumber, `%${query}%`),
          ilike(referenceStandard.certificateNumber, `%${query}%`),
        )!,
      );
    }

    if (status) {
      conditions.push(eq(referenceStandard.status, status));
    }

    if (expiringWithinDays) {
      // next_calibration_date is a calendar day: valid through that day, so
      // "expiring" runs from the laboratory's today to today + N, inclusive.
      const today = labToday();
      conditions.push(
        lte(
          referenceStandard.nextCalibrationDate,
          addCalendarDays(today, expiringWithinDays),
        ),
      );
      conditions.push(gte(referenceStandard.nextCalibrationDate, today));
    }

    const whereCondition = and(...conditions);

    return await orgDb(member.organizationId).transaction(async (tx) => {
      const [countResult] = await tx
        .select({ total: count() })
        .from(referenceStandard)
        .where(whereCondition);

      const standards = await tx
        .select({
          id: referenceStandard.id,
          name: referenceStandard.name,
          kind: referenceStandard.kind,
          type: referenceStandard.type,
          serialNumber: referenceStandard.serialNumber,
          manufacturer: referenceStandard.manufacturer,
          model: referenceStandard.model,
          certificateNumber: referenceStandard.certificateNumber,
          calibratedBy: referenceStandard.calibratedBy,
          calibrationProviderAccreditationNumber:
            referenceStandard.calibrationProviderAccreditationNumber,
          calibrationProviderMraRecognized:
            referenceStandard.calibrationProviderMraRecognized,
          calibrationDate: referenceStandard.calibrationDate,
          nextCalibrationDate: referenceStandard.nextCalibrationDate,
          referenceValue: referenceStandard.referenceValue,
          uncertainty: referenceStandard.uncertainty,
          uncertaintyUnit: referenceStandard.uncertaintyUnit,
          coverageFactor: referenceStandard.coverageFactor,
          distribution: referenceStandard.distribution,
          drift: referenceStandard.drift,
          certifiedValues: referenceStandard.certifiedValues,
          metrologyData: referenceStandard.metrologyData,
          status: referenceStandard.status,
          createdAt: referenceStandard.createdAt,
          updatedAt: referenceStandard.updatedAt,
        })
        .from(referenceStandard)
        .where(whereCondition)
        .orderBy(desc(referenceStandard.createdAt))
        .limit(limit)
        .offset(offset);

      const now = new Date();
      const certificateDocuments =
        await currentCertificateDocumentsByStandardId(
          standards.map((standard) => standard.id),
          tx,
        );
      const standardsWithExpiry = standards.map((s) => ({
        ...s,
        certificateDocument: certificateDocuments.get(s.id) ?? null,
        isExpired: isCalendarDatePast(s.nextCalibrationDate, now),
        daysUntilExpiry: labDaysUntil(s.nextCalibrationDate, now),
      }));

      return {
        data: standardsWithExpiry,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      };
    });
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.listCompositionProfiles,
  withLabPermission({ standard: ["read"] }),
  async (c) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const profiles = await tx
        .select(compositionProfileDtoColumns)
        .from(massCompositionProfile)
        .where(
          and(
            eq(massCompositionProfile.organizationId, member.organizationId),
            eq(massCompositionProfile.status, "ACTIVE"),
            isNull(massCompositionProfile.deletedAt),
          ),
        )
        .orderBy(
          massCompositionProfile.profileClass,
          massCompositionProfile.nominalG,
        );

      return { data: profiles };
    });
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.createCompositionProfile,
  withLabPermission({ standard: ["create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");

    const row = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
          .select({
            id: massCompositionProfile.id,
            status: massCompositionProfile.status,
            deletedAt: massCompositionProfile.deletedAt,
          })
          .from(massCompositionProfile)
          .where(
            and(
              eq(massCompositionProfile.organizationId, member.organizationId),
              eq(massCompositionProfile.profileClass, input.profileClass),
              eq(massCompositionProfile.nominalG, input.nominalG),
            ),
          )
          .limit(1);

        if (existing && existing.deletedAt === null) {
          throw conflict(
            "conflict",
            "Já existe um perfil para esta classe e nominal.",
          );
        }

        const writableValues = {
          profileKey: input.profileKey,
          nominal: input.nominal,
          value: input.value,
          uncertainty: input.uncertainty,
          unit: input.unit,
          maxError: input.maxError ?? null,
          drift: input.drift ?? null,
          buoyancy: input.buoyancy ?? null,
          coverageFactor: input.coverageFactor ?? null,
          quantityAvailable: input.quantityAvailable ?? null,
        };

        const [saved] = existing
          ? await ctx.o
              .update(massCompositionProfile)
              .set({
                ...writableValues,
                status: MASS_PROFILE_MACHINE.requireTargetOf(
                  existing.status,
                  "reactivate",
                ),
                deletedAt: null,
                updatedAt: new Date(),
              })
              .where(eq(massCompositionProfile.id, existing.id))
              .returning()
          : await ctx.o
              .insert(massCompositionProfile)
              .values({
                organizationId: member.organizationId,
                profileClass: input.profileClass,
                nominalG: input.nominalG,
                status: "ACTIVE",
                ...writableValues,
              })
              .returning();

        if (!saved) {
          throw new Error("Falha ao salvar perfil");
        }
        return saved;
      },
    );
    return toCompositionProfileDto(row);
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.updateCompositionProfile,
  withLabPermission({ standard: ["update"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const id = Number.parseInt(params.id, 10);

    if (!Number.isInteger(id)) {
      throw notFound("not_found", "Perfil não encontrado");
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      "profileKey",
      "profileClass",
      "nominal",
      "nominalG",
      "value",
      "uncertainty",
      "unit",
      "maxError",
      "drift",
      "buoyancy",
      "coverageFactor",
      "quantityAvailable",
    ] as const) {
      if (input[key] !== undefined) updateData[key] = input[key];
    }

    let rows;
    try {
      rows = await withOrg(member.organizationId, requestActor(c), (ctx) =>
        ctx.o
          .update(massCompositionProfile)
          .set(updateData)
          .where(
            and(
              eq(massCompositionProfile.id, id),
              eq(massCompositionProfile.organizationId, member.organizationId),
              isNull(massCompositionProfile.deletedAt),
            ),
          )
          .returning(),
      );
    } catch (error) {
      // 23505 = unique_violation: identity moved onto an existing (class, nominal_g).
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw conflict(
          "conflict",
          "Já existe um perfil para esta classe e nominal.",
        );
      }
      throw error;
    }

    const [row] = rows;
    if (!row) {
      throw notFound("not_found", "Perfil não encontrado");
    }
    return toCompositionProfileDto(row);
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.deleteCompositionProfile,
  withLabPermission({ standard: ["delete"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const id = Number.parseInt(params.id, 10);

    if (!Number.isInteger(id)) {
      throw notFound("not_found", "Perfil não encontrado");
    }

    const row = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [retired] = await ctx.o
          .update(massCompositionProfile)
          .set({
            status: MASS_PROFILE_MACHINE.requireTargetOf("ACTIVE", "retire"),
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(massCompositionProfile.id, id),
              eq(massCompositionProfile.organizationId, member.organizationId),
              isNull(massCompositionProfile.deletedAt),
            ),
          )
          .returning();

        if (!retired) {
          throw notFound("not_found", "Perfil não encontrado");
        }
        return retired;
      },
    );
    return { success: true as const, id: row.id };
  },
);

standardsRouter.get(
  "/:id/label",
  ...withLabPermission({ standard: ["read"] }),
  async (c) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const found = await requireLabStandard(c.req.param("id"), member, tx);

      return c.json({ id: found.id, label: found.name });
    });
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.get,
  withLabPermission({ standard: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const found = await requireLabStandard(params.id, member, tx);

      const now = new Date();
      const certificateDocuments =
        await currentCertificateDocumentsByStandardId([found.id], tx);
      const result = {
        ...found,
        certificateDocument: certificateDocuments.get(found.id) ?? null,
        isExpired: isCalendarDatePast(found.nextCalibrationDate, now),
        daysUntilExpiry: labDaysUntil(found.nextCalibrationDate, now),
      };

      return result;
    });
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.uploadCertificateDocument,
  withLabPermission({ standard: ["update"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const env = c.env;
    const lab = orgDb(member.organizationId);
    const standard = await lab.transaction((tx) =>
      requireLabStandard(params.id, member, tx),
    );

    const formData = await c.req.formData();
    const file = formData.get("certificate");

    if (!(file instanceof File)) {
      throw invalid("invalid_request", "Nenhum arquivo enviado");
    }

    const safeFileName = sanitizeStandardCertificateFileName(file.name);
    if (!safeFileName.toLowerCase().endsWith(".pdf")) {
      throw invalid("invalid_request", "Apenas arquivos PDF são permitidos");
    }

    if (file.type && file.type !== STANDARD_CERTIFICATE_CONTENT_TYPE) {
      throw invalid("invalid_request", "Apenas arquivos PDF são permitidos");
    }

    if (file.size > MAX_STANDARD_CERTIFICATE_FILE_SIZE) {
      throw invalid(
        "invalid_request",
        `Arquivo muito grande. Máximo ${MAX_STANDARD_CERTIFICATE_FILE_SIZE / 1024 / 1024}MB.`,
      );
    }

    const buffer = await file.arrayBuffer();
    const header = new TextDecoder().decode(buffer.slice(0, 4));
    if (header !== "%PDF") {
      throw invalid("invalid_request", "Arquivo PDF inválido");
    }

    const sha256 = createHash("sha256")
      .update(Buffer.from(buffer))
      .digest("hex");

    // The pending row commits before the upload: a failed upload leaves a
    // placeholder-key row that is never current, as before.
    const registered = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [created] = await ctx.o
          .insert(referenceStandardCertificateDocument)
          .values({
            standardId: standard.id,
            organizationId: standard.organizationId,
            unitId: standard.unitId,
            certificateNumber: standard.certificateNumber,
            calibrationDate: standard.calibrationDate,
            nextCalibrationDate: standard.nextCalibrationDate,
            fileName: safeFileName,
            contentType: STANDARD_CERTIFICATE_CONTENT_TYPE,
            fileSize: file.size,
            sha256,
            r2Key: pendingStandardCertificateKey(standard.id, randomUUID()),
            isCurrent: false,
            uploadedBy: session.user.id,
          })
          .returning();

        if (!created) return null;

        const [orgRow] = await ctx.o
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, standard.organizationId))
          .limit(1);
        return { created, slug: orgRow?.slug ?? "" };
      },
    );

    if (!registered) {
      throw new Error("Falha ao registrar certificado");
    }
    const { created, slug } = registered;
    const { bucket, key: r2Key } = standardCertificateKey({
      org: { id: standard.organizationId, slug },
      standardId: standard.id,
      documentId: created.id,
      fileName: safeFileName,
    });

    const r2Client = createR2Client(env);
    await uploadToR2(
      r2Client,
      resolveBucketName(env, bucket),
      r2Key,
      buffer,
      STANDARD_CERTIFICATE_CONTENT_TYPE,
    );

    const activated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [previousDocument] = await ctx.o
          .select()
          .from(referenceStandardCertificateDocument)
          .where(
            and(
              eq(referenceStandardCertificateDocument.standardId, standard.id),
              eq(referenceStandardCertificateDocument.isCurrent, true),
              finalizedStandardCertificateDocument(),
            ),
          )
          .limit(1);

        await ctx.o
          .update(referenceStandardCertificateDocument)
          .set({ isCurrent: false })
          .where(
            and(
              eq(referenceStandardCertificateDocument.standardId, standard.id),
              eq(referenceStandardCertificateDocument.isCurrent, true),
            ),
          );

        const [updated] = await ctx.o
          .update(referenceStandardCertificateDocument)
          .set({ r2Key, isCurrent: true })
          .where(
            and(
              eq(referenceStandardCertificateDocument.id, created.id),
              eq(
                referenceStandardCertificateDocument.organizationId,
                standard.organizationId,
              ),
            ),
          )
          .returning();

        if (!updated) return null;

        await ctx.audit("referenceStandard", standard.id, {
          action: "certificate_document_upload",
          changes: {
            certificateDocument: {
              old: previousDocument
                ? standardCertificateDocumentResponse(previousDocument)
                : null,
              new: standardCertificateDocumentResponse(updated),
            },
          },
        });
        return updated;
      },
    );

    if (!activated) {
      throw new Error("Falha ao ativar certificado");
    }

    return {
      message: "Certificado enviado com sucesso",
      document: standardCertificateDocumentResponse(activated),
    };
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.getCertificateDocumentDownloadUrl,
  withLabPermission({ standard: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const env = c.env;
    const lab = orgDb(member.organizationId);
    const id = await lab.transaction((tx) =>
      requireLabStandardId(params.id, member, tx),
    );

    const [document] = await lab.transaction((tx) =>
      tx
        .select({
          fileName: referenceStandardCertificateDocument.fileName,
          r2Key: referenceStandardCertificateDocument.r2Key,
        })
        .from(referenceStandardCertificateDocument)
        .innerJoin(
          referenceStandard,
          eq(
            referenceStandardCertificateDocument.standardId,
            referenceStandard.id,
          ),
        )
        .where(
          and(
            eq(referenceStandard.id, id),
            eq(referenceStandard.organizationId, member.organizationId),
            buildUnitScopeCondition(referenceStandard.unitId, member),
            isNull(referenceStandard.deletedAt),
            eq(referenceStandardCertificateDocument.isCurrent, true),
            finalizedStandardCertificateDocument(),
          ),
        )
        .limit(1),
    );

    if (!document) {
      throw notFound("not_found", "Certificado não encontrado");
    }

    const r2Client = createR2Client(env);
    const url = await generatePresignedUrl(
      r2Client,
      env.R2_BUCKET_NAME,
      document.r2Key,
      STANDARD_CERTIFICATE_URL_EXPIRY,
    );

    return {
      url,
      filename: document.fileName,
    };
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.create,
  withLabPermission({ standard: ["create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");
    const session = c.get("session");

    if (!member.activeUnitId) {
      throw invalid(
        "invalid_request",
        "Selecione uma unidade específica para criar padrões",
      );
    }

    const activeUnitId = member.activeUnitId;
    const created = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [newStandard] = await ctx.o
          .insert(referenceStandard)
          .values({
            unitId: activeUnitId,
            organizationId: member.organizationId,
            name: input.name,
            kind: input.kind,
            type: input.type || null,
            serialNumber: input.serialNumber,
            manufacturer: input.manufacturer || null,
            model: input.model || null,
            certificateNumber: input.certificateNumber,
            calibratedBy: input.calibratedBy || null,
            calibrationProviderAccreditationNumber:
              input.calibrationProviderAccreditationNumber?.trim() || null,
            calibrationProviderMraRecognized:
              input.calibrationProviderMraRecognized ?? false,
            calibrationDate: new Date(input.calibrationDate),
            nextCalibrationDate: new Date(input.nextCalibrationDate),
            referenceValue: input.referenceValue ?? null,
            uncertainty: input.uncertainty ?? null,
            uncertaintyUnit: input.uncertaintyUnit ?? null,
            coverageFactor: input.coverageFactor,
            distribution: input.distribution,
            drift: input.drift ?? null,
            certifiedValues: input.certifiedValues ?? null,
            metrologyData: input.metrologyData ?? null,
            status: input.status,
            createdBy: session.user.id,
          })
          .returning();

        if (!newStandard) {
          throw new Error("Falha ao criar padrão");
        }

        // The standard's first certificate.
        await ctx.o
          .insert(referenceStandardCalibration)
          .values(calibrationRecordOf(newStandard, "create", session.user.id));

        await ctx.audit("referenceStandard", newStandard.id, {
          action: "create",
          changes: {
            initial: {
              ...input,
              id: newStandard.id,
              unitId: newStandard.unitId,
              organizationId: newStandard.organizationId,
              createdBy: newStandard.createdBy,
            },
          },
        });

        return newStandard;
      },
    );
    return created;
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.update,
  withLabPermission({ standard: ["update"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const session = c.get("session");

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabStandard(params.id, member, ctx.o);
        const id = existing.id;
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        const updateData: Record<string, unknown> = {};

        if (input.name !== undefined && input.name !== existing.name) {
          changes.name = { old: existing.name, new: input.name };
          updateData.name = input.name;
        }
        if (input.type !== undefined && input.type !== existing.type) {
          changes.type = { old: existing.type, new: input.type };
          updateData.type = input.type;
        }
        if (input.kind !== undefined && input.kind !== existing.kind) {
          changes.kind = { old: existing.kind, new: input.kind };
          updateData.kind = input.kind;
        }
        if (
          input.serialNumber !== undefined &&
          input.serialNumber !== existing.serialNumber
        ) {
          changes.serialNumber = {
            old: existing.serialNumber,
            new: input.serialNumber,
          };
          updateData.serialNumber = input.serialNumber;
        }
        if (
          input.manufacturer !== undefined &&
          input.manufacturer !== existing.manufacturer
        ) {
          changes.manufacturer = {
            old: existing.manufacturer,
            new: input.manufacturer,
          };
          updateData.manufacturer = input.manufacturer;
        }
        if (input.model !== undefined && input.model !== existing.model) {
          changes.model = { old: existing.model, new: input.model };
          updateData.model = input.model;
        }
        if (
          input.certificateNumber !== undefined &&
          input.certificateNumber !== existing.certificateNumber
        ) {
          changes.certificateNumber = {
            old: existing.certificateNumber,
            new: input.certificateNumber,
          };
          updateData.certificateNumber = input.certificateNumber;
        }
        if (
          input.calibratedBy !== undefined &&
          input.calibratedBy !== existing.calibratedBy
        ) {
          changes.calibratedBy = {
            old: existing.calibratedBy,
            new: input.calibratedBy,
          };
          updateData.calibratedBy = input.calibratedBy;
        }
        const providerFacts = nextProviderFacts(existing, input);
        if (!providerFacts.ok) {
          throw invalid("invalid_request", providerFacts.message);
        }
        if (
          providerFacts.number !==
          existing.calibrationProviderAccreditationNumber
        ) {
          changes.calibrationProviderAccreditationNumber = {
            old: existing.calibrationProviderAccreditationNumber,
            new: providerFacts.number,
          };
          updateData.calibrationProviderAccreditationNumber =
            providerFacts.number;
        }
        if (
          providerFacts.mraRecognized !==
          existing.calibrationProviderMraRecognized
        ) {
          changes.calibrationProviderMraRecognized = {
            old: existing.calibrationProviderMraRecognized,
            new: providerFacts.mraRecognized,
          };
          updateData.calibrationProviderMraRecognized =
            providerFacts.mraRecognized;
        }
        if (input.calibrationDate !== undefined) {
          const newDate = new Date(input.calibrationDate);
          if (
            calendarDateKey(newDate) !==
            calendarDateKey(existing.calibrationDate)
          ) {
            changes.calibrationDate = {
              old: existing.calibrationDate.toISOString(),
              new: newDate.toISOString(),
            };
            updateData.calibrationDate = newDate;
          }
        }
        if (input.nextCalibrationDate !== undefined) {
          const newDate = new Date(input.nextCalibrationDate);
          if (
            calendarDateKey(newDate) !==
            calendarDateKey(existing.nextCalibrationDate)
          ) {
            changes.nextCalibrationDate = {
              old: existing.nextCalibrationDate.toISOString(),
              new: newDate.toISOString(),
            };
            updateData.nextCalibrationDate = newDate;
          }
        }
        if (
          input.referenceValue !== undefined &&
          input.referenceValue !== existing.referenceValue
        ) {
          changes.referenceValue = {
            old: existing.referenceValue,
            new: input.referenceValue,
          };
          updateData.referenceValue = input.referenceValue;
        }
        if (
          input.uncertainty !== undefined &&
          input.uncertainty !== existing.uncertainty
        ) {
          changes.uncertainty = {
            old: existing.uncertainty,
            new: input.uncertainty,
          };
          updateData.uncertainty = input.uncertainty;
        }
        if (
          input.uncertaintyUnit !== undefined &&
          input.uncertaintyUnit !== existing.uncertaintyUnit
        ) {
          changes.uncertaintyUnit = {
            old: existing.uncertaintyUnit,
            new: input.uncertaintyUnit,
          };
          updateData.uncertaintyUnit = input.uncertaintyUnit;
        }
        if (
          input.coverageFactor !== undefined &&
          input.coverageFactor !== existing.coverageFactor
        ) {
          changes.coverageFactor = {
            old: existing.coverageFactor,
            new: input.coverageFactor,
          };
          updateData.coverageFactor = input.coverageFactor;
        }
        if (
          input.distribution !== undefined &&
          input.distribution !== existing.distribution
        ) {
          changes.distribution = {
            old: existing.distribution,
            new: input.distribution,
          };
          updateData.distribution = input.distribution;
        }
        if (input.drift !== undefined && input.drift !== existing.drift) {
          changes.drift = { old: existing.drift, new: input.drift };
          updateData.drift = input.drift;
        }
        if (input.certifiedValues !== undefined) {
          const oldJson = JSON.stringify(existing.certifiedValues);
          const newJson = JSON.stringify(input.certifiedValues);
          if (oldJson !== newJson) {
            changes.certifiedValues = {
              old: existing.certifiedValues,
              new: input.certifiedValues,
            };
            updateData.certifiedValues = input.certifiedValues;
          }
        }
        if (input.metrologyData !== undefined) {
          const oldJson = JSON.stringify(existing.metrologyData);
          const newJson = JSON.stringify(input.metrologyData);
          if (oldJson !== newJson) {
            changes.metrologyData = {
              old: existing.metrologyData,
              new: input.metrologyData,
            };
            updateData.metrologyData = input.metrologyData;
          }
        }
        if (input.status !== undefined && input.status !== existing.status) {
          changes.status = { old: existing.status, new: input.status };
          updateData.status = REFERENCE_STANDARD_MACHINE.requireTransition(
            existing.status,
            "set_status",
            input.status,
          );
        }

        if (Object.keys(updateData).length === 0) {
          return existing;
        }

        const [row] = await ctx.o
          .update(referenceStandard)
          .set(updateData)
          .where(eq(referenceStandard.id, id))
          .returning();

        // Deleted between the read above and this write.
        if (!row) {
          throw notFound("standard_not_found", "Padrão não encontrado");
        }

        await ctx.audit("referenceStandard", id, {
          action: changes.status ? "status_change" : "update",
          changes,
        });

        // Flagging a standard OUT_OF_TOLERANCE auto-opens the
        // §7.10 recall workflow (typed NC + DRAFT recall). Best-effort, in its
        // own transaction once the status change has committed: a failing
        // hook never undoes the change (the wizard's send endpoint re-ensures
        // the recall exists).
        if (
          changes.status &&
          row.status === "OUT_OF_TOLERANCE" &&
          existing.status !== "OUT_OF_TOLERANCE"
        ) {
          const standardToRecall: RecallStandardIdentity = {
            id: row.id,
            name: row.name,
            serialNumber: row.serialNumber,
            certificateNumber: row.certificateNumber,
            calibrationDate: row.calibrationDate,
          };
          ctx.afterCommit(() =>
            withOrg(member.organizationId, ctx.actor, (recallCtx) =>
              ensureStandardRecall(
                {
                  organizationId: member.organizationId,
                  actorUserId: session.user.id,
                  standard: standardToRecall,
                },
                recallCtx,
              ),
            ),
          );
        }

        return row;
      },
    );

    return updated;
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.getImpactedCertificates,
  withLabPermission({ standard: ["read"] }),
  async (c, { params, query }) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const id = await requireLabStandardId(
        params.id,
        member,
        tx,
        "Padrao nao encontrado",
      );

      const [standard] = await tx
        .select({
          id: referenceStandard.id,
          calibrationDate: referenceStandard.calibrationDate,
        })
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.id, id),
            eq(referenceStandard.organizationId, member.organizationId),
            isNull(referenceStandard.deletedAt),
          ),
        )
        .limit(1);

      if (!standard) {
        throw notFound("standard_not_found", "Padrao nao encontrado");
      }

      // Default window: the standard's (now suspect) certificate validity
      // start → now. Both bounds editable (over-notification mitigation).
      const from = query.from ? new Date(query.from) : standard.calibrationDate;
      const to = query.to ? new Date(query.to) : new Date();

      const impacted = await findImpactedCertificates(
        {
          standardId: id,
          organizationId: member.organizationId,
          from,
          to,
        },
        tx,
      );

      // The jobs still on their way to a certificate (§6.4, §7.10): not in the
      // issued list, but a recalled standard would reach their certificate.
      const inFlight = await findInFlightJobsUsingStandard(
        { standardId: id, organizationId: member.organizationId },
        tx,
      );

      return {
        data: impacted,
        inFlight,
        window: { from: from.toISOString(), to: to.toISOString() },
      };
    });
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.getRecall,
  withLabPermission({ standard: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const id = await requireLabStandardId(
        params.id,
        member,
        tx,
        "Padrao nao encontrado",
      );

      const [recall] = await tx
        .select({
          id: standardRecall.id,
          standardId: standardRecall.standardId,
          ncId: standardRecall.ncId,
          ncNumber: nonConformance.ncNumber,
          status: standardRecall.status,
          fromDate: standardRecall.fromDate,
          toDate: standardRecall.toDate,
          approvedBy: standardRecall.approvedBy,
          approvedAt: standardRecall.approvedAt,
          createdAt: standardRecall.createdAt,
        })
        .from(standardRecall)
        .innerJoin(nonConformance, eq(standardRecall.ncId, nonConformance.id))
        .where(
          and(
            eq(standardRecall.standardId, id),
            eq(standardRecall.organizationId, member.organizationId),
          ),
        )
        .orderBy(desc(standardRecall.createdAt))
        .limit(1);

      if (!recall) {
        return { data: null };
      }

      const notifications = await tx
        .select({
          id: ootNotification.id,
          jobId: ootNotification.jobId,
          certificateNumber: ootNotification.certificateNumber,
          recipientName: ootNotification.recipientName,
          recipientEmail: ootNotification.recipientEmail,
          status: ootNotification.status,
          sentAt: ootNotification.sentAt,
          acknowledgedAt: ootNotification.acknowledgedAt,
          acknowledgedVia: ootNotification.acknowledgedVia,
        })
        .from(ootNotification)
        .where(
          and(
            eq(ootNotification.recallId, recall.id),
            eq(ootNotification.organizationId, member.organizationId),
          ),
        )
        .orderBy(desc(ootNotification.createdAt));

      // Bounce/complaint signal from the Resend suppression webhook: an
      // address on the "all" suppression list with a delivery-failure reason.
      const recipientEmails = [
        ...new Set(
          notifications
            .map((n) => n.recipientEmail?.trim().toLowerCase())
            .filter((email): email is string => Boolean(email)),
        ),
      ];
      const suppressedRows = recipientEmails.length
        ? await tx
            .select({ email: emailSuppression.email })
            .from(emailSuppression)
            .where(
              and(
                inArray(emailSuppression.email, recipientEmails),
                inArray(emailSuppression.reason, ["hard_bounce", "complaint"]),
              ),
            )
        : [];
      const suppressedEmails = new Set(suppressedRows.map((row) => row.email));

      const rows = notifications.map((n) => ({
        ...n,
        bounced: n.recipientEmail
          ? suppressedEmails.has(n.recipientEmail.trim().toLowerCase())
          : false,
      }));

      return {
        data: {
          ...recall,
          notifications: rows,
          counts: {
            total: rows.length,
            sent: rows.filter((n) => n.sentAt !== null).length,
            acknowledged: rows.filter((n) => n.acknowledgedAt !== null).length,
            bounced: rows.filter((n) => n.bounced).length,
            missingEmail: rows.filter((n) => !n.recipientEmail).length,
          },
        },
      };
    });
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.sendRecall,
  withLabPermission({ standard: ["update"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const session = c.get("session");
    // Phase 1: the standard, the (re-ensured) recall, the reviewed list and the
    // approval stamp commit together.
    const approvedRecall = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const id = await requireLabStandardId(
          params.id,
          member,
          ctx.o,
          "Padrao nao encontrado",
        );

        // Elevated approval gate: same pattern as NC use_as_is/concession
        // dispositions — org-level admin/owner only (a unit_admin elevation is
        // not enough to approve a customer-facing batch recall).
        if (member.role !== "admin" && member.role !== "owner") {
          throw forbidden(
            "forbidden",
            "O envio de recall em lote requer aprovacao de um administrador ou responsavel",
          );
        }

        const [standard] = await ctx.o
          .select()
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.id, id),
              eq(referenceStandard.organizationId, member.organizationId),
              isNull(referenceStandard.deletedAt),
            ),
          )
          .limit(1);

        if (!standard) {
          throw notFound("standard_not_found", "Padrao nao encontrado");
        }

        if (standard.status !== "OUT_OF_TOLERANCE") {
          throw conflict(
            "standard_not_out_of_tolerance",
            "Apenas padroes com status fora de tolerancia podem originar um recall",
          );
        }

        // Re-ensure the recall exists (covers a failed status-change hook).
        const { recall } = await ensureStandardRecall(
          {
            organizationId: member.organizationId,
            actorUserId: session.user.id,
            standard: {
              id: standard.id,
              name: standard.name,
              serialNumber: standard.serialNumber,
              certificateNumber: standard.certificateNumber,
              calibrationDate: standard.calibrationDate,
            },
          },
          ctx,
        );

        // Every selected job must actually be linked to this standard — the
        // reviewed list from the wizard is re-validated, never trusted.
        const linkedRows = await ctx.o
          .select({ jobId: jobStandard.jobId })
          .from(jobStandard)
          .innerJoin(calibrationJob, eq(jobStandard.jobId, calibrationJob.id))
          .where(
            and(
              eq(jobStandard.standardId, id),
              inArray(jobStandard.jobId, input.jobIds),
              eq(calibrationJob.organizationId, member.organizationId),
            ),
          );
        const linkedJobIds = new Set(linkedRows.map((row) => row.jobId));
        const invalidIds = input.jobIds.filter(
          (jobId) => !linkedJobIds.has(jobId),
        );
        if (invalidIds.length > 0) {
          throw invalid(
            "jobs_not_linked_to_standard",
            `Certificados fora do escopo deste padrao: ${invalidIds.join(", ")}`,
          );
        }

        // Stamp the approval + reviewed window before dispatching (§7.10.2
        // evidence: who approved the batch and what window was reviewed).
        const [stamped] = await ctx.o
          .update(standardRecall)
          .set({
            status: STANDARD_RECALL_MACHINE.requireTargetOf(
              recall.status,
              "send",
            ),
            fromDate: input.from ? new Date(input.from) : recall.fromDate,
            toDate: input.to ? new Date(input.to) : new Date(),
            approvedBy: session.user.id,
            approvedAt: new Date(),
          })
          .where(
            and(
              eq(standardRecall.id, recall.id),
              eq(standardRecall.organizationId, member.organizationId),
              eq(standardRecall.status, recall.status),
            ),
          )
          .returning();

        await ctx.audit("referenceStandard", id, {
          action: "recall_send",
          changes: {
            recallId: recall.id,
            jobIds: input.jobIds,
            from: input.from ?? recall.fromDate?.toISOString() ?? null,
            to: input.to ?? null,
          },
          reason: `Recall §7.10 aprovado: ${input.jobIds.length} certificado(s) notificado(s)`,
        });

        return stamped ?? recall;
      },
    );

    // Phase 2: one notification per certificate (the PDF jobs run after the commit).
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      (ctx) =>
        createStandardRecallNotifications(
          {
            recall: approvedRecall,
            jobIds: input.jobIds,
            organizationId: member.organizationId,
            actorUserId: session.user.id,
          },
          ctx,
        ),
    );

    return {
      message: "Recall aprovado e notificacoes em envio",
      data: {
        recallId: approvedRecall.id,
        created: result.created,
        skipped: result.skipped,
      },
    };
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.delete,
  withLabPermission({ standard: ["delete"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabStandard(params.id, member, ctx.o);
        const id = existing.id;

        const [row] = await ctx.o
          .update(referenceStandard)
          .set({
            deletedAt: new Date(),
            status: REFERENCE_STANDARD_MACHINE.requireTargetOf(
              existing.status,
              "retire",
            ),
          })
          .where(eq(referenceStandard.id, id))
          .returning();

        await ctx.audit("referenceStandard", id, {
          action: "delete",
          changes: { deletedAt: { old: null, new: new Date().toISOString() } },
        });

        if (!row) throw notFound("standard_not_found", "Padrão nao encontrado");
        return row;
      },
    );

    return {
      message: "Padrão removido com sucesso",
      data: updated,
    };
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.renew,
  withLabPermission({ standard: ["renew"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const session = c.get("session");
    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabStandard(params.id, member, ctx.o);
        const id = existing.id;

        const changes: Record<string, { old: unknown; new: unknown }> = {};
        const updateData: Record<string, unknown> = {};

        changes.certificateNumber = {
          old: existing.certificateNumber,
          new: input.certificateNumber,
        };
        updateData.certificateNumber = input.certificateNumber;

        if (input.calibratedBy !== undefined) {
          changes.calibratedBy = {
            old: existing.calibratedBy,
            new: input.calibratedBy,
          };
          updateData.calibratedBy = input.calibratedBy;
        }
        // A renewal from another provider must re-attest its accreditation.
        const renewedProviderFacts = nextProviderFacts(existing, input);
        if (!renewedProviderFacts.ok) {
          throw invalid("invalid_request", renewedProviderFacts.message);
        }
        changes.calibrationProviderAccreditationNumber = {
          old: existing.calibrationProviderAccreditationNumber,
          new: renewedProviderFacts.number,
        };
        updateData.calibrationProviderAccreditationNumber =
          renewedProviderFacts.number;
        changes.calibrationProviderMraRecognized = {
          old: existing.calibrationProviderMraRecognized,
          new: renewedProviderFacts.mraRecognized,
        };
        updateData.calibrationProviderMraRecognized =
          renewedProviderFacts.mraRecognized;

        const newCalibrationDate = new Date(input.calibrationDate);
        changes.calibrationDate = {
          old: existing.calibrationDate.toISOString(),
          new: newCalibrationDate.toISOString(),
        };
        updateData.calibrationDate = newCalibrationDate;

        const newNextCalibrationDate = new Date(input.nextCalibrationDate);
        changes.nextCalibrationDate = {
          old: existing.nextCalibrationDate.toISOString(),
          new: newNextCalibrationDate.toISOString(),
        };
        updateData.nextCalibrationDate = newNextCalibrationDate;

        if (input.referenceValue !== undefined) {
          changes.referenceValue = {
            old: existing.referenceValue,
            new: input.referenceValue,
          };
          updateData.referenceValue = input.referenceValue;
        }
        if (input.uncertainty !== undefined) {
          changes.uncertainty = {
            old: existing.uncertainty,
            new: input.uncertainty,
          };
          updateData.uncertainty = input.uncertainty;
        }
        if (input.uncertaintyUnit !== undefined) {
          changes.uncertaintyUnit = {
            old: existing.uncertaintyUnit,
            new: input.uncertaintyUnit,
          };
          updateData.uncertaintyUnit = input.uncertaintyUnit;
        }
        if (input.coverageFactor !== undefined) {
          changes.coverageFactor = {
            old: existing.coverageFactor,
            new: input.coverageFactor,
          };
          updateData.coverageFactor = input.coverageFactor;
        }
        if (input.certifiedValues !== undefined) {
          changes.certifiedValues = {
            old: existing.certifiedValues,
            new: input.certifiedValues,
          };
          updateData.certifiedValues = input.certifiedValues;
        }
        if (input.metrologyData !== undefined) {
          changes.metrologyData = {
            old: existing.metrologyData,
            new: input.metrologyData,
          };
          updateData.metrologyData = input.metrologyData;
        }

        // `renew` (REFERENCE_STANDARD_MACHINE): a new certificate brings an
        // out-of-tolerance or sent standard back to ACTIVE.
        if (
          REFERENCE_STANDARD_MACHINE.canTransition(existing.status, "renew")
        ) {
          const renewed = REFERENCE_STANDARD_MACHINE.requireTargetOf(
            existing.status,
            "renew",
          );
          changes.status = { old: existing.status, new: renewed };
          updateData.status = renewed;
        }

        const [row] = await ctx.o
          .update(referenceStandard)
          .set(updateData)
          .where(eq(referenceStandard.id, id))
          .returning();

        // The new certificate is appended to the history; the one it replaces
        // stays, for the work it covered.
        if (row) {
          await ctx.o
            .insert(referenceStandardCalibration)
            .values(calibrationRecordOf(row, "renew", session.user.id));
        }

        // Audit log with reason (required for ISO 17025)
        await ctx.audit("referenceStandard", id, {
          action: "renew",
          changes,
          reason: input.reason,
        });

        if (!row) throw notFound("standard_not_found", "Padrão nao encontrado");
        return row;
      },
    );

    return {
      message: "Certificado renovado com sucesso",
      data: updated,
    };
  },
);

mount(
  standardsRouter,
  PREFIX,
  standardEndpoints.auditLog,
  withLabPermission({ standard: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const id = await requireLabStandardId(params.id, member, tx);

      const [existing] = await tx
        .select({ id: referenceStandard.id })
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.id, id),
            eq(referenceStandard.organizationId, member.organizationId),
            buildUnitScopeCondition(referenceStandard.unitId, member),
          ),
        )
        .limit(1);

      if (!existing) {
        throw notFound("standard_not_found", "Padrão nao encontrado");
      }

      const logs = await tx
        .select({
          id: referenceStandardAuditLog.id,
          standardId: referenceStandardAuditLog.standardId,
          action: referenceStandardAuditLog.action,
          changes: referenceStandardAuditLog.changes,
          performedBy: referenceStandardAuditLog.performedBy,
          performedByName: user.name,
          performedAt: referenceStandardAuditLog.performedAt,
          ipAddress: referenceStandardAuditLog.ipAddress,
          reason: referenceStandardAuditLog.reason,
        })
        .from(referenceStandardAuditLog)
        .leftJoin(user, eq(referenceStandardAuditLog.performedBy, user.id))
        .where(eq(referenceStandardAuditLog.standardId, id))
        .orderBy(desc(referenceStandardAuditLog.performedAt));

      return { data: logs };
    });
  },
);
