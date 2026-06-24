import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  accountInteraction,
  calibrationJob,
  calibrationRequest,
  certificateRelease,
  entitlementOverride,
  importRun,
  organization,
  organizationIntegration,
  organizationSuccessProfile,
  organizationSupportRequest,
  organizationUnit,
  subscription,
  user as userTable,
} from "@calibra-facil/db/schema";
import { FEATURE_FLAGS } from "@calibra-facil/shared";
import {
  IMPORT_FIELDS,
  ImportValidateInputSchema,
  validateImportRows,
} from "@calibra-facil/schemas";
import { parseSpreadsheet } from "../lib/import-parse";
import {
  requirePlatformAdmin,
  type AuthVariables,
} from "../middleware/permission";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import { logPlatformEvent } from "./backoffice-platform-log";

const GrantEntitlementOverrideSchema = z.object({
  feature: z.enum(FEATURE_FLAGS),
  reason: z.string().trim().max(500).optional(),
  expiresAt: z.string().datetime().optional(),
});

const OrganizationLifecycleSchema = z.object({
  action: z.enum([
    "suspend",
    "reactivate",
    "schedule_offboard",
    "cancel_offboard",
  ]),
  reason: z.string().trim().max(500).optional(),
  graceDays: z.number().int().min(0).max(365).optional(),
});

const ImportParseSchema = z.object({
  // base64 of the uploaded spreadsheet; ~14M chars ≈ a 10MB file.
  fileBase64: z.string().min(1).max(14_000_000),
  fileName: z.string().trim().max(300).optional(),
});

const ManageSubscriptionSchema = z.object({
  action: z.enum(["change_plan", "cancel", "reactivate"]),
  planId: z.enum(["FREE", "STANDARD", "PROFESSIONAL", "ENTERPRISE"]).optional(),
  reason: z.string().trim().max(500).optional(),
});

const CreateInteractionSchema = z.object({
  channel: z.enum(["whatsapp", "email", "phone", "meeting", "note", "other"]),
  direction: z.enum(["outbound", "inbound", "internal"]).optional(),
  summary: z.string().trim().min(2).max(2000),
  occurredAt: z.string().datetime().optional(),
});

