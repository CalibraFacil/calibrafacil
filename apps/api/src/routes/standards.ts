import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import { recordActivationMilestone } from "../services/activation-checklist";
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
  referenceStandardCertificateDocument,
  standardRecall,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateReferenceStandardSchema,
  UpdateReferenceStandardSchema,
  ListReferenceStandardsQuerySchema,
  RenewCertificateSchema,
  MassCompositionProfileCreateSchema,
  MassCompositionProfileUpdateSchema,
  ImpactedCertificatesQuerySchema,
  SendStandardRecallSchema,
} from "@calibra-facil/schemas";
import {
  ensureStandardRecall,
  createStandardRecallNotifications,
} from "../lib/oot-notifications";
import { findImpactedCertificates } from "../lib/job-standards";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  eq,
  and,
  or,
  ilike,
  desc,
  like,
  not,
  count,
  isNull,
  lte,
  gte,
  inArray,
} from "drizzle-orm";
import { buildUnitScopeCondition } from "../lib/units";
import {
  parseLegacyNumericIdentifier,
  slugifyRouteIdentifier,
} from "../lib/route-identifiers";
import {
  createR2Client,
  generatePresignedUrl,
  resolveBucketName,
  uploadToR2,
  type R2Env,
} from "../lib/storage";
import { standardCertificateKey } from "@calibra-facil/shared/storage-keys";

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

async function resolveStandardRouteId(
  identifier: string,
  member: AuthVariables["member"],
): Promise<number | null> {
  const stableId =
    parseLegacyNumericIdentifier(identifier) ??
    parseTrailingNumericRouteIdentifier(identifier);
  const canMatchSerialNumber = !isPlaceholderSerialIdentifier(identifier);

  const directConditions = [
    eq(referenceStandard.organizationId, member.organizationId),
    buildUnitScopeCondition(referenceStandard.unitId, member),
    isNull(referenceStandard.deletedAt),
  ];

  const [directMatch] = await db
    .select({
      id: referenceStandard.id,
    })
    .from(referenceStandard)
    .where(
      and(
        ...directConditions,
        stableId
          ? or(
              eq(referenceStandard.id, stableId),
              ...(canMatchSerialNumber
                ? [eq(referenceStandard.serialNumber, identifier)]
                : []),
              eq(referenceStandard.name, identifier),
              eq(referenceStandard.certificateNumber, identifier),
            )
          : or(
              ...(canMatchSerialNumber
                ? [eq(referenceStandard.serialNumber, identifier)]
                : []),
              eq(referenceStandard.name, identifier),
              eq(referenceStandard.certificateNumber, identifier),
            ),
      ),
    )
    .limit(1);

  if (directMatch) return directMatch.id;

  const standards = await db
    .select({
      id: referenceStandard.id,
      name: referenceStandard.name,
      serialNumber: referenceStandard.serialNumber,
    })
    .from(referenceStandard)
    .where(and(...directConditions));

  return (
    standards.find(
      (standard) =>
        (!isPlaceholderSerialIdentifier(standard.serialNumber) &&
          slugifyRouteIdentifier(standard.serialNumber) === identifier) ||
        slugifyRouteIdentifier(standard.name) === identifier,
    )?.id ?? null
  );
}

