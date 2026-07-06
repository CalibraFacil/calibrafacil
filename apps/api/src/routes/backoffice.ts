import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";
import { createLabAuth, sendLabAccountSetupEmail } from "@calibra-facil/auth";
import {
  buildLabClaimUrl,
  createLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import { db } from "@calibra-facil/db";
import {
  accountTask,
  appQueueJob,
  approvalRequest,
  entitlementOverride,
  member,
  operatorAlert,
  organization,
  organizationIntegration,
  organizationSuccessProfile,
  organizationSupportRequest,
  platformEventLog,
  serviceOrderEmailOutbox,
  session as authSession,
  subscription,
  user as userTable,
} from "@calibra-facil/db/schema";
import { recomputeOperatorAlerts } from "../lib/operator-alerts";
import { shapeRecentQueueFailures } from "../lib/observability-alerts";
import { isSameDualControlIdentity } from "../lib/dual-control";
import {
  canAccessBackoffice,
  parsePlatformRoles,
} from "@calibra-facil/auth/access";
import {
  requireBackofficeAccess,
  requireBackofficeAuthSession,
  requirePlatformAdmin,
  type AuthVariables,
} from "../middleware/permission";
import { internalCustomerSuccessRouter } from "./internal-customer-success";
import { backofficeCommercialRouter } from "./backoffice-commercial";
import { backofficeOrganizationsRouter } from "./backoffice-organizations";
import { backofficeAssetTypesRouter } from "./backoffice-asset-types";
import { backofficeUsersRouter } from "./backoffice-users";
import { logPlatformEvent } from "./backoffice-platform-log";
import {
  extractErrorMessage,
  forwardLabAuthResponse,
  getEnvValue,
  platformUserFromUnknown,
  recordFromUnknown,
  resolveTrustedAppUrl,
} from "./backoffice-shared";
import { userCreateErrorWasDuplicate } from "../lib/auth-user-errors";
import { getOrganizationPlanAccess } from "../lib/organization-plan";
import {
  buildWorkflowDelays,
  deriveDefaultSlaTier,
  deriveGoLiveStatus,
  deriveHealthStatus,
  deriveNextActionStatus,
  getActiveCustomerSuccessBlockers,
  resolveDueSoonThresholdHours,
  resolveEffectiveSlaHours,
  getSupportRequestAttentionScore,
  getSupportRequestNeedsEscalation,
  getSupportRequestSlaStatus,
} from "../lib/customer-success";

const BootstrapSchema = z.object({
  token: z.string().min(1),
});

const OptionalTrimmedStringSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().trim().optional(),
);

const OptionalEmailSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase())
    .optional(),
);

const ProvisionLabAccountSchema = z.object({
  lab: z.object({
    name: z.string().trim().min(2).max(160),
    slug: OptionalTrimmedStringSchema,
    cnpj: OptionalTrimmedStringSchema,
    email: OptionalEmailSchema,
    phone: OptionalTrimmedStringSchema,
    planId: z
      .enum(["FREE", "STANDARD", "PROFESSIONAL", "ENTERPRISE"])
      .default("FREE"),
  }),
  owner: z.object({
    name: z.string().trim().min(2).max(120),
    email: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase()),
  }),
  onboarding: z
    .object({
      sendSetupEmail: z.boolean().default(true),
    })
    .default({ sendSetupEmail: true }),
});

const ImpersonationBridgeSchema = z.object({
  token: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
});

function getAppRedirectErrorUrl(c: {
  req: {
    header(name: string): string | undefined;
  };
  env?: unknown;
}) {
  // Impersonation is initiated from the backoffice app (ops.calibrafacil.com),
  // whose users page is served at /users (the /backoffice prefix was dropped
  // when it was extracted from the lab app).
  return `${resolveAppUrl(c)}/users`;
}

function redirectToAppWithError(
  c: {
    req: {
      header(name: string): string | undefined;
    };
    env?: unknown;
  },
  message: string,
) {
  const url = new URL(getAppRedirectErrorUrl(c));
  url.searchParams.set("impersonationError", message);

  return Response.redirect(url.toString(), 302);
}

function splitCombinedSetCookieHeader(value: string) {
  return value
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((cookie) => cookie.trim())
    .filter(Boolean);
}

function getSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = Reflect.get(headers, "getSetCookie");

  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(headers);
    return Array.isArray(values) ? values : [];
  }

  const value = headers.get("set-cookie");
  return value ? splitCombinedSetCookieHeader(value) : [];
}

function extractCookieHeaderFromResponseHeaders(headers: Headers) {
  const cookies = getSetCookieHeaders(headers)
    .map((value) => value.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean);

  return cookies.join("; ");
}

function createRedirectWithResponseCookies(params: {
  response: Response;
  location: string;
}) {
  const headers = new Headers();

  for (const [name, value] of params.response.headers.entries()) {
    const normalizedName = name.toLowerCase();

    if (
      normalizedName === "set-cookie" ||
      normalizedName === "content-length"
    ) {
      continue;
    }

    headers.set(name, value);
  }

  headers.set("Location", params.location);

  for (const cookie of getSetCookieHeaders(params.response.headers)) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, {
    status: 302,
    headers,
  });
}

async function hasAnyPlatformAdmin() {
  const existing = await db.query.user.findFirst({
    where: like(userTable.role, "%platform_admin%"),
  });

  return Boolean(existing);
}

function readBootstrapToken(c: { env?: unknown }) {
  const envToken =
    getEnvValue(c, "BACKOFFICE_BOOTSTRAP_TOKEN") ??
    process.env.BACKOFFICE_BOOTSTRAP_TOKEN;

  return typeof envToken === "string" ? envToken.trim() : "";
}

function isValidBootstrapToken(input: string, configured: string) {
  const left = Buffer.from(input);
  const right = Buffer.from(configured);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function resolveAppUrl(c: {
  req: {
    header(name: string): string | undefined;
  };
  env?: unknown;
}) {
  const origin = c.req.header("origin")?.trim();
  if (origin) {
    return origin;
  }

  const referer = c.req.header("referer")?.trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore malformed referer and fall back to configured app URL.
    }
  }

  const configuredAppUrl = getEnvValue(c, "APP_URL") ?? process.env.APP_URL;

  return typeof configuredAppUrl === "string" &&
    configuredAppUrl.trim().length > 0
    ? configuredAppUrl.trim()
    : "https://localhost:5173";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function labSlugCandidate(
  input: { name: string; slug?: string },
  suffix: number,
) {
  const baseSlug = slugify(input.slug ?? input.name) || "laboratorio";
  return suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
}

