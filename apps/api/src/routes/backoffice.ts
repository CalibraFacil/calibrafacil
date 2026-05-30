import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  like,
  lt,
  lte,
  max,
  not,
  or,
  sql,
} from "drizzle-orm";
import {
  createBackofficeAuth,
  createLabAuth,
  sendLabAccountSetupEmail,
} from "@calibra-facil/auth";
import {
  buildLabClaimUrl,
  createLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import { db } from "@calibra-facil/db";
import {
  accountTask,
  appQueueJob,
  approvalRequest,
  calibrationJob,
  calibrationRequest,
  certificateRelease,
  entitlementOverride,
  importRun,
  member,
  organization,
  organizationIntegration,
  organizationSuccessProfile,
  organizationSupportRequest,
  organizationUnit,
  platformEventLog,
  session as authSession,
  subscription,
  user as userTable,
} from "@calibra-facil/db/schema";
import { FEATURE_FLAGS } from "@calibra-facil/shared";
import {
  IMPORT_FIELDS,
  ImportValidateInputSchema,
  validateImportRows,
} from "@calibra-facil/schemas";
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

const SetPlatformRoleSchema = z.object({
  role: z.enum(["user", "platform_operator", "platform_admin"]),
});

const BootstrapSchema = z.object({
  token: z.string().min(1),
});

const CreatePlatformUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  role: z.enum(["platform_operator", "platform_admin"]),
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

const ListBackofficeUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().optional(),
  organizationId: z.string().trim().optional(),
  platformRole: z
    .enum([
      "all",
      "user",
      "platform_operator",
      "platform_admin",
      "platform_access",
    ])
    .optional(),
  membershipScope: z
    .enum(["all", "lab_members", "no_lab_membership", "backoffice_only"])
    .optional(),
});

const BanUserSchema = z.object({
  banReason: z.string().trim().max(500).optional(),
  banExpiresIn: z.number().int().positive().optional(),
});

const ImpersonationBridgeSchema = z.object({
  token: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
});

const ImpersonateUserSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getEnvValue(c: { env?: unknown }, key: string) {
  return recordFromUnknown(c.env)[key];
}

function responseStatus(status: number) {
  switch (status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
    case 422:
    case 500:
    case 503:
      return status;
    default:
      return 500;
  }
}