function parseTrailingNumericRouteIdentifier(
  identifier: string,
): number | null {
  const match = /-(\d+)$/.exec(identifier);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isPlaceholderSerialIdentifier(value: string | null | undefined) {
  if (!value) return true;
  const normalized = slugifyRouteIdentifier(value);
  return normalized === "n-a" || normalized === "na";
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

function isFinalizedCertificateDocumentCondition() {
  return not(like(referenceStandardCertificateDocument.r2Key, "pending/%"));
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

async function currentCertificateDocumentsByStandardId(standardIds: number[]) {
  if (standardIds.length === 0) {
    return new Map<
      number,
      ReturnType<typeof standardCertificateDocumentResponse>
    >();
  }

  const documents = await db
    .select()
    .from(referenceStandardCertificateDocument)
    .where(
      and(
        inArray(referenceStandardCertificateDocument.standardId, standardIds),
        eq(referenceStandardCertificateDocument.isCurrent, true),
        isFinalizedCertificateDocumentCondition(),
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
export const standardsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>()
  // =========================================================================
  // GET /search - Lightweight search for command palette
  // =========================================================================
  .get(
    "/search",
    ...withLabPermission({ standard: ["read"] }),
    zValidator("query", CommandPaletteStandardSearchQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { query, limit } = c.req.valid("query");

      try {
        const results = await db
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
      } catch (error) {
        console.error("Error searching standards:", error);
        return c.json({ error: "Erro ao buscar padrões" }, 500);
      }
    },
  )

  // =========================================================================
  // GET / - List reference standards with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ standard: ["read"] }),
    zValidator("query", ListReferenceStandardsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, query, status, expiringWithinDays } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      // Build conditions - always scope to organization and exclude soft-deleted
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

      // Filter by upcoming calibration due date
      if (expiringWithinDays) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + expiringWithinDays);
        conditions.push(lte(referenceStandard.nextCalibrationDate, futureDate));
        conditions.push(gte(referenceStandard.nextCalibrationDate, new Date()));
      }

      const whereCondition = and(...conditions);

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(referenceStandard)
        .where(whereCondition);

      // Get paginated data
      const standards = await db
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

      // Add computed field: isExpired
      const now = new Date();
      const certificateDocuments =
        await currentCertificateDocumentsByStandardId(
          standards.map((standard) => standard.id),
        );
      const standardsWithExpiry = standards.map((s) => ({
        ...s,
        certificateDocument: certificateDocuments.get(s.id) ?? null,
        isExpired: s.nextCalibrationDate < now,
        daysUntilExpiry: Math.ceil(
          (s.nextCalibrationDate.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      }));

      return c.json({
        data: standardsWithExpiry,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      });
    },
  )

  // =========================================================================
  // GET /composition-profiles - The org's mass composition-profile catalog
  // (normalized buildup weights by class + nominal). Source of truth for the
  // profile options in the mass-composition method runtime; the runtime
  // attaches these to standards instead of reading compositionProfile entries
  // out of certified_values. Registered before /:id so it is not shadowed.
  // =========================================================================
  .get(
    "/composition-profiles",
    ...withLabPermission({ standard: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const profiles = await db
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

      return c.json({ data: profiles });
    },
  )

  // =========================================================================
  // POST /composition-profiles - Create (or revive) a catalog profile.
  // (org, class, nominal_g) is unique; a soft-deleted row still holds the key,
  // so revive it instead of failing. Registered before /:id.
  // =========================================================================
  .post(
    "/composition-profiles",
    ...withLabPermission({ standard: ["create"] }),
    zValidator("json", MassCompositionProfileCreateSchema),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");

      const [existing] = await db
        .select({
          id: massCompositionProfile.id,
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
        return c.json(
          { error: "Já existe um perfil para esta classe e nominal." },
          409,
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

      const [row] = existing
        ? await db
            .update(massCompositionProfile)
            .set({
              ...writableValues,
              status: "ACTIVE",
              deletedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(massCompositionProfile.id, existing.id))
            .returning()
        : await db
            .insert(massCompositionProfile)
            .values({
              organizationId: member.organizationId,
              profileClass: input.profileClass,
              nominalG: input.nominalG,
              status: "ACTIVE",
              ...writableValues,
            })
            .returning();

      if (!row) {
        return c.json({ error: "Falha ao salvar perfil" }, 500);
      }
      return c.json(toCompositionProfileDto(row), 201);
    },
  )

  // =========================================================================
  // PUT /composition-profiles/:id - Update a catalog profile
  // =========================================================================
  .put(
    "/composition-profiles/:id",
    ...withLabPermission({ standard: ["update"] }),
    zValidator("json", MassCompositionProfileUpdateSchema),
    async (c) => {
      const member = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (!Number.isInteger(id)) {
        return c.json({ error: "Perfil não encontrado" }, 404);
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
        rows = await db
          .update(massCompositionProfile)
          .set(updateData)
          .where(
            and(
              eq(massCompositionProfile.id, id),
              eq(massCompositionProfile.organizationId, member.organizationId),
              isNull(massCompositionProfile.deletedAt),
            ),
          )
          .returning();
      } catch (error) {
        // 23505 = unique_violation: identity moved onto an existing (class, nominal_g).
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          return c.json(
            { error: "Já existe um perfil para esta classe e nominal." },
            409,
          );
        }
        throw error;
      }

      const [row] = rows;
      if (!row) {
        return c.json({ error: "Perfil não encontrado" }, 404);
      }
      return c.json(toCompositionProfileDto(row));
    },
  )

  // =========================================================================
  // DELETE /composition-profiles/:id - Soft-delete a catalog profile
  // =========================================================================
  .delete(
    "/composition-profiles/:id",
    ...withLabPermission({ standard: ["delete"] }),
    async (c) => {
      const member = c.get("member");
      const id = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(id)) {
        return c.json({ error: "Perfil não encontrado" }, 404);
      }

      const [row] = await db
        .update(massCompositionProfile)
        .set({
          status: "INACTIVE",
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

      if (!row) {
        return c.json({ error: "Perfil não encontrado" }, 404);
      }
      return c.json({ success: true, id: row.id });
    },
  )

  // =========================================================================
  // GET /:id/label - Get reference standard label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ standard: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveStandardRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      const [found] = await db
        .select({
          id: referenceStandard.id,
          label: referenceStandard.name,
        })
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.id, id),
            eq(referenceStandard.organizationId, member.organizationId),
            buildUnitScopeCondition(referenceStandard.unitId, member),
            isNull(referenceStandard.deletedAt),
          ),
        )
        .limit(1);

      if (!found) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      return c.json(found);
    },
  )

  // =========================================================================
  // GET /:id - Get single reference standard by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ standard: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = await resolveStandardRouteId(c.req.param("id"), member);

    if (id === null) {
      return c.json({ error: "Padrão não encontrado" }, 404);
    }

    const [found] = await db
      .select()
      .from(referenceStandard)
      .where(
        and(
          eq(referenceStandard.id, id),
          eq(referenceStandard.organizationId, member.organizationId),
          buildUnitScopeCondition(referenceStandard.unitId, member),
          isNull(referenceStandard.deletedAt),
        ),
      )
      .limit(1);

    if (!found) {
      return c.json({ error: "Padrão não encontrado" }, 404);
    }

    // Add computed fields
    const now = new Date();
    const certificateDocuments = await currentCertificateDocumentsByStandardId([
      found.id,
    ]);
    const result = {
      ...found,
      certificateDocument: certificateDocuments.get(found.id) ?? null,
      isExpired: found.nextCalibrationDate < now,
      daysUntilExpiry: Math.ceil(
        (found.nextCalibrationDate.getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    };

    return c.json(result);
  })

  // =========================================================================
  // POST /:id/certificate-document - Upload original certificate PDF
  // =========================================================================
  .post(
    "/:id/certificate-document",
    ...withLabPermission({ standard: ["update"] }),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const env = c.env;
      const id = await resolveStandardRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      try {
        const [standard] = await db
          .select()
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.id, id),
              eq(referenceStandard.organizationId, member.organizationId),
              buildUnitScopeCondition(referenceStandard.unitId, member),
              isNull(referenceStandard.deletedAt),
            ),
          )
          .limit(1);

        if (!standard) {
          return c.json({ error: "Padrão não encontrado" }, 404);
        }

        const formData = await c.req.formData();
        const file = formData.get("certificate");

        if (!(file instanceof File)) {
          return c.json({ error: "Nenhum arquivo enviado" }, 400);
        }

        const safeFileName = sanitizeStandardCertificateFileName(file.name);
        if (!safeFileName.toLowerCase().endsWith(".pdf")) {
          return c.json({ error: "Apenas arquivos PDF são permitidos" }, 400);
        }

        if (file.type && file.type !== STANDARD_CERTIFICATE_CONTENT_TYPE) {
          return c.json({ error: "Apenas arquivos PDF são permitidos" }, 400);
        }

        if (file.size > MAX_STANDARD_CERTIFICATE_FILE_SIZE) {
          return c.json(
            {
              error: `Arquivo muito grande. Máximo ${MAX_STANDARD_CERTIFICATE_FILE_SIZE / 1024 / 1024}MB.`,
            },
            400,
          );
        }

        const buffer = await file.arrayBuffer();
        const header = new TextDecoder().decode(buffer.slice(0, 4));
        if (header !== "%PDF") {
          return c.json({ error: "Arquivo PDF inválido" }, 400);
        }

        const sha256 = createHash("sha256")
          .update(Buffer.from(buffer))
          .digest("hex");

        const [created] = await db
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
            r2Key: `pending/standards/${standard.id}/${randomUUID()}.pdf`,
            isCurrent: false,
            uploadedBy: session.user.id,
          })
          .returning();

        if (!created) {
          return c.json({ error: "Falha ao registrar certificado" }, 500);
        }

        const [orgRow] = await db
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, standard.organizationId))
          .limit(1);
        const { bucket, key: r2Key } = standardCertificateKey({
          org: { id: standard.organizationId, slug: orgRow?.slug ?? "" },
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

        const [previousDocument] = await db
          .select()
          .from(referenceStandardCertificateDocument)
          .where(
            and(
              eq(referenceStandardCertificateDocument.standardId, standard.id),
              eq(referenceStandardCertificateDocument.isCurrent, true),
              isFinalizedCertificateDocumentCondition(),
            ),
          )
          .limit(1);

        const [updated] = await db.transaction(async (tx) => {
          await tx
            .update(referenceStandardCertificateDocument)
            .set({ isCurrent: false })
            .where(
              and(
                eq(
                  referenceStandardCertificateDocument.standardId,
                  standard.id,
                ),
                eq(referenceStandardCertificateDocument.isCurrent, true),
              ),
            );

          return tx
            .update(referenceStandardCertificateDocument)
            .set({ r2Key, isCurrent: true })
            .where(eq(referenceStandardCertificateDocument.id, created.id))
            .returning();
        });

        if (!updated) {
          return c.json({ error: "Falha ao ativar certificado" }, 500);
        }

        await db.insert(referenceStandardAuditLog).values({
          standardId: standard.id,
          action: "certificate_document_upload",
          changes: {
            certificateDocument: {
              old: previousDocument
                ? standardCertificateDocumentResponse(previousDocument)
                : null,
              new: standardCertificateDocumentResponse(updated),
            },
          },
          performedBy: session.user.id,
          ipAddress: c.req.header("x-forwarded-for") || null,
        });

        return c.json({
          message: "Certificado enviado com sucesso",
          document: standardCertificateDocumentResponse(updated),
        });
      } catch (error) {
        console.error("Error uploading standard certificate:", error);
        return c.json({ error: "Erro ao enviar certificado" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/certificate-document/download - Download current certificate PDF
  // =========================================================================
  .get(
    "/:id/certificate-document/download",
    ...withLabPermission({ standard: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const env = c.env;
      const id = await resolveStandardRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      try {
        const [document] = await db
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
              isFinalizedCertificateDocumentCondition(),
            ),
          )
          .limit(1);

        if (!document) {
          return c.json({ error: "Certificado não encontrado" }, 404);
        }

        const r2Client = createR2Client(env);
        const url = await generatePresignedUrl(
          r2Client,
          env.R2_BUCKET_NAME,
          document.r2Key,
          STANDARD_CERTIFICATE_URL_EXPIRY,
        );

        return c.json({ url, filename: document.fileName });
      } catch (error) {
        console.error("Error downloading standard certificate:", error);
        return c.json({ error: "Erro ao gerar link de download" }, 500);
      }
    },
  )

  // =========================================================================
  // POST / - Create new reference standard
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ standard: ["create"] }),
    zValidator("json", CreateReferenceStandardSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      if (!member.activeUnitId) {
        return c.json(
          { error: "Selecione uma unidade específica para criar padrões" },
          400,
        );
      }

      // Create the reference standard
      const [newStandard] = await db
        .insert(referenceStandard)
        .values({
          unitId: member.activeUnitId,
          organizationId: member.organizationId,
          name: input.name,
          kind: input.kind,
          type: input.type || null,
          serialNumber: input.serialNumber,
          manufacturer: input.manufacturer || null,
          model: input.model || null,
          certificateNumber: input.certificateNumber,
          calibratedBy: input.calibratedBy || null,
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
        return c.json({ error: "Falha ao criar padrão" }, 500);
      }

      // Audit log
      await db.insert(referenceStandardAuditLog).values({
        standardId: newStandard.id,
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
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      void recordActivationMilestone(
        member.organizationId,
        "referenceStandard",
      );

      return c.json(newStandard, 201);
    },
  )

  // =========================================================================
  // PUT /:id - Update existing reference standard
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ standard: ["update"] }),
    zValidator("json", UpdateReferenceStandardSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveStandardRouteId(c.req.param("id"), member);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      // Get existing standard
      const [existing] = await db
        .select()
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.id, id),
            eq(referenceStandard.organizationId, member.organizationId),
            buildUnitScopeCondition(referenceStandard.unitId, member),
            isNull(referenceStandard.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      // Build changes object for audit log
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const updateData: Record<string, unknown> = {};

      // Check each field for changes
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
      if (input.calibrationDate !== undefined) {
        const newDate = new Date(input.calibrationDate);
        if (newDate.getTime() !== existing.calibrationDate.getTime()) {
          changes.calibrationDate = {
            old: existing.calibrationDate.toISOString(),
            new: newDate.toISOString(),
          };
          updateData.calibrationDate = newDate;
        }
      }
      if (input.nextCalibrationDate !== undefined) {
        const newDate = new Date(input.nextCalibrationDate);
        if (newDate.getTime() !== existing.nextCalibrationDate.getTime()) {
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
        // Compare JSON stringified versions
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
        updateData.status = input.status;
      }

      // If no changes, return existing
      if (Object.keys(updateData).length === 0) {
        return c.json(existing);
      }

      // Update the standard
      const [updated] = await db
        .update(referenceStandard)
        .set(updateData)
        .where(eq(referenceStandard.id, id))
        .returning();

      // Audit log
      await db.insert(referenceStandardAuditLog).values({
        standardId: id,
        action: changes.status ? "status_change" : "update",
        changes,
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // #426 Phase 1: flagging a standard OUT_OF_TOLERANCE auto-opens the
      // §7.10 recall workflow (typed NC + DRAFT recall). Best-effort — the
      // status change itself must not fail if the hook does; the wizard's
      // send endpoint re-ensures the recall exists.
      if (
        changes.status &&
        updated &&
        updated.status === "OUT_OF_TOLERANCE" &&
        existing.status !== "OUT_OF_TOLERANCE"
      ) {
        await ensureStandardRecall({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          standard: {
            id: updated.id,
            name: updated.name,
            serialNumber: updated.serialNumber,
            certificateNumber: updated.certificateNumber,
            calibrationDate: updated.calibrationDate,
          },
          ipAddress: c.req.header("x-forwarded-for") || null,
        }).catch((err) =>
          console.error(
            `[Standards] Failed to open recall for standard ${id}:`,
            err,
          ),
        );
      }

      return c.json(updated);
    },
  )

  // =========================================================================
  // GET /:id/impacted-certificates - Reverse traceability (#426 Phase 1):
  // approved certificates that relied on this standard in a date window.
  // =========================================================================
  .get(
    "/:id/impacted-certificates",
    ...withLabPermission({ standard: ["read"] }),
    zValidator("query", ImpactedCertificatesQuerySchema),
    async (c) => {
      const member = c.get("member");
      const id = await resolveStandardRouteId(c.req.param("id"), member);
      const query = c.req.valid("query");

      if (id === null) {
        return c.json({ error: "Padrao nao encontrado" }, 404);
      }

      const [standard] = await db
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
        return c.json({ error: "Padrao nao encontrado" }, 404);
      }

      // Default window: the standard's (now suspect) certificate validity
      // start → now. Both bounds editable (over-notification mitigation).
      const from = query.from ? new Date(query.from) : standard.calibrationDate;
      const to = query.to ? new Date(query.to) : new Date();

      const impacted = await findImpactedCertificates({
        standardId: id,
        organizationId: member.organizationId,
        from,
        to,
      });

      return c.json({
        data: impacted,
        window: { from: from.toISOString(), to: to.toISOString() },
      });
    },
  )

  // =========================================================================
  // GET /:id/recall - Current recall campaign + per-certificate notification
  // status and sent/acknowledged/bounced counts (#426 Phase 1).
  // =========================================================================
  .get(
    "/:id/recall",
    ...withLabPermission({ standard: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveStandardRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "Padrao nao encontrado" }, 404);
      }

      const [recall] = await db
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
        return c.json({ data: null });
      }

      const notifications = await db
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
        ? await db
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

      return c.json({
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
      });
    },
  )

  // =========================================================================
  // POST /:id/recall/send - Approval-gated batch send (#426 Phase 1).
  // Requires an org-level admin/owner (§7.10.1 defined responsibilities);
  // approver + timestamp are recorded on the recall.
  // =========================================================================
  .post(
    "/:id/recall/send",
    ...withLabPermission({ standard: ["update"] }),
    zValidator("json", SendStandardRecallSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveStandardRouteId(c.req.param("id"), member);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Padrao nao encontrado" }, 404);
      }

      // Elevated approval gate: same pattern as NC use_as_is/concession
      // dispositions — org-level admin/owner only (a unit_admin elevation is
      // not enough to approve a customer-facing batch recall).
      if (member.role !== "admin" && member.role !== "owner") {
        return c.json(
          {
            error:
              "O envio de recall em lote requer aprovacao de um administrador ou responsavel",
          },
          403,
        );
      }

      const [standard] = await db
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
        return c.json({ error: "Padrao nao encontrado" }, 404);
      }

      if (standard.status !== "OUT_OF_TOLERANCE") {
        return c.json(
          {
            error:
              "Apenas padroes com status fora de tolerancia podem originar um recall",
            code: "STANDARD_NOT_OUT_OF_TOLERANCE",
          },
          409,
        );
      }

      // Re-ensure the recall exists (covers a failed status-change hook).
      const { recall } = await ensureStandardRecall({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        standard: {
          id: standard.id,
          name: standard.name,
          serialNumber: standard.serialNumber,
          certificateNumber: standard.certificateNumber,
          calibrationDate: standard.calibrationDate,
        },
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Every selected job must actually be linked to this standard — the
      // reviewed list from the wizard is re-validated, never trusted.
      const linkedRows = await db
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
        return c.json(
          {
            error: `Certificados fora do escopo deste padrao: ${invalidIds.join(", ")}`,
            code: "JOBS_NOT_LINKED_TO_STANDARD",
          },
          400,
        );
      }

      // Stamp the approval + reviewed window before dispatching (§7.10.2
      // evidence: who approved the batch and what window was reviewed).
      const [approvedRecall] = await db
        .update(standardRecall)
        .set({
          status: "SENT",
          fromDate: input.from ? new Date(input.from) : recall.fromDate,
          toDate: input.to ? new Date(input.to) : new Date(),
          approvedBy: session.user.id,
          approvedAt: new Date(),
        })
        .where(
          and(
            eq(standardRecall.id, recall.id),
            eq(standardRecall.organizationId, member.organizationId),
          ),
        )
        .returning();

      await db.insert(referenceStandardAuditLog).values({
        standardId: id,
        action: "recall_send",
        changes: {
          recallId: recall.id,
          jobIds: input.jobIds,
          from: input.from ?? recall.fromDate?.toISOString() ?? null,
          to: input.to ?? null,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: `Recall §7.10 aprovado: ${input.jobIds.length} certificado(s) notificado(s)`,
      });

      const result = await createStandardRecallNotifications({
        recall: approvedRecall ?? recall,
        jobIds: input.jobIds,
        organizationId: member.organizationId,
        actorUserId: session.user.id,
      });

      return c.json({
        message: "Recall aprovado e notificacoes em envio",
        data: {
          recallId: recall.id,
          created: result.created,
          skipped: result.skipped,
        },
      });
    },
  )

  // =========================================================================
  // DELETE /:id - Soft delete reference standard
  // =========================================================================
  .delete("/:id", ...withLabPermission({ standard: ["delete"] }), async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = await resolveStandardRouteId(c.req.param("id"), member);

    if (id === null) {
      return c.json({ error: "Padrão não encontrado" }, 404);
    }

    const [existing] = await db
      .select()
      .from(referenceStandard)
      .where(
        and(
          eq(referenceStandard.id, id),
          eq(referenceStandard.organizationId, member.organizationId),
          buildUnitScopeCondition(referenceStandard.unitId, member),
          isNull(referenceStandard.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json({ error: "Padrão não encontrado" }, 404);
    }

    // Soft delete
    const [updated] = await db
      .update(referenceStandard)
      .set({ deletedAt: new Date(), status: "INACTIVE" })
      .where(eq(referenceStandard.id, id))
      .returning();

    // Audit log
    await db.insert(referenceStandardAuditLog).values({
      standardId: id,
      action: "delete",
      changes: { deletedAt: { old: null, new: new Date().toISOString() } },
      performedBy: session.user.id,
      ipAddress: c.req.header("x-forwarded-for") || null,
    });

    return c.json({
      message: "Padrão removido com sucesso",
      data: updated,
    });
  })

  // =========================================================================
  // POST /:id/renew - Renew calibration certificate
  // This is a special action that updates certificate data with audit reason
  // =========================================================================
  .post(
    "/:id/renew",
    ...withLabPermission({ standard: ["renew"] }),
    zValidator("json", RenewCertificateSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = await resolveStandardRouteId(c.req.param("id"), member);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      // Get existing standard
      const [existing] = await db
        .select()
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.id, id),
            eq(referenceStandard.organizationId, member.organizationId),
            buildUnitScopeCondition(referenceStandard.unitId, member),
            isNull(referenceStandard.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Padrão nao encontrado" }, 404);
      }

      // Build changes object
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const updateData: Record<string, unknown> = {};

      // Certificate data (required for renewal)
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

      // Optional metrology updates
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

      // If standard was OUT_OF_TOLERANCE or SENT_FOR_CALIBRATION, set back to ACTIVE
      if (
        existing.status === "OUT_OF_TOLERANCE" ||
        existing.status === "SENT_FOR_CALIBRATION"
      ) {
        changes.status = { old: existing.status, new: "ACTIVE" };
        updateData.status = "ACTIVE";
      }

      // Update the standard
      const [updated] = await db
        .update(referenceStandard)
        .set(updateData)
        .where(eq(referenceStandard.id, id))
        .returning();

      // Audit log with reason (required for ISO 17025)
      await db.insert(referenceStandardAuditLog).values({
        standardId: id,
        action: "renew",
        changes,
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason,
      });

      return c.json({
        message: "Certificado renovado com sucesso",
        data: updated,
      });
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit log for a standard
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ standard: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveStandardRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "Padrão não encontrado" }, 404);
      }

      // Verify standard exists and belongs to organization
      const [existing] = await db
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
        return c.json({ error: "Padrão nao encontrado" }, 404);
      }

      // Get audit logs
      const logs = await db
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

      return c.json({ data: logs });
    },
  );