function labOrganizationCreateErrorWasSlugConflict(error: unknown) {
  const errorRecord = recordFromUnknown(error);
  const body = recordFromUnknown(errorRecord.body);
  const cause = recordFromUnknown(errorRecord.cause);
  const statusCandidates = [
    errorRecord.status,
    errorRecord.statusCode,
    body.status,
    body.statusCode,
    cause.status,
    cause.statusCode,
  ];
  const status = statusCandidates.find(
    (candidate): candidate is number => typeof candidate === "number",
  );
  const message = [
    error instanceof Error ? error.message : null,
    errorRecord.message,
    errorRecord.error,
    errorRecord.code,
    body.message,
    body.error,
    body.code,
    cause.message,
    cause.error,
    cause.code,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    (status === 409 && (!message || message.includes("slug"))) ||
    (message.includes("slug") &&
      (message.includes("already") ||
        message.includes("duplicate") ||
        message.includes("taken") ||
        message.includes("unique")))
  );
}

async function createLabOrganizationWithUniqueSlug(input: {
  auth: ReturnType<typeof createLabAuth>;
  lab: z.infer<typeof ProvisionLabAccountSchema>["lab"];
  ownerUserId: string;
  ownerEmail: string;
}) {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const resolvedSlug = labSlugCandidate(input.lab, attempt);
    // oxlint-disable-next-line no-await-in-loop -- slug candidates must be checked in order.
    const existing = await db.query.organization.findFirst({
      where: eq(organization.slug, resolvedSlug),
    });

    if (existing) {
      continue;
    }

    try {
      // oxlint-disable-next-line no-await-in-loop -- retry the next suffix only after a slug conflict.
      const orgResult = await input.auth.api.createOrganization({
        body: {
          name: input.lab.name,
          slug: resolvedSlug,
          type: "LAB",
          cnpj: input.lab.cnpj ?? "",
          accreditationNumber: "",
          accreditationBody: "",
          street: "",
          number: "",
          complement: "",
          neighbourhood: "",
          city: "",
          state: "",
          cep: "",
          phone: input.lab.phone ?? "",
          email: input.lab.email ?? input.ownerEmail,
          website: "",
          technicalManagerName: "",
          technicalManagerTitle: "",
          userId: input.ownerUserId,
          keepCurrentActiveOrganization: true,
        },
      });
      const org = recordFromUnknown(orgResult);

      if (typeof org.id !== "string") {
        throw new HTTPException(502, {
          message: "Lab auth returned an invalid organization payload",
        });
      }

      return {
        id: org.id,
        slug: resolvedSlug,
      };
    } catch (error) {
      if (!labOrganizationCreateErrorWasSlugConflict(error)) {
        throw error;
      }
    }
  }

  throw new HTTPException(409, {
    message: "Não foi possível gerar um slug disponível para o laboratório",
  });
}

async function findLabProvisioningUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.query.user.findFirst({
    where: eq(sql<string>`lower(${userTable.email})`, normalizedEmail),
  });

  if (!existing) return null;

  return {
    id: existing.id,
    name: existing.name,
    email: existing.email,
  };
}

async function ensureLabProvisioningUser(input: {
  name: string;
  email: string;
}) {
  const existing = await findLabProvisioningUser(input.email);

  if (existing) {
    return {
      created: false,
      user: existing,
    };
  }

  const auth = createLabAuth();

  try {
    const createdUser = await auth.api.createUser({
      body: {
        name: input.name,
        email: input.email,
        password: randomBytes(24).toString("base64url"),
        role: "user",
      },
    });

    return {
      created: true,
      user: platformUserFromUnknown(createdUser),
    };
  } catch (error) {
    if (!userCreateErrorWasDuplicate(error)) {
      throw error;
    }

    const reloaded = await findLabProvisioningUser(input.email);
    if (!reloaded) {
      throw error;
    }

    return {
      created: false,
      user: reloaded,
    };
  }
}

async function ensureOwnerMembership(input: {
  organizationId: string;
  userId: string;
}) {
  const existing = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId),
    ),
  });

  if (!existing) {
    await db.insert(member).values({
      id: randomBytes(16).toString("hex"),
      organizationId: input.organizationId,
      userId: input.userId,
      role: "owner",
      createdAt: new Date(),
    });
    return "created";
  }

  if (existing.role !== "owner") {
    await db
      .update(member)
      .set({ role: "owner" })
      .where(eq(member.id, existing.id));
    return "promoted";
  }

  return "existing";
}

async function cleanupFailedLabProvisioning(params: {
  organizationId?: string | null;
}) {
  try {
    if (params.organizationId) {
      await db
        .delete(organization)
        .where(eq(organization.id, params.organizationId));
    }
  } catch (error) {
    console.error("Failed to clean up failed LAB provisioning", {
      organizationId: params.organizationId,
      error,
    });
  }
}

const AccountTaskListQuerySchema = z.object({
  organizationId: z.string().trim().optional(),
  scope: z.enum(["mine", "all"]).optional(),
  status: z.enum(["open", "done", "all"]).optional(),
});

const AccountTaskTypeEnum = z.enum([
  "ONBOARDING",
  "MIGRATION",
  "GO_LIVE",
  "DUNNING",
  "CHECK_IN",
  "GENERAL",
]);

const CreateAccountTaskSchema = z.object({
  organizationId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(300),
  type: AccountTaskTypeEnum.optional(),
  ownerUserId: z.string().trim().optional(),
  dueAt: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
});

const AuditLogQuerySchema = z.object({
  action: z.string().trim().min(1).optional(),
  entityType: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional(),
  actorUserId: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const ApprovalKindEnum = z.enum(["refund", "credit", "adjustment", "other"]);

const ApprovalListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).optional(),
  organizationId: z.string().trim().optional(),
});

const CreateApprovalRequestSchema = z.object({
  organizationId: z.string().trim().min(1),
  kind: ApprovalKindEnum.optional(),
  summary: z.string().trim().min(3).max(500),
  amountCents: z.number().int().optional(),
});

const DecideApprovalSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

const OperatorAlertQuerySchema = z.object({
  status: z.enum(["open", "acknowledged", "all"]).optional(),
});

