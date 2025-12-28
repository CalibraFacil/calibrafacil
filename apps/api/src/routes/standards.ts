import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  referenceStandard,
  referenceStandardAuditLog,
} from "@calibra-facil/db/schema";
import {
  CreateReferenceStandardSchema,
  UpdateReferenceStandardSchema,
  ListReferenceStandardsQuerySchema,
  RenewCertificateSchema,
} from "@calibra-facil/schemas";
import {
  withLabPermission,
  withPermission,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, or, ilike, desc, count, isNull, lte, gte } from "drizzle-orm";

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
export const standardsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List reference standards with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withPermission({ standard: ["read"] }),
    zValidator("query", ListReferenceStandardsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, query, status, expiringWithinDays } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      // Build conditions - always scope to organization and exclude soft-deleted
      const conditions = [
        eq(referenceStandard.organizationId, member.organizationId),
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
      const standardsWithExpiry = standards.map((s) => ({
        ...s,
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
  // GET /:id - Get single reference standard by ID
  // =========================================================================
  .get("/:id", ...withPermission({ standard: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const [found] = await db
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

    if (!found) {
      return c.json({ error: "Padrão não encontrado" }, 404);
    }

    // Add computed fields
    const now = new Date();
    const result = {
      ...found,
      isExpired: found.nextCalibrationDate < now,
      daysUntilExpiry: Math.ceil(
        (found.nextCalibrationDate.getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    };

    return c.json(result);
  })

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

      // Create the reference standard
      const [newStandard] = await db
        .insert(referenceStandard)
        .values({
          organizationId: member.organizationId,
          name: input.name,
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
        changes: { initial: input },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

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
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing standard
      const [existing] = await db
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

      return c.json(updated);
    },
  )

  // =========================================================================
  // DELETE /:id - Soft delete reference standard
  // =========================================================================
  .delete("/:id", ...withLabPermission({ standard: ["delete"] }), async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const [existing] = await db
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
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Get existing standard
      const [existing] = await db
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
    ...withPermission({ standard: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // Verify standard exists and belongs to organization
      const [existing] = await db
        .select({ id: referenceStandard.id })
        .from(referenceStandard)
        .where(
          and(
            eq(referenceStandard.id, id),
            eq(referenceStandard.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Padrão nao encontrado" }, 404);
      }

      // Get audit logs
      const logs = await db
        .select()
        .from(referenceStandardAuditLog)
        .where(eq(referenceStandardAuditLog.standardId, id))
        .orderBy(desc(referenceStandardAuditLog.performedAt));

      return c.json({ data: logs });
    },
  );