// Backoffice organizations sub-router. Mounted on the backoffice parent INSIDE
// the access-gated zone (after `requireBackofficeAuthSession` +
// `requireBackofficeAccess`), so every route here inherits auth + the
// backoffice-access gate. Admin-only routes keep their inline
// `requirePlatformAdmin` guard exactly as before the extraction. The sub-router
// deliberately defines NO `onError` so errors propagate to the parent's
// `onError`, preserving the `{ error: message }` response shape.
export const backofficeOrganizationsRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .get("/", async (c) => {
    const rows = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        type: organization.type,
        createdAt: organization.createdAt,
        successProfileUpdatedAt: organizationSuccessProfile.updatedAt,
        onboardingStatus: organizationSuccessProfile.onboardingStatus,
        migrationStatus: organizationSuccessProfile.migrationStatus,
        unitsCount: sql<number>`count(distinct ${organizationUnit.id})`,
        integrationsCount: sql<number>`count(distinct ${organizationIntegration.id})`,
        openRequestsCount: sql<number>`count(distinct case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') then ${organizationSupportRequest.id} end)`,
      })
      .from(organization)
      .leftJoin(
        organizationSuccessProfile,
        eq(organizationSuccessProfile.organizationId, organization.id),
      )
      .leftJoin(
        organizationUnit,
        eq(organizationUnit.organizationId, organization.id),
      )
      .leftJoin(
        organizationIntegration,
        eq(organizationIntegration.organizationId, organization.id),
      )
      .leftJoin(
        organizationSupportRequest,
        eq(organizationSupportRequest.organizationId, organization.id),
      )
      .where(eq(organization.type, "LAB"))
      .groupBy(
        organization.id,
        organization.name,
        organization.slug,
        organization.type,
        organization.createdAt,
        organizationSuccessProfile.updatedAt,
        organizationSuccessProfile.onboardingStatus,
        organizationSuccessProfile.migrationStatus,
      )
      .orderBy(asc(organization.name));

    return c.json({ data: rows });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const org = await db.query.organization.findFirst({
      where: and(eq(organization.id, id), eq(organization.type, "LAB")),
    });

    if (!org) {
      return c.json({ error: "Organização não encontrada" }, 404);
    }

    const [units, integrations, supportSummary, successProfile, planAccess] =
      await Promise.all([
        db.query.organizationUnit.findMany({
          where: eq(organizationUnit.organizationId, id),
          orderBy: [asc(organizationUnit.name)],
        }),
        db.query.organizationIntegration.findMany({
          where: eq(organizationIntegration.organizationId, id),
          orderBy: [desc(organizationIntegration.createdAt)],
        }),
        db
          .select({
            total: sql<number>`count(*)`,
            open: sql<number>`count(case when ${organizationSupportRequest.status} in ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER') then 1 end)`,
          })
          .from(organizationSupportRequest)
          .where(eq(organizationSupportRequest.organizationId, id)),
        db.query.organizationSuccessProfile.findFirst({
          where: eq(organizationSuccessProfile.organizationId, id),
        }),
        getOrganizationPlanAccess(id),
      ]);

    return c.json({
      organization: org,
      units,
      integrations,
      successProfile,
      support: supportSummary[0] ?? { total: 0, open: 0 },
      plan: planAccess,
    });
  })
  // Tenant lifecycle (admin-only): suspend / reactivate / schedule offboarding
  // from the console instead of editing the DB. A SUSPENDED org is blocked at
  // `requireOrganization`; OFFBOARDING records a deletion grace window.
  .post(
    "/:id/lifecycle",
    requirePlatformAdmin,
    zValidator("json", OrganizationLifecycleSchema),
    async (c) => {
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, id),
      });
      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const now = new Date();
      const setValues: Partial<typeof organization.$inferInsert> = {};
      switch (input.action) {
        case "suspend":
          setValues.status = "SUSPENDED";
          setValues.suspendedAt = now;
          setValues.suspensionReason = input.reason ?? null;
          break;
        case "reactivate":
          setValues.status = "ACTIVE";
          setValues.suspendedAt = null;
          setValues.suspensionReason = null;
          setValues.deletionScheduledAt = null;
          break;
        case "schedule_offboard":
          setValues.status = "OFFBOARDING";
          setValues.deletionScheduledAt = new Date(
            now.getTime() + (input.graceDays ?? 30) * 24 * 60 * 60 * 1000,
          );
          if (input.reason) setValues.suspensionReason = input.reason;
          break;
        case "cancel_offboard":
          setValues.status =
            org.status === "OFFBOARDING" ? "ACTIVE" : org.status;
          setValues.deletionScheduledAt = null;
          break;
      }

      const updatedRows = await db
        .update(organization)
        .set(setValues)
        .where(eq(organization.id, id))
        .returning();
      const updatedRow = updatedRows[0];
      if (!updatedRow) {
        return c.json({ error: "Falha ao atualizar a conta" }, 500);
      }
      // `db` is a Proxy over a union of the neon + postgres-js drivers, so a
      // typed `.returning({...})` collapses to the 0-arg overload (TS2554).
      // Use 0-arg returning and project explicitly so the response keeps its
      // shape without leaking the full organization row.
      const updated = {
        id: updatedRow.id,
        status: updatedRow.status,
        suspendedAt: updatedRow.suspendedAt,
        suspensionReason: updatedRow.suspensionReason,
        deletionScheduledAt: updatedRow.deletionScheduledAt,
      };

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: `backoffice.organization.${input.action}`,
        entityType: "organization",
        entityId: id,
        details: {
          reason: input.reason ?? null,
          status: updated.status,
        },
      });

      return c.json(updated);
    },
  )
  // Entitlement overrides — grant-only feature access on top of the plan (comps,
  // upsell trials). Merged into getOrganizationPlanAccess; list is operator-
  // visible, grant/revoke are admin-only. All recorded in the audit log.
  .get("/:id/entitlement-overrides", async (c) => {
    const id = c.req.param("id");
    const rows = await db
      .select({
        id: entitlementOverride.id,
        feature: entitlementOverride.feature,
        reason: entitlementOverride.reason,
        expiresAt: entitlementOverride.expiresAt,
        createdAt: entitlementOverride.createdAt,
        createdByUserId: entitlementOverride.createdByUserId,
      })
      .from(entitlementOverride)
      .where(eq(entitlementOverride.organizationId, id))
      .orderBy(desc(entitlementOverride.createdAt));

    const userIds = Array.from(
      new Set(
        rows
          .map((row) => row.createdByUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const users =
      userIds.length > 0
        ? await db
            .select({ id: userTable.id, name: userTable.name })
            .from(userTable)
            .where(inArray(userTable.id, userIds))
        : [];
    const nameById = new Map(users.map((entry) => [entry.id, entry.name]));

    const data = rows.map((row) => ({
      ...row,
      createdByName: row.createdByUserId
        ? (nameById.get(row.createdByUserId) ?? null)
        : null,
    }));

    return c.json({ data });
  })
  .post(
    "/:id/entitlement-overrides",
    requirePlatformAdmin,
    zValidator("json", GrantEntitlementOverrideSchema),
    async (c) => {
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, id),
      });
      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const inserted = await db
        .insert(entitlementOverride)
        .values({
          organizationId: id,
          feature: input.feature,
          reason: input.reason || null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdByUserId: session.user.id,
        })
        .returning();
      const created = inserted[0];
      if (!created) {
        return c.json({ error: "Falha ao conceder acesso" }, 500);
      }

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: "backoffice.entitlement_override.granted",
        entityType: "organization",
        entityId: id,
        details: { feature: input.feature, reason: input.reason ?? null },
      });

      return c.json(created);
    },
  )
  // Managed subscription lifecycle (gap #10 core) — operator-driven plan change,
  // cancel-with-reason and reactivate over the local `subscription` row, audited.
  // Entitlements follow `getOrganizationPlanAccess` immediately. The Asaas billing
  // sync (proration, provider state) is the external follow-up — the operator
  // reconciles billing separately; this never touches billing credentials.
  .post(
    "/:id/subscription",
    requirePlatformAdmin,
    zValidator("json", ManageSubscriptionSchema),
    async (c) => {
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, id),
      });
      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const existing = await db.query.subscription.findFirst({
        where: eq(subscription.organizationId, id),
      });

      const summarize = (row: typeof subscription.$inferSelect | undefined) =>
        row
          ? {
              planId: row.planId,
              status: row.status,
              canceledAt: row.canceledAt,
              cancelReason: row.cancelReason,
              currentPeriodEnd: row.currentPeriodEnd,
            }
          : null;

      if (input.action === "change_plan") {
        if (!input.planId) {
          return c.json({ error: "Plano é obrigatório" }, 400);
        }
        const rows = existing
          ? await db
              .update(subscription)
              .set({
                planId: input.planId,
                status: "ACTIVE",
                canceledAt: null,
                cancelReason: null,
                updatedAt: new Date(),
              })
              .where(eq(subscription.id, existing.id))
              .returning()
          : await db
              .insert(subscription)
              .values({
                organizationId: id,
                planId: input.planId,
                status: "ACTIVE",
              })
              .returning();

        await logPlatformEvent({
          actorUserId: session.user.id,
          action: "backoffice.subscription.plan_changed",
          entityType: "organization",
          entityId: id,
          details: {
            planId: input.planId,
            previousPlanId: existing?.planId ?? null,
          },
        });
        return c.json(summarize(rows[0]));
      }

      if (!existing) {
        return c.json({ error: "Organização sem assinatura" }, 404);
      }

      if (input.action === "cancel") {
        const reason = input.reason?.trim() ?? "";
        if (reason.length < 5) {
          return c.json({ error: "Informe o motivo do cancelamento" }, 400);
        }
        const rows = await db
          .update(subscription)
          .set({
            status: "CANCELED",
            canceledAt: new Date(),
            cancelReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(subscription.id, existing.id))
          .returning();

        await logPlatformEvent({
          actorUserId: session.user.id,
          action: "backoffice.subscription.canceled",
          entityType: "organization",
          entityId: id,
          details: { planId: existing.planId, reason },
        });
        return c.json(summarize(rows[0]));
      }

      // reactivate
      const rows = await db
        .update(subscription)
        .set({
          status: "ACTIVE",
          canceledAt: null,
          cancelReason: null,
          updatedAt: new Date(),
        })
        .where(eq(subscription.id, existing.id))
        .returning();

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: "backoffice.subscription.reactivated",
        entityType: "organization",
        entityId: id,
        details: { planId: existing.planId },
      });
      return c.json(summarize(rows[0]));
    },
  )
  // Derived product-usage telemetry (gap #1 core) — operator evidence of whether
  // a lab is *actually* producing work, read live off existing domain tables (no
  // event spine / instrumentation yet). Jobs, certificate releases and portal
  // calibration requests are the load-bearing "is this account alive" signals.
  .get("/:id/activity", async (c) => {
    const id = c.req.param("id");
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    const [jobs, certificates, requests] = await Promise.all([
      db
        .select({
          last: max(calibrationJob.createdAt),
          total: count(),
          recent: sql<number>`count(*) filter (where ${calibrationJob.createdAt} >= ${sinceIso})`,
        })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, id)),
      db
        .select({
          last: max(certificateRelease.createdAt),
          total: count(),
          recent: sql<number>`count(*) filter (where ${certificateRelease.createdAt} >= ${sinceIso})`,
        })
        .from(certificateRelease)
        .where(eq(certificateRelease.organizationId, id)),
      db
        .select({
          last: max(calibrationRequest.createdAt),
          total: count(),
          recent: sql<number>`count(*) filter (where ${calibrationRequest.createdAt} >= ${sinceIso})`,
        })
        .from(calibrationRequest)
        .where(eq(calibrationRequest.organizationId, id)),
    ]);

    const section = (
      row: { last: Date | null; total: number; recent: number } | undefined,
    ) => ({
      lastAt: row?.last ? row.last.toISOString() : null,
      total: Number(row?.total ?? 0),
      last30d: Number(row?.recent ?? 0),
    });

    const jobsSection = section(jobs[0]);
    const certificatesSection = section(certificates[0]);
    const requestsSection = section(requests[0]);

    const lastActiveAt = [
      jobsSection.lastAt,
      certificatesSection.lastAt,
      requestsSection.lastAt,
    ]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return c.json({
      lastActiveAt: lastActiveAt ?? null,
      jobs: jobsSection,
      certificates: certificatesSection,
      requests: requestsSection,
    });
  })
  // Migration importer (gap #12, preview-only). The client uploads a spreadsheet
  // (CSV is parsed in the browser; .xlsx is parsed here via excelts) and maps
  // columns; the server runs the pure dry-run validation, persists an `import_run`
  // audit row and returns the result + field contract. No domain records are
  // written — the commit is a gated follow-up.
  .post(
    "/:id/import-runs/parse",
    zValidator("json", ImportParseSchema),
    async (c) => {
      const input = c.req.valid("json");
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(Buffer.from(input.fileBase64, "base64"));
      } catch {
        return c.json({ error: "Arquivo inválido" }, 400);
      }
      if (bytes.length === 0) {
        return c.json({ error: "Arquivo vazio" }, 400);
      }
      try {
        const parsed = await parseSpreadsheet(bytes);
        return c.json(parsed);
      } catch (error) {
        console.error("Failed to parse import spreadsheet", error);
        return c.json({ error: "Não foi possível ler a planilha" }, 422);
      }
    },
  )
  .post(
    "/:id/import-runs/validate",
    zValidator("json", ImportValidateInputSchema),
    async (c) => {
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, id),
      });
      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const result = validateImportRows(input.entity, input.rows);

      const inserted = await db
        .insert(importRun)
        .values({
          organizationId: id,
          entity: input.entity,
          fileName: input.fileName ?? null,
          status: "VALIDATED",
          totalRows: result.totalRows,
          validRows: result.validRows,
          errorRows: result.errorRows,
          mapping: input.mapping ?? null,
          errorsSample: result.errors,
          createdByUserId: session.user.id,
        })
        .returning();
      const run = inserted[0];

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: "backoffice.import_run.validated",
        entityType: "organization",
        entityId: id,
        details: {
          entity: input.entity,
          fileName: input.fileName ?? null,
          totalRows: result.totalRows,
          validRows: result.validRows,
          errorRows: result.errorRows,
        },
      });

      return c.json({
        importRunId: run?.id ?? null,
        fields: IMPORT_FIELDS[input.entity],
        result,
      });
    },
  )
  .get("/:id/import-runs", async (c) => {
    const id = c.req.param("id");
    const rows = await db
      .select({
        id: importRun.id,
        entity: importRun.entity,
        fileName: importRun.fileName,
        status: importRun.status,
        totalRows: importRun.totalRows,
        validRows: importRun.validRows,
        errorRows: importRun.errorRows,
        createdAt: importRun.createdAt,
        createdByUserId: importRun.createdByUserId,
      })
      .from(importRun)
      .where(eq(importRun.organizationId, id))
      .orderBy(desc(importRun.createdAt))
      .limit(20);

    const userIds = Array.from(
      new Set(
        rows
          .map((row) => row.createdByUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const users =
      userIds.length > 0
        ? await db
            .select({ id: userTable.id, name: userTable.name })
            .from(userTable)
            .where(inArray(userTable.id, userIds))
        : [];
    const nameById = new Map(users.map((entry) => [entry.id, entry.name]));

    const data = rows.map((row) => ({
      ...row,
      createdByName: row.createdByUserId
        ? (nameById.get(row.createdByUserId) ?? null)
        : null,
    }));

    return c.json({ data });
  })
  // Account interaction log (gap #14, omnichannel core) — a unified, manually
  // recorded timeline of operator↔tenant touchpoints. Auto-capture from the
  // channels (WhatsApp/email providers) is the external follow-up.
  .get("/:id/interactions", async (c) => {
    const id = c.req.param("id");
    const rows = await db
      .select({
        id: accountInteraction.id,
        channel: accountInteraction.channel,
        direction: accountInteraction.direction,
        summary: accountInteraction.summary,
        occurredAt: accountInteraction.occurredAt,
        createdByUserId: accountInteraction.createdByUserId,
        createdAt: accountInteraction.createdAt,
      })
      .from(accountInteraction)
      .where(eq(accountInteraction.organizationId, id))
      .orderBy(desc(accountInteraction.occurredAt))
      .limit(100);

    const userIds = Array.from(
      new Set(
        rows
          .map((row) => row.createdByUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const users =
      userIds.length > 0
        ? await db
            .select({ id: userTable.id, name: userTable.name })
            .from(userTable)
            .where(inArray(userTable.id, userIds))
        : [];
    const nameById = new Map(users.map((entry) => [entry.id, entry.name]));

    const data = rows.map((row) => ({
      ...row,
      createdByName: row.createdByUserId
        ? (nameById.get(row.createdByUserId) ?? null)
        : null,
    }));

    return c.json({ data });
  })
  .post(
    "/:id/interactions",
    zValidator("json", CreateInteractionSchema),
    async (c) => {
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, id),
      });
      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const inserted = await db
        .insert(accountInteraction)
        .values({
          organizationId: id,
          channel: input.channel,
          direction: input.direction ?? "outbound",
          summary: input.summary,
          occurredAt: input.occurredAt
            ? new Date(input.occurredAt)
            : new Date(),
          createdByUserId: session.user.id,
        })
        .returning();
      const created = inserted[0];
      if (!created) {
        return c.json({ error: "Falha ao registrar interação" }, 500);
      }

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: "backoffice.interaction.recorded",
        entityType: "organization",
        entityId: id,
        details: { channel: input.channel, direction: created.direction },
      });

      return c.json(created);
    },
  );