function platformUserFromUnknown(value: unknown) {
  const candidate = recordFromUnknown(value);
  const nested = recordFromUnknown(candidate.user);
  const user = Object.keys(nested).length > 0 ? nested : candidate;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string"
  ) {
    throw new HTTPException(502, {
      message: "Backoffice auth returned an invalid user payload",
    });
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function getAppRedirectErrorUrl(c: {
  req: {
    header(name: string): string | undefined;
  };
  env?: unknown;
}) {
  return `${resolveAppUrl(c)}/backoffice/users`;
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

async function forwardLabAuthResponse(params: {
  c: {
    req: { raw: Request };
  };
  path: string;
  body?: Record<string, unknown>;
}) {
  const auth = createLabAuth();
  const url = new URL(params.c.req.raw.url);
  url.pathname = params.path;
  url.search = "";

  const headers = new Headers(params.c.req.raw.headers);

  if (params.body) {
    headers.set("content-type", "application/json");
  }

  return auth.handler(
    new Request(url.toString(), {
      method: "POST",
      headers,
      body: params.body ? JSON.stringify(params.body) : undefined,
    }),
  );
}

async function logPlatformEvent(params: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(platformEventLog).values({
    actorUserId: params.actorUserId ?? null,
    targetUserId: params.targetUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    details: params.details ?? null,
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

function resolveTrustedAppUrl(c: { env?: unknown }) {
  const configuredAppUrl =
    getEnvValue(c, "APP_URL") ?? process.env.APP_URL ?? process.env.WEB_URL;

  if (typeof configuredAppUrl === "string") {
    const trimmed = configuredAppUrl.trim().replace(/\/+$/, "");
    if (trimmed) return trimmed;
  }

  return process.env.NODE_ENV === "production"
    ? "https://calibrafacil.com"
    : "http://localhost:5173";
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

    const queue = {
      pending: 0,
      processing: 0,
      failed: 0,
      completed: 0,
      stuck: queueStuckRows[0]?.count ?? 0,
    };
    for (const row of queueByStatus) {
      if (row.status === "PENDING") queue.pending = row.count;
      else if (row.status === "PROCESSING") queue.processing = row.count;
      else if (row.status === "FAILED") queue.failed = row.count;
      else if (row.status === "COMPLETED") queue.completed = row.count;
    }

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
          location: `${resolveAppUrl(c)}/dashboard`,
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
  .get("/organizations", async (c) => {
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
  .get("/organizations/:id", async (c) => {
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
    "/organizations/:id/lifecycle",
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
        .returning({
          id: organization.id,
          status: organization.status,
          suspendedAt: organization.suspendedAt,
          suspensionReason: organization.suspensionReason,
          deletionScheduledAt: organization.deletionScheduledAt,
        });
      const updated = updatedRows[0];
      if (!updated) {
        return c.json({ error: "Falha ao atualizar a conta" }, 500);
      }

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
  .get("/organizations/:id/entitlement-overrides", async (c) => {
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
    "/organizations/:id/entitlement-overrides",
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
  .post(
    "/entitlement-overrides/:id/revoke",
    requirePlatformAdmin,
    async (c) => {
      const session = c.get("session");
      const id = Number.parseInt(c.req.param("id"), 10);
      if (!Number.isInteger(id)) {
        return c.json({ error: "Concessão inválida" }, 400);
      }

      const deletedRows = await db
        .delete(entitlementOverride)
        .where(eq(entitlementOverride.id, id))
        .returning({
          id: entitlementOverride.id,
          organizationId: entitlementOverride.organizationId,
          feature: entitlementOverride.feature,
        });
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
  .get("/approvals", zValidator("query", ApprovalListQuerySchema), async (c) => {
    const input = c.req.valid("query");

    const conditions = [];
    if (input.status && input.status !== "all") {
      const statusByFilter = {
        pending: "PENDING",
        approved: "APPROVED",
        rejected: "REJECTED",
      } as const;
      conditions.push(eq(approvalRequest.status, statusByFilter[input.status]));
    }
    if (input.organizationId) {
      conditions.push(eq(approvalRequest.organizationId, input.organizationId));
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
  })
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
      if (existing.requestedByUserId === session.user.id) {
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
  // Derived product-usage telemetry (gap #1 core) — operator evidence of whether
  // a lab is *actually* producing work, read live off existing domain tables (no
  // event spine / instrumentation yet). Jobs, certificate releases and portal
  // calibration requests are the load-bearing "is this account alive" signals.
  .get("/organizations/:id/activity", async (c) => {
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
  // Migration importer (gap #12, preview-only). The client parses the spreadsheet
  // and maps columns; the server runs the pure dry-run validation, persists an
  // `import_run` audit row and returns the result + field contract. No domain
  // records are written — the commit is a gated follow-up.
  .post(
    "/organizations/:id/import-runs/validate",
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
  .get("/organizations/:id/import-runs", async (c) => {
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
  .get(
    "/users",
    zValidator("query", ListBackofficeUsersQuerySchema),
    async (c) => {
      const input = c.req.valid("query");
      const limit = input.limit ?? 100;
      const offset = input.offset ?? 0;
      const platformRole = input.platformRole ?? "all";
      const membershipScope = input.membershipScope ?? "all";

      const labMembershipSubquery = db
        .select({ userId: member.userId })
        .from(member)
        .innerJoin(
          organization,
          and(
            eq(member.organizationId, organization.id),
            eq(organization.type, "LAB"),
          ),
        );

      const conditions = [];

      if (input.search) {
        const pattern = `%${input.search}%`;
        conditions.push(
          or(ilike(userTable.name, pattern), ilike(userTable.email, pattern))!,
        );
      }

      if (input.organizationId) {
        conditions.push(
          inArray(
            userTable.id,
            db
              .select({ userId: member.userId })
              .from(member)
              .where(eq(member.organizationId, input.organizationId)),
          ),
        );
      }

      if (platformRole === "user") {
        conditions.push(eq(userTable.role, "user"));
      } else if (platformRole === "platform_operator") {
        conditions.push(eq(userTable.role, "platform_operator"));
      } else if (platformRole === "platform_admin") {
        conditions.push(eq(userTable.role, "platform_admin"));
      } else if (platformRole === "platform_access") {
        conditions.push(
          or(
            eq(userTable.role, "platform_operator"),
            eq(userTable.role, "platform_admin"),
          )!,
        );
      }

      if (membershipScope === "lab_members") {
        conditions.push(inArray(userTable.id, labMembershipSubquery));
      } else if (membershipScope === "no_lab_membership") {
        conditions.push(not(inArray(userTable.id, labMembershipSubquery)));
      } else if (membershipScope === "backoffice_only") {
        conditions.push(
          and(
            or(
              eq(userTable.role, "platform_operator"),
              eq(userTable.role, "platform_admin"),
            ),
            not(inArray(userTable.id, labMembershipSubquery)),
          )!,
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [users, totalRows] = await Promise.all([
        db.query.user.findMany({
          where: whereClause,
          orderBy: [asc(userTable.name), asc(userTable.email)],
          limit,
          offset,
        }),
        db
          .select({
            total: sql<number>`count(*)`,
          })
          .from(userTable)
          .where(whereClause),
      ]);

      const userIds = users.map((user) => user.id);

      const memberships = userIds.length
        ? await db
            .select({
              userId: member.userId,
              organizationId: organization.id,
              organizationName: organization.name,
              organizationSlug: organization.slug,
              memberRole: member.role,
            })
            .from(member)
            .innerJoin(
              organization,
              and(
                eq(member.organizationId, organization.id),
                eq(organization.type, "LAB"),
              ),
            )
            .where(inArray(member.userId, userIds))
            .orderBy(asc(organization.name))
        : [];

      const membershipsByUser = new Map<
        string,
        Array<{
          organizationId: string;
          organizationName: string;
          organizationSlug: string;
          memberRole: string;
        }>
      >();

      for (const row of memberships) {
        const current = membershipsByUser.get(row.userId) ?? [];
        current.push({
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          organizationSlug: row.organizationSlug,
          memberRole: row.memberRole,
        });
        membershipsByUser.set(row.userId, current);
      }

      return c.json({
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          banned: user.banned,
          createdAt: user.createdAt,
          memberships: membershipsByUser.get(user.id) ?? [],
        })),
        total: totalRows[0]?.total ?? 0,
        filters: {
          limit,
          offset,
          search: input.search ?? "",
          organizationId: input.organizationId ?? "",
          platformRole,
          membershipScope,
        },
      });
    },
  )
  .post(
    "/users",
    requirePlatformAdmin,
    zValidator("json", CreatePlatformUserSchema),
    async (c) => {
      const auth = createBackofficeAuth();
      const session = c.get("session");
      const input = c.req.valid("json");
      const temporaryPassword = randomBytes(24).toString("base64url");
      const appUrl = resolveAppUrl(c);

      const createdUser = await auth.api.createUser({
        body: {
          name: input.name,
          email: input.email,
          password: temporaryPassword,
          role: input.role,
        },
        headers: c.req.raw.headers,
      });
      const createdUserRecord = platformUserFromUnknown(createdUser);

      const resetResponse = await forwardLabAuthResponse({
        c,
        path: "/api/auth/lab/request-password-reset",
        body: {
          email: input.email,
          redirectTo: `${appUrl}/reset-password`,
        },
      });

      const resetPayload = resetResponse.ok
        ? null
        : await resetResponse.json().catch(() => null);

      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId: createdUserRecord.id,
        action: "backoffice.user.created",
        entityType: "user",
        entityId: createdUserRecord.id,
        details: {
          email: input.email,
          role: input.role,
          passwordSetupRequested: resetResponse.ok,
        },
      });

      return c.json({
        user: createdUserRecord,
        passwordSetupRequested: resetResponse.ok,
        passwordSetupMessage: resetResponse.ok
          ? "Email de definição de senha solicitado"
          : extractErrorMessage(
              resetPayload,
              "Falha ao enviar email de definição de senha",
            ),
      });
    },
  )
  .post(
    "/users/:id/impersonate",
    zValidator("json", ImpersonateUserSchema),
    async (c) => {
      const backofficeAuth = createBackofficeAuth();
      const session = c.get("session");
      const targetUserId = c.req.param("id");
      // Governance: impersonation requires a recorded justification (LGPD / trust).
      // The reason is written to the immutable platformEventLog and is visible in
      // the backoffice Audit Log.
      const { reason } = c.req.valid("json");
      const targetUser = await db.query.user.findFirst({
        where: eq(userTable.id, targetUserId),
      });

      if (!targetUser) {
        return c.json({ error: "Usuário alvo não encontrado" }, 404);
      }

      const handoff = await backofficeAuth.api.generateOneTimeToken({
        headers: c.req.raw.headers,
      });

      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId,
        action: "backoffice.impersonation.handoff.started",
        entityType: "user",
        entityId: targetUserId,
        details: {
          email: targetUser.email,
          reason,
        },
      });

      const bridgeSearch = new URLSearchParams({
        token: handoff.token,
        targetUserId,
      });

      return c.json({
        redirectPath: `/api/backoffice/impersonation/bridge?${bridgeSearch.toString()}`,
      });
    },
  )
  .use("/users/:id/request-password-reset", requirePlatformAdmin)
  .use("/users/:id/role", requirePlatformAdmin)
  .use("/users/:id/ban", requirePlatformAdmin)
  .use("/users/:id/unban", requirePlatformAdmin)
  .post("/users/:id/request-password-reset", async (c) => {
    const session = c.get("session");
    const userId = c.req.param("id");
    const user = await db.query.user.findFirst({
      where: eq(userTable.id, userId),
    });

    if (!user) {
      return c.json({ error: "Usuário não encontrado" }, 404);
    }

    const appUrl = resolveAppUrl(c);
    const response = await forwardLabAuthResponse({
      c,
      path: "/api/auth/lab/request-password-reset",
      body: {
        email: user.email,
        redirectTo: `${appUrl}/reset-password`,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return c.json(
        {
          error: extractErrorMessage(
            payload,
            "Falha ao solicitar definição de senha",
          ),
        },
        {
          status: responseStatus(response.status),
        },
      );
    }

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: userId,
      action: "backoffice.user.password_setup.requested",
      entityType: "user",
      entityId: userId,
      details: {
        email: user.email,
      },
    });

    return c.json({ ok: true });
  })
  .post(
    "/users/:id/role",
    zValidator("json", SetPlatformRoleSchema),
    async (c) => {
      const auth = createBackofficeAuth();
      const session = c.get("session");
      const userId = c.req.param("id");
      const input = c.req.valid("json");

      const result = await auth.api.setRole({
        body: {
          userId,
          role: input.role,
        },
        headers: c.req.raw.headers,
      });

      await db.delete(authSession).where(eq(authSession.userId, userId));

      await logPlatformEvent({
        actorUserId: session.user.id,
        targetUserId: userId,
        action: "backoffice.user.role.updated",
        entityType: "user",
        entityId: userId,
        details: {
          role: input.role,
        },
      });

      return c.json(result);
    },
  )
  .post("/users/:id/ban", zValidator("json", BanUserSchema), async (c) => {
    const auth = createBackofficeAuth();
    const session = c.get("session");
    const userId = c.req.param("id");
    const input = c.req.valid("json");

    const result = await auth.api.banUser({
      body: {
        userId,
        banReason: input.banReason,
        banExpiresIn: input.banExpiresIn,
      },
      headers: c.req.raw.headers,
    });

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: userId,
      action: "backoffice.user.banned",
      entityType: "user",
      entityId: userId,
      details: {
        banReason: input.banReason ?? null,
        banExpiresIn: input.banExpiresIn ?? null,
      },
    });

    return c.json(result);
  })
  .post("/users/:id/unban", async (c) => {
    const auth = createBackofficeAuth();
    const session = c.get("session");
    const userId = c.req.param("id");

    const result = await auth.api.unbanUser({
      body: { userId },
      headers: c.req.raw.headers,
    });

    await logPlatformEvent({
      actorUserId: session.user.id,
      targetUserId: userId,
      action: "backoffice.user.unbanned",
      entityType: "user",
      entityId: userId,
    });

    return c.json(result);
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