export const backofficeRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .use("*", requireBackofficeAuthSession)
  .get("/access", async (c) => {
    const session = c.get("session");
    const roles = parsePlatformRoles(session.user.role);
    let bootstrapAvailable = false;

    try {
      bootstrapAvailable =
        Boolean(readBootstrapToken(c)) && !(await hasAnyPlatformAdmin());
    } catch (error) {
      console.error(
        "Failed to resolve backoffice bootstrap availability",
        error,
      );
    }

    return c.json({
      allowed: canAccessBackoffice(session.user.role),
      roles,
      bootstrapAvailable,
      isImpersonating: Boolean(session.session.impersonatedBy),
      session: {
        userId: session.user.id,
        email: session.user.email,
      },
    });
  })
  .post("/bootstrap", zValidator("json", BootstrapSchema), async (c) => {
    const session = c.get("session");
    const input = c.req.valid("json");
    const configuredToken = readBootstrapToken(c);

    if (!configuredToken) {
      return c.json({ error: "Bootstrap do backoffice não configurado" }, 503);
    }

    if (await hasAnyPlatformAdmin()) {
      return c.json({ error: "Bootstrap já foi concluído" }, 409);
    }

    if (!isValidBootstrapToken(input.token, configuredToken)) {
      return c.json({ error: "Token de bootstrap inválido" }, 403);
    }

    await db
      .update(userTable)
      .set({
        role: "platform_admin",
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, session.user.id));

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: session.user.id,
      action: "backoffice.bootstrap.completed",
      entityType: "user",
      entityId: session.user.id,
      details: {
        email: session.user.email,
      },
    });

    return c.json({
      promoted: true,
      role: "platform_admin",
    });
  })
  .post("/impersonation/stop", async (c) => {
    const session = c.get("session");
    const labAuth = createLabAuth();
    const labSession = await labAuth.api.getSession({
      headers: c.req.raw.headers,
    });
    const impersonatedBy = labSession?.session.impersonatedBy ?? null;

    if (!impersonatedBy) {
      return c.json({ error: "Nenhuma impersonação ativa" }, 400);
    }

    const response = await forwardLabAuthResponse({
      c,
      path: "/api/auth/lab/admin/stop-impersonating",
    });

    if (response.ok) {
      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId: labSession?.user.id ?? null,
        action: "backoffice.impersonation.stop",
        entityType: "user",
        entityId: labSession?.user.id ?? null,
        details: {
          impersonatedBy,
        },
      });
    }

    return response;
  })
  .use("*", requireBackofficeAccess)
  // Fleet-wide integration health roll-up. The half-hourly integrations cron
  // already writes per-org status/lastValidatedAt/lastValidationError; this just
  // aggregates it so operators can see broken Asaas/Conta Azul connections at a
  // glance instead of drilling into each account.
  .get("/integrations/health", async (c) => {
    const grouped = await db
      .select({
        provider: organizationIntegration.provider,
        status: organizationIntegration.status,
        count: sql<number>`count(*)::int`,
      })
      .from(organizationIntegration)
      .groupBy(
        organizationIntegration.provider,
        organizationIntegration.status,
      );

    const affected = await db
      .select({
        organizationId: organizationIntegration.organizationId,
        organizationName: organization.name,
        provider: organizationIntegration.provider,
        name: organizationIntegration.name,
        status: organizationIntegration.status,
        lastValidatedAt: organizationIntegration.lastValidatedAt,
        lastValidationError: organizationIntegration.lastValidationError,
      })
      .from(organizationIntegration)
      .innerJoin(
        organization,
        eq(organization.id, organizationIntegration.organizationId),
      )
      .where(not(eq(organizationIntegration.status, "ACTIVE")))
      .orderBy(asc(organization.name))
      .limit(200);

    const providersMap: Record<
      string,
      {
        provider: string;
        total: number;
        active: number;
        actionRequired: number;
        disabled: number;
      }
    > = {};
    for (const row of grouped) {
      const bucket = providersMap[row.provider] ?? {
        provider: row.provider,
        total: 0,
        active: 0,
        actionRequired: 0,
        disabled: 0,
      };
      bucket.total += row.count;
      if (row.status === "ACTIVE") bucket.active += row.count;
      else if (row.status === "ACTION_REQUIRED")
        bucket.actionRequired += row.count;
      else if (row.status === "DISABLED") bucket.disabled += row.count;
      providersMap[row.provider] = bucket;
    }

    return c.json({ providers: Object.values(providersMap), affected });
  })
  // Server-side revenue/subscription vitals — the operator cockpit was blind to
  // its own commercial state. Simple column aggregates over `subscription`
  // (status + plan distribution + renewals due), computed in SQL rather than
  // shipped to the browser. First domain of a growing /vitals metrics endpoint.
  .get("/vitals", async (c) => {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const byStatusRows = await db
      .select({
        status: subscription.status,
        count: sql<number>`count(*)::int`,
      })
      .from(subscription)
      .groupBy(subscription.status);

    const byPlanRows = await db
      .select({
        planId: subscription.planId,
        count: sql<number>`count(*)::int`,
      })
      .from(subscription)
      .groupBy(subscription.planId);

    const renewalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscription)
      .where(
        and(
          eq(subscription.status, "ACTIVE"),
          gte(subscription.nextBillingDate, now),
          lte(subscription.nextBillingDate, in30Days),
        ),
      );

    const byStatus: Record<string, number> = {
      ACTIVE: 0,
      PAST_DUE: 0,
      CANCELED: 0,
      TRIAL: 0,
    };
    let total = 0;
    for (const row of byStatusRows) {
      byStatus[row.status] = row.count;
      total += row.count;
    }

    const byPlan: Record<string, number> = {};
    for (const row of byPlanRows) {
      byPlan[row.planId] = row.count;
    }

    // Worker queue health — a wedged certificate/notification queue is invisible
    // to operators today. "Stuck" = PENDING jobs whose availableAt is >15min past
    // (the worker should have drained them).
    const queueByStatus = await db
      .select({
        status: appQueueJob.status,
        count: sql<number>`count(*)::int`,
      })
      .from(appQueueJob)
      .groupBy(appQueueJob.status);

    const queueStuckRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appQueueJob)
      .where(
        and(
          eq(appQueueJob.status, "PENDING"),
          lt(appQueueJob.availableAt, new Date(now.getTime() - 15 * 60 * 1000)),
        ),
      );

    // REQ-REL-OBS-002: surface the REAL last_error of failed queue jobs. The
    // worker runtime now records the actual error (not a generic placeholder),
    // so an operator can see WHY a job failed instead of just a count.
    const recentFailedRows = await db
      .select({
        id: appQueueJob.id,
        type: appQueueJob.type,
        attempts: appQueueJob.attempts,
        maxAttempts: appQueueJob.maxAttempts,
        lastError: appQueueJob.lastError,
        updatedAt: appQueueJob.updatedAt,
      })
      .from(appQueueJob)
      .where(eq(appQueueJob.status, "FAILED"))
      .orderBy(desc(appQueueJob.updatedAt))
      .limit(20);

    // REQ-REL-OBS-003: dead-lettered service-order emails — rows that exhausted
    // maxAttempts and will never be drained again.
    const deadLetterOutboxRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(serviceOrderEmailOutbox)
      .where(
        and(
          isNull(serviceOrderEmailOutbox.processedAt),
          isNotNull(serviceOrderEmailOutbox.deadLetterAt),
        ),
      );

    const queue = {
      pending: 0,
      processing: 0,
      failed: 0,
      completed: 0,
      stuck: queueStuckRows[0]?.count ?? 0,
      recentFailures: shapeRecentQueueFailures(recentFailedRows),
    };
    for (const row of queueByStatus) {
      if (row.status === "PENDING") queue.pending = row.count;
      else if (row.status === "PROCESSING") queue.processing = row.count;
      else if (row.status === "FAILED") queue.failed = row.count;
      else if (row.status === "COMPLETED") queue.completed = row.count;
    }

    const emailOutbox = {
      deadLetter: deadLetterOutboxRows[0]?.count ?? 0,
    };

    return c.json({
      subscriptions: {
        total,
        active: byStatus.ACTIVE ?? 0,
        trialing: byStatus.TRIAL ?? 0,
        pastDue: byStatus.PAST_DUE ?? 0,
        canceled: byStatus.CANCELED ?? 0,
        renewalsDue30d: renewalRows[0]?.count ?? 0,
        byStatus,
        byPlan,
      },
      queue,
      emailOutbox,
    });
  })
  // Account tasks — first-class operator tasks per account (and a cross-account
  // "my day" worklist via scope=mine), superseding the single free-text
  // nextAction field. Substrate for onboarding / migration / dunning playbooks.
  .get(
    "/account-tasks",
    zValidator("query", AccountTaskListQuerySchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("query");
      const statusFilter = input.status ?? "open";

      const conditions = [];
      if (input.organizationId) {
        conditions.push(eq(accountTask.organizationId, input.organizationId));
      }
      if (input.scope === "mine") {
        conditions.push(eq(accountTask.ownerUserId, session.user.id));
      }
      if (statusFilter === "open") {
        conditions.push(eq(accountTask.status, "OPEN"));
      } else if (statusFilter === "done") {
        conditions.push(eq(accountTask.status, "DONE"));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: accountTask.id,
          organizationId: accountTask.organizationId,
          organizationName: organization.name,
          title: accountTask.title,
          type: accountTask.type,
          status: accountTask.status,
          ownerUserId: accountTask.ownerUserId,
          dueAt: accountTask.dueAt,
          notes: accountTask.notes,
          completedAt: accountTask.completedAt,
          createdAt: accountTask.createdAt,
        })
        .from(accountTask)
        .innerJoin(
          organization,
          eq(organization.id, accountTask.organizationId),
        )
        .where(where)
        .orderBy(asc(accountTask.dueAt), desc(accountTask.createdAt))
        .limit(200);

      const ownerIds = Array.from(
        new Set(
          rows
            .map((row) => row.ownerUserId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const owners =
        ownerIds.length > 0
          ? await db
              .select({ id: userTable.id, name: userTable.name })
              .from(userTable)
              .where(inArray(userTable.id, ownerIds))
          : [];
      const ownerById = new Map(owners.map((entry) => [entry.id, entry.name]));

      const data = rows.map((row) => ({
        ...row,
        ownerName: row.ownerUserId
          ? (ownerById.get(row.ownerUserId) ?? null)
          : null,
      }));

      return c.json({ data });
    },
  )
  .post(
    "/account-tasks",
    zValidator("json", CreateAccountTaskSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("json");

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, input.organizationId),
      });
      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const inserted = await db
        .insert(accountTask)
        .values({
          organizationId: input.organizationId,
          title: input.title,
          type: input.type ?? "GENERAL",
          ownerUserId: input.ownerUserId || null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          notes: input.notes || null,
          createdByUserId: session.user.id,
        })
        .returning();
      const created = inserted[0];
      if (!created) {
        return c.json({ error: "Falha ao criar tarefa" }, 500);
      }

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: "backoffice.account_task.created",
        entityType: "account_task",
        entityId: String(created.id),
        details: {
          organizationId: input.organizationId,
          title: created.title,
          type: created.type,
        },
      });

      return c.json(created);
    },
  )
  .post("/account-tasks/:id/complete", async (c) => {
    const session = c.get("session");
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id)) {
      return c.json({ error: "Tarefa inválida" }, 400);
    }

    const updatedRows = await db
      .update(accountTask)
      .set({
        status: "DONE",
        completedAt: new Date(),
        completedByUserId: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(accountTask.id, id))
      .returning();
    const updated = updatedRows[0];
    if (!updated) {
      return c.json({ error: "Tarefa não encontrada" }, 404);
    }

    await logPlatformEvent({
      actorUserId: session.user.id,
      action: "backoffice.account_task.completed",
      entityType: "account_task",
      entityId: String(id),
      details: { organizationId: updated.organizationId },
    });

    return c.json(updated);
  })
  // Queryable audit-log surface over platformEventLog (admin-only). The table is
  // written for every sensitive backoffice action but previously had no read path.
  .get(
    "/audit-log",
    requirePlatformAdmin,
    zValidator("query", AuditLogQuerySchema),
    async (c) => {
      const input = c.req.valid("query");
      const limit = input.limit ?? 50;

      const conditions = [];
      if (input.action)
        conditions.push(eq(platformEventLog.action, input.action));
      if (input.entityType)
        conditions.push(eq(platformEventLog.entityType, input.entityType));
      if (input.entityId)
        conditions.push(eq(platformEventLog.entityId, input.entityId));
      if (input.actorUserId)
        conditions.push(eq(platformEventLog.actorUserId, input.actorUserId));
      if (input.search) {
        const term = `%${input.search}%`;
        conditions.push(
          or(
            ilike(platformEventLog.action, term),
            ilike(platformEventLog.entityType, term),
            ilike(platformEventLog.entityId, term),
          ),
        );
      }
      if (input.cursor) conditions.push(lt(platformEventLog.id, input.cursor));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: platformEventLog.id,
          action: platformEventLog.action,
          entityType: platformEventLog.entityType,
          entityId: platformEventLog.entityId,
          details: platformEventLog.details,
          createdAt: platformEventLog.createdAt,
          actorUserId: platformEventLog.actorUserId,
          targetUserId: platformEventLog.targetUserId,
        })
        .from(platformEventLog)
        .where(where)
        .orderBy(desc(platformEventLog.id))
        .limit(limit + 1);

      const userIds = Array.from(
        new Set(
          rows.flatMap((row) =>
            [row.actorUserId, row.targetUserId].filter(
              (value): value is string => Boolean(value),
            ),
          ),
        ),
      );
      const users =
        userIds.length > 0
          ? await db
              .select({
                id: userTable.id,
                name: userTable.name,
                email: userTable.email,
              })
              .from(userTable)
              .where(inArray(userTable.id, userIds))
          : [];
      const usersById = new Map(users.map((entry) => [entry.id, entry]));

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const data = page.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        details: row.details,
        createdAt: row.createdAt,
        actorUser: row.actorUserId
          ? (usersById.get(row.actorUserId) ?? null)
          : null,
        targetUser: row.targetUserId
          ? (usersById.get(row.targetUserId) ?? null)
          : null,
      }));

      const last = page.at(-1);
      const nextCursor = hasMore && last ? last.id : null;

      return c.json({ data, nextCursor });
    },
  )
  .get(
    "/impersonation/bridge",
    zValidator("query", ImpersonationBridgeSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("query");
      const labAuth = createLabAuth();

      const targetUser = await db.query.user.findFirst({
        where: eq(userTable.id, input.targetUserId),
      });

      if (!targetUser) {
        await logPlatformEvent({
          actorUserId: session.user.id,
          targetUserId: input.targetUserId,
          action: "backoffice.impersonation.failed",
          entityType: "user",
          entityId: input.targetUserId,
          details: {
            reason: "target_not_found",
          },
        });

        return redirectToAppWithError(c, "Usuário alvo não encontrado");
      }

      try {
        const verifyResponse = await labAuth.api.verifyOneTimeToken({
          body: { token: input.token },
          asResponse: true,
        });

        if (!verifyResponse.ok) {
          const payload = await verifyResponse.json().catch(() => null);

          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "invalid_handoff_token",
            },
          });

          return redirectToAppWithError(
            c,
            extractErrorMessage(
              payload,
              "Falha ao validar o handoff de impersonação",
            ),
          );
        }

        const operatorLabCookie = extractCookieHeaderFromResponseHeaders(
          verifyResponse.headers,
        );

        if (!operatorLabCookie) {
          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "missing_lab_cookie_after_verify",
            },
          });

          return redirectToAppWithError(
            c,
            "Falha ao preparar a sessão LAB do operador para impersonação",
          );
        }

        const operatorLabSession = await labAuth.api.getSession({
          headers: new Headers({
            cookie: operatorLabCookie,
          }),
        });

        if (!operatorLabSession) {
          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "lab_session_not_established",
            },
          });

          return redirectToAppWithError(
            c,
            "Falha ao estabelecer a sessão LAB do operador",
          );
        }

        if (operatorLabSession.user.id !== session.user.id) {
          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "operator_identity_mismatch",
              labUserId: operatorLabSession.user.id,
            },
          });

          return redirectToAppWithError(
            c,
            "Falha ao reconciliar a identidade do operador no handoff",
          );
        }

        const impersonateResponse = await labAuth.api.impersonateUser({
          body: {
            userId: input.targetUserId,
          },
          headers: new Headers({
            cookie: operatorLabCookie,
          }),
          asResponse: true,
        });

        if (!impersonateResponse.ok) {
          const payload = await impersonateResponse.json().catch(() => null);

          await logPlatformEvent({
            actorUserId: session.user.id,
            targetUserId: input.targetUserId,
            action: "backoffice.impersonation.failed",
            entityType: "user",
            entityId: input.targetUserId,
            details: {
              reason: "lab_impersonation_rejected",
            },
          });

          return redirectToAppWithError(
            c,
            extractErrorMessage(
              payload,
              "Falha ao iniciar impersonação no dashboard LAB",
            ),
          );
        }

        await logPlatformEvent({
          actorUserId: session.user.id,
          targetUserId: input.targetUserId,
          action: "backoffice.impersonation.start",
          entityType: "user",
          entityId: input.targetUserId,
          details: {
            email: targetUser.email,
            via: "one_time_token_bridge",
          },
        });

        return createRedirectWithResponseCookies({
          response: impersonateResponse,
          // Impersonation lands in the lab dashboard, not the request origin
          // (the backoffice is its own app now and has no /dashboard route).
          location: `${resolveTrustedAppUrl(c)}/dashboard`,
        });
      } catch (error) {
        await logPlatformEvent({
          actorUserId: session.user.id,
          targetUserId: input.targetUserId,
          action: "backoffice.impersonation.failed",
          entityType: "user",
          entityId: input.targetUserId,
          details: {
            reason: "unexpected_error",
            message: error instanceof Error ? error.message : null,
          },
        });

        return redirectToAppWithError(
          c,
          extractErrorMessage(
            error instanceof Error ? { message: error.message } : null,
            "Falha ao concluir a ponte de impersonação",
          ),
        );
      }
    },
  )
  .route("/customer-success", internalCustomerSuccessRouter)
  .route("/commercial", backofficeCommercialRouter)
  .post(
    "/labs",
    requirePlatformAdmin,
    zValidator("json", ProvisionLabAccountSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("json");
      const appUrl = resolveTrustedAppUrl(c);
      const labAuth = createLabAuth();
      let createdOrganizationId: string | null = null;

      try {
        const owner = await ensureLabProvisioningUser(input.owner);

        const org = await createLabOrganizationWithUniqueSlug({
          auth: labAuth,
          lab: input.lab,
          ownerUserId: owner.user.id,
          ownerEmail: owner.user.email,
        });
        createdOrganizationId = org.id;

        const membershipStatus = await ensureOwnerMembership({
          organizationId: org.id,
          userId: owner.user.id,
        });

        await db
          .insert(subscription)
          .values({
            organizationId: org.id,
            planId: input.lab.planId,
            status: "TRIAL",
          })
          .onConflictDoNothing({ target: subscription.organizationId });

        await db
          .insert(organizationSuccessProfile)
          .values({
            organizationId: org.id,
            accountOwnerUserId: owner.user.id,
            accountOwnerName: owner.user.name,
            accountOwnerEmail: owner.user.email,
            supportContactEmail: input.lab.email ?? owner.user.email,
            onboardingStatus: "NOT_STARTED",
            migrationStatus: "NOT_REQUIRED",
          })
          .onConflictDoNothing({
            target: organizationSuccessProfile.organizationId,
          });

        let passwordSetupRequested = false;
        let passwordSetupMessage = "Envio de acesso desabilitado";

        if (input.onboarding.sendSetupEmail) {
          const setupToken = await createLabAccountSetupToken({
            userId: owner.user.id,
            organizationId: org.id,
            email: owner.user.email,
            purpose: "owner_claim",
            createdByUserId: session.user.id,
            source: "backoffice.lab.provisioning",
          });

          await sendLabAccountSetupEmail({
            email: owner.user.email,
            recipientName: owner.user.name,
            organizationName: input.lab.name,
            claimUrl: buildLabClaimUrl(appUrl, setupToken.token),
          });

          passwordSetupRequested = true;
          passwordSetupMessage = "Email de configuração de acesso solicitado";
        }

        await logPlatformEvent({
          actorUserId: session.user.id,
          targetUserId: owner.user.id,
          action: "backoffice.lab.provisioned",
          entityType: "organization",
          entityId: org.id,
          details: {
            ownerCreated: owner.created,
            ownerEmail: owner.user.email,
            planId: input.lab.planId,
            membershipStatus,
            passwordSetupRequested,
            authSetupMode: "passkey_first",
          },
        });

        return c.json({
          organization: {
            id: org.id,
            name: input.lab.name,
            slug: org.slug,
          },
          owner: owner.user,
          ownerCreated: owner.created,
          membershipStatus,
          plan: {
            planId: input.lab.planId,
            status: "TRIAL",
          },
          passwordSetupRequested,
          passwordSetupMessage,
        });
      } catch (error) {
        await cleanupFailedLabProvisioning({
          organizationId: createdOrganizationId,
        });
        throw error;
      }
    },
  )
  // The /organizations/* concern is extracted into its own sub-router, mounted
  // here INSIDE the access-gated zone (after requireBackofficeAuthSession +
  // requireBackofficeAccess) so every moved route keeps the exact same effective
  // guard stack. Admin-only org routes carry their inline requirePlatformAdmin
  // guard with them into the sub-router; errors propagate to this router's
  // onError (sub-router defines none), preserving the { error } response shape.
  .route("/organizations", backofficeOrganizationsRouter)
  .route("/asset-types", backofficeAssetTypesRouter)
  .post(
    "/entitlement-overrides/:id/revoke",
    requirePlatformAdmin,
    async (c) => {
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (!Number.isInteger(id)) {
        return c.json({ error: "Concessão inválida" }, 400);
      }

      // 0-arg returning (the typed projection collapses to the 0-arg overload
      // on the neon|postgres-js db union); `deleted` is only read for logging
      // below and never returned to the client.
      const deletedRows = await db
        .delete(entitlementOverride)
        .where(eq(entitlementOverride.id, id))
        .returning();
      const deleted = deletedRows[0];
      if (!deleted) {
        return c.json({ error: "Concessão não encontrada" }, 404);
      }

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: "backoffice.entitlement_override.revoked",
        entityType: "organization",
        entityId: deleted.organizationId,
        details: { feature: deleted.feature },
      });

      return c.json({ ok: true });
    },
  )
  // Maker-checker approval queue — dual-control over sensitive, money-touching
  // actions (refunds, credits, adjustments). Any operator can open a request and
  // view the queue; only a platform admin who is NOT the requester may decide it.
  .get(
    "/approvals",
    zValidator("query", ApprovalListQuerySchema),
    async (c) => {
      const input = c.req.valid("query");

      const conditions = [];
      if (input.status && input.status !== "all") {
        const statusByFilter = {
          pending: "PENDING",
          approved: "APPROVED",
          rejected: "REJECTED",
        } as const;
        conditions.push(
          eq(approvalRequest.status, statusByFilter[input.status]),
        );
      }
      if (input.organizationId) {
        conditions.push(
          eq(approvalRequest.organizationId, input.organizationId),
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: approvalRequest.id,
          organizationId: approvalRequest.organizationId,
          organizationName: organization.name,
          kind: approvalRequest.kind,
          summary: approvalRequest.summary,
          amountCents: approvalRequest.amountCents,
          status: approvalRequest.status,
          requestedByUserId: approvalRequest.requestedByUserId,
          decidedByUserId: approvalRequest.decidedByUserId,
          decisionReason: approvalRequest.decisionReason,
          createdAt: approvalRequest.createdAt,
          decidedAt: approvalRequest.decidedAt,
        })
        .from(approvalRequest)
        .leftJoin(
          organization,
          eq(organization.id, approvalRequest.organizationId),
        )
        .where(where)
        .orderBy(desc(approvalRequest.createdAt))
        .limit(200);

      const userIds = Array.from(
        new Set(
          rows
            .flatMap((row) => [row.requestedByUserId, row.decidedByUserId])
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
        organizationName: row.organizationName ?? "—",
        requestedByName: row.requestedByUserId
          ? (nameById.get(row.requestedByUserId) ?? null)
          : null,
        decidedByName: row.decidedByUserId
          ? (nameById.get(row.decidedByUserId) ?? null)
          : null,
      }));

      return c.json({ data });
    },
  )
  .post(
    "/approvals",
    zValidator("json", CreateApprovalRequestSchema),
    async (c) => {
      const session = c.get("session");
      const input = c.req.valid("json");

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, input.organizationId),
      });
      if (!org) {
        return c.json({ error: "Organização não encontrada" }, 404);
      }

      const inserted = await db
        .insert(approvalRequest)
        .values({
          organizationId: input.organizationId,
          kind: input.kind ?? "other",
          summary: input.summary,
          amountCents: input.amountCents ?? null,
          requestedByUserId: session.user.id,
        })
        .returning();
      const created = inserted[0];
      if (!created) {
        return c.json({ error: "Falha ao abrir solicitação" }, 500);
      }

      await logPlatformEvent({
        actorUserId: session.user.id,
        action: "backoffice.approval.requested",
        entityType: "approval_request",
        entityId: String(created.id),
        details: {
          organizationId: input.organizationId,
          kind: created.kind,
          amountCents: created.amountCents,
          summary: created.summary,
        },
      });

      return c.json(created);
    },
  )
  .post(
    "/approvals/:id/decide",
    requirePlatformAdmin,
    zValidator("json", DecideApprovalSchema),
    async (c) => {
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (!Number.isInteger(id)) {
        return c.json({ error: "Solicitação inválida" }, 400);
      }
      const input = c.req.valid("json");

      const existing = await db.query.approvalRequest.findFirst({
        where: eq(approvalRequest.id, id),
      });
      if (!existing) {
        return c.json({ error: "Solicitação não encontrada" }, 404);
      }
      if (existing.status !== "PENDING") {
        return c.json({ error: "Solicitação já decidida" }, 409);
      }
      // Dual-control: the approver must be a different person than the requester.
      // Reuses the shared identity rule (../lib/dual-control) so the same
      // separation-of-duties check gates BOTH the decision here and the
      // downstream financial execution (DOM-04 / #657).
      if (isSameDualControlIdentity(existing.requestedByUserId, session.user.id)) {
        return c.json(
          {
            error:
              "Controle duplo: a aprovação precisa ser feita por outra pessoa.",
          },
          403,
        );
      }

      const nextStatus = input.decision === "approve" ? "APPROVED" : "REJECTED";
      const updated = await db
        .update(approvalRequest)
        .set({
          status: nextStatus,
          decidedByUserId: session.user.id,
          decisionReason: input.reason || null,
          decidedAt: new Date(),
        })
        .where(eq(approvalRequest.id, id))
        .returning();
      const decided = updated[0];
      if (!decided) {
        return c.json({ error: "Falha ao decidir solicitação" }, 500);
      }

      await logPlatformEvent({
        actorUserId: session.user.id,
        action:
          input.decision === "approve"
            ? "backoffice.approval.approved"
            : "backoffice.approval.rejected",
        entityType: "approval_request",
        entityId: String(id),
        details: {
          organizationId: existing.organizationId,
          requestedByUserId: existing.requestedByUserId,
          reason: input.reason ?? null,
        },
      });

      return c.json(decided);
    },
  )
  // Operator-addressed alerting (gap #5). The `operator-alerts` cron recomputes
  // proactive risk signals into `operator_alert`; operators read and acknowledge
  // them here. A manual recompute is exposed so the cockpit isn't empty between
  // cron runs.
  .get(
    "/operator-alerts",
    zValidator("query", OperatorAlertQuerySchema),
    async (c) => {
      const input = c.req.valid("query");
      const status = input.status ?? "open";
      const where =
        status === "open"
          ? eq(operatorAlert.status, "OPEN")
          : status === "acknowledged"
            ? eq(operatorAlert.status, "ACKNOWLEDGED")
            : undefined;

      const rows = await db
        .select({
          id: operatorAlert.id,
          organizationId: operatorAlert.organizationId,
          organizationName: organization.name,
          kind: operatorAlert.kind,
          severity: operatorAlert.severity,
          title: operatorAlert.title,
          detail: operatorAlert.detail,
          status: operatorAlert.status,
          acknowledgedByUserId: operatorAlert.acknowledgedByUserId,
          acknowledgedAt: operatorAlert.acknowledgedAt,
          firstSeenAt: operatorAlert.firstSeenAt,
          lastSeenAt: operatorAlert.lastSeenAt,
        })
        .from(operatorAlert)
        .leftJoin(
          organization,
          eq(organization.id, operatorAlert.organizationId),
        )
        .where(where)
        // critical → warning → info, then most-recent first.
        .orderBy(
          sql`case ${operatorAlert.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`,
          desc(operatorAlert.lastSeenAt),
        )
        .limit(200);

      const userIds = Array.from(
        new Set(
          rows
            .map((row) => row.acknowledgedByUserId)
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
        acknowledgedByName: row.acknowledgedByUserId
          ? (nameById.get(row.acknowledgedByUserId) ?? null)
          : null,
      }));

      return c.json({ data });
    },
  )
  .post("/operator-alerts/recompute", async (c) => {
    const session = c.get("session");
    const result = await recomputeOperatorAlerts();
    await logPlatformEvent({
      actorUserId: session.user.id,
      action: "backoffice.operator_alerts.recomputed",
      entityType: "platform",
      entityId: null,
      details: result,
    });
    return c.json(result);
  })
  .post("/operator-alerts/:id/acknowledge", async (c) => {
    const session = c.get("session");
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id)) {
      return c.json({ error: "Alerta inválido" }, 400);
    }

    const updated = await db
      .update(operatorAlert)
      .set({
        status: "ACKNOWLEDGED",
        acknowledgedByUserId: session.user.id,
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(operatorAlert.id, id))
      .returning();
    const alert = updated[0];
    if (!alert) {
      return c.json({ error: "Alerta não encontrado" }, 404);
    }

    await logPlatformEvent({
      actorUserId: session.user.id,
      action: "backoffice.operator_alert.acknowledged",
      entityType: "operator_alert",
      entityId: String(id),
      details: { kind: alert.kind, organizationId: alert.organizationId },
    });

    return c.json(alert);
  })
  .get("/support/queue", async (c) => {
    const rows = await db.query.organizationSupportRequest.findMany({
      with: {
        requestedByUser: true,
        assignedToUser: true,
        organization: true,
      },
      orderBy: [
        desc(organizationSupportRequest.priority),
        desc(organizationSupportRequest.createdAt),
      ],
      limit: 100,
    });

    const organizationIds = Array.from(
      new Set(rows.map((row) => row.organizationId)),
    );

    const [profiles, planAccessEntries] = await Promise.all([
      organizationIds.length === 0
        ? Promise.resolve([])
        : db.query.organizationSuccessProfile.findMany({
            where: inArray(
              organizationSuccessProfile.organizationId,
              organizationIds,
            ),
          }),
      Promise.all(
        organizationIds.map(
          async (organizationId) =>
            [
              organizationId,
              await getOrganizationPlanAccess(organizationId),
            ] as const,
        ),
      ),
    ]);

    const profilesByOrg = new Map(
      profiles.map((profile) => [profile.organizationId, profile] as const),
    );
    const planAccessByOrg = new Map(planAccessEntries);

    const data = rows
      .map((row) => {
        const profile = profilesByOrg.get(row.organizationId);
        const planAccess = planAccessByOrg.get(row.organizationId);
        const effectiveSlaTier =
          profile && planAccess
            ? profile.slaTier === "PLAN_DEFAULT"
              ? deriveDefaultSlaTier(planAccess.supportPolicy)
              : profile.slaTier
            : "PLAN_DEFAULT";
        const goLiveStatus =
          profile && planAccess
            ? deriveGoLiveStatus({
                currentStatus: profile.goLiveStatus,
                goLiveActualDate: profile.goLiveActualDate,
                goLiveTargetDate: profile.goLiveTargetDate,
              })
            : "NOT_SCHEDULED";
        const dueSoonThresholdHours =
          profile && planAccess
            ? resolveDueSoonThresholdHours(
                resolveEffectiveSlaHours(
                  planAccess.supportPolicy.targetFirstResponseBusinessHours,
                  effectiveSlaTier,
                ),
              )
            : 4;
        const healthStatus =
          profile && planAccess
            ? deriveHealthStatus({
                currentStatus: profile.healthStatus,
                onboardingStatus: profile.onboardingStatus,
                migrationStatus: profile.migrationStatus,
                goLiveStatus,
                breachedRequestsCount:
                  getSupportRequestSlaStatus({
                    status: row.status,
                    slaTargetAt: row.slaTargetAt,
                    dueSoonThresholdHours,
                  }) === "BREACHED"
                    ? 1
                    : 0,
                dueSoonRequestsCount:
                  getSupportRequestSlaStatus({
                    status: row.status,
                    slaTargetAt: row.slaTargetAt,
                    dueSoonThresholdHours,
                  }) === "DUE_SOON"
                    ? 1
                    : 0,
              })
            : "HEALTHY";
        const slaStatus = getSupportRequestSlaStatus({
          status: row.status,
          slaTargetAt: row.slaTargetAt,
          dueSoonThresholdHours,
        });
        const activeBlockers = getActiveCustomerSuccessBlockers(
          profile?.blockers,
        );
        const nextActionStatus = profile
          ? deriveNextActionStatus({
              nextAction: profile.nextAction,
              nextActionDueAt: profile.nextActionDueAt,
              nextActionCompletedAt: profile.nextActionCompletedAt,
            })
          : "NONE";
        const prioritySupport =
          (profile?.prioritySupport ?? false) ||
          effectiveSlaTier !== "PLAN_DEFAULT" ||
          (planAccess?.supportPolicy.hasPrioritySupport ?? false);
        const needsEscalation = getSupportRequestNeedsEscalation({
          status: row.status,
          slaStatus,
          priority: row.priority,
          prioritySupport,
          escalatedAt: row.escalatedAt,
        });
        const attentionScore = getSupportRequestAttentionScore({
          status: row.status,
          slaStatus,
          priority: row.priority,
          assignedToUserId: row.assignedToUserId,
          prioritySupport,
          escalatedAt: row.escalatedAt,
        });

        return {
          ...row,
          slaStatus,
          timeToSlaMs: row.slaTargetAt
            ? row.slaTargetAt.getTime() - Date.now()
            : null,
          organizationHealth: healthStatus,
          prioritySupport,
          effectiveSlaTier,
          needsEscalation,
          attentionScore,
          escalationReason: row.escalationReason,
          nextActionStatus,
          organizationBlockers: activeBlockers,
          workflowDelays: buildWorkflowDelays({
            nextActionStatus,
            goLiveStatus,
            activeBlockersCount: activeBlockers.length,
          }),
        };
      })
      .sort((left, right) => {
        if (right.attentionScore !== left.attentionScore) {
          return right.attentionScore - left.attentionScore;
        }

        const leftSla = left.slaTargetAt
          ? new Date(left.slaTargetAt).getTime()
          : Number.POSITIVE_INFINITY;
        const rightSla = right.slaTargetAt
          ? new Date(right.slaTargetAt).getTime()
          : Number.POSITIVE_INFINITY;

        return leftSla - rightSla;
      });

    return c.json({ data });
  })
  // The /users/* concern is extracted into its own sub-router, mounted here
  // INSIDE the access-gated zone (after requireBackofficeAuthSession +
  // requireBackofficeAccess) so every moved route keeps the exact same effective
  // guard stack. The collection POST /users carries its inline
  // requirePlatformAdmin; the mutating /users/:id/* POSTs carry their PATH-SCOPED
  // requirePlatformAdmin `.use`s with them (rebased to /:id/…); the read routes
  // and POST /users/:id/impersonate stay access-gated only. Errors propagate to
  // this router's onError (sub-router defines none), preserving the { error }
  // response shape.
  .route("/users", backofficeUsersRouter)
  .get("/presence", async (c) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [activeNow, logins24h, logins7d] = await Promise.all([
      db
        .select({ value: sql<number>`count(distinct ${authSession.userId})` })
        .from(authSession)
        .where(gt(authSession.expiresAt, now)),
      db
        .select({ value: sql<number>`count(distinct ${authSession.userId})` })
        .from(authSession)
        .where(gte(authSession.createdAt, dayAgo)),
      db
        .select({ value: sql<number>`count(distinct ${authSession.userId})` })
        .from(authSession)
        .where(gte(authSession.createdAt, weekAgo)),
    ]);

    return c.json({
      activeUsersNow: Number(activeNow[0]?.value ?? 0),
      logins24h: Number(logins24h[0]?.value ?? 0),
      logins7d: Number(logins7d[0]?.value ?? 0),
    });
  })
  .onError((error, c) => {
    if (error instanceof Response) {
      return error;
    }

    if (error instanceof HTTPException) {
      return c.json(
        {
          error: error.message,
        },
        error.status,
      );
    }

    return c.json(
      {
        error: extractErrorMessage(
          error instanceof Error ? { message: error.message } : null,
          "Backoffice request failed",
        ),
      },
      500,
    );
  });
