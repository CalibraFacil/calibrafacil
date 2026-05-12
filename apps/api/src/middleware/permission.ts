import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import {
  createBackofficeAuth,
  createLabAuth,
  createPortalAuth,
} from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import {
  member as memberTable,
  organization as organizationTable,
  type MemberUnitRole,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  PermissionCheck,
  CalibrationState,
  CalibrationAction,
  RoleName,
  PlatformRole,
} from "@calibra-facil/auth/access";
import {
  canAccessBackoffice,
  canPerformCalibrationAction,
  hasPlatformRole,
  parsePlatformRoles,
  roles,
} from "@calibra-facil/auth/access";
import {
  resolveMemberUnitScope,
  type ResolvedUnit,
  getUnitGovernanceAccess as getGovernanceAccessFromScope,
  type UnitGovernanceAccess,
} from "../lib/units";

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/**
 * Session data from Better Auth
 */
export interface SessionData {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    role?: string | null;
    banned?: boolean | null;
    banReason?: string | null;
    banExpires?: Date | null;
    image?: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  session: {
    id: string;
    userId: string;
    activeOrganizationId?: string | null;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    token: string;
    impersonatedBy?: string | null;
  };
}

/**
 * Member data for the active organization
 */
export interface MemberData {
  id: string;
  role: RoleName;
  organizationId: string;
  organizationType: OrgType;
  userId: string;
  activeUnitId: number | null;
  activeUnitName: string | null;
  accessibleUnitIds: number[];
  accessibleUnits: ResolvedUnit[];
  selectedUnitScope: "all" | "unit";
  canAccessAllUnits: boolean;
  unitRole: MemberUnitRole | null;
}

export type GovernanceAccess = UnitGovernanceAccess;

export type AuthSource = "lab" | "backoffice" | "portal";

/**
 * Context type extension for authenticated requests
 */
export interface AuthVariables {
  session: SessionData;
  member: MemberData;
  authSource: AuthSource;
  platformRoles?: PlatformRole[];
  serverTiming?: ServerTimingMetric[];
  requestLabAuth?: ReturnType<typeof createLabAuth>;
  requestBackofficeAuth?: ReturnType<typeof createBackofficeAuth>;
  requestPortalAuth?: ReturnType<typeof createPortalAuth>;
}

export interface ServerTimingMetric {
  name: string;
  dur: number;
  desc?: string;
}

const SERVER_TIMING_KEY = "serverTiming";

function getRequestLabAuth(c: {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}) {
  const existing = c.get("requestLabAuth") as
    | ReturnType<typeof createLabAuth>
    | undefined;
  if (existing) return existing;

  const auth = createLabAuth();
  c.set("requestLabAuth", auth);
  return auth;
}

function getRequestPortalAuth(c: {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}) {
  const existing = c.get("requestPortalAuth") as
    | ReturnType<typeof createPortalAuth>
    | undefined;
  if (existing) return existing;

  const auth = createPortalAuth();
  c.set("requestPortalAuth", auth);
  return auth;
}

function getRequestBackofficeAuth(c: {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}) {
  const existing = c.get("requestBackofficeAuth") as
    | ReturnType<typeof createBackofficeAuth>
    | undefined;
  if (existing) return existing;

  const auth = createBackofficeAuth();
  c.set("requestBackofficeAuth", auth);
  return auth;
}

function getServerTimingBuffer(c: {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}): ServerTimingMetric[] {
  const existing = c.get(SERVER_TIMING_KEY) as ServerTimingMetric[] | undefined;
  if (existing) return existing;

  const created: ServerTimingMetric[] = [];
  c.set(SERVER_TIMING_KEY, created);
  return created;
}

export function addServerTiming(
  c: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  },
  name: string,
  startedAt: number,
  desc?: string,
) {
  const dur = Math.max(0, performance.now() - startedAt);
  getServerTimingBuffer(c).push({ name, dur, desc });
}

function applyServerTimingHeader(c: {
  get: (key: string) => unknown;
  header?: (name: string, value: string) => void;
}) {
  if (!c.header) return;

  const entries =
    (c.get(SERVER_TIMING_KEY) as ServerTimingMetric[] | undefined) ?? [];
  if (entries.length === 0) return;

  const value = entries
    .map((entry) => {
      const durPart = `dur=${entry.dur.toFixed(2)}`;
      const descPart = entry.desc ? `;desc="${entry.desc}"` : "";
      return `${entry.name};${durPart}${descPart}`;
    })
    .join(", ");

  c.header("Server-Timing", value);
}

export function isInternalOperatorEmail(
  email: string | null | undefined,
  rawAllowlist: string | null | undefined,
) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail || !rawAllowlist) return false;

  return rawAllowlist
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedEmail);
}

function hasPermissionLocally(role: RoleName, permissions: PermissionCheck) {
  const roleAccess = roles[role] as
    | {
        authorize?: (input: PermissionCheck) => { success: boolean };
      }
    | undefined;

  if (!roleAccess?.authorize) return false;

  try {
    return roleAccess.authorize(permissions).success;
  } catch {
    return false;
  }
}

const UNIT_SCOPED_RESOURCES = new Set([
  "calibration",
  "request",
  "standard",
  "equipment",
  "certificate",
  "report",
  "audit",
  "service",
  "service_order",
  "non_conformance",
  "capa",
  "competence",
]);

function getEffectivePermissionRole(
  member: Pick<MemberData, "role" | "unitRole">,
  permissions: PermissionCheck,
): RoleName {
  if (member.role === "owner" || member.role === "admin") {
    return member.role;
  }

  const resources = Object.keys(permissions);
  const isUnitScopedOnly = resources.every((resource) =>
    UNIT_SCOPED_RESOURCES.has(resource),
  );

  if (!isUnitScopedOnly) {
    return member.role;
  }

  if (member.unitRole === "unit_admin") {
    return "admin";
  }

  if (member.unitRole === "technician") {
    return "technician";
  }

  return member.role;
}

function getCalibrationAuthorizationRole(
  member: Pick<MemberData, "role" | "unitRole">,
): RoleName {
  if (member.role === "owner" || member.role === "admin") {
    return member.role;
  }

  if (member.unitRole === "unit_admin") {
    return "admin";
  }

  if (member.unitRole === "technician") {
    return "technician";
  }

  return member.role;
}

export function getGovernanceAccess(
  member: Pick<
    MemberData,
    "role" | "unitRole" | "accessibleUnitIds" | "canAccessAllUnits"
  >,
): GovernanceAccess {
  return getGovernanceAccessFromScope(member);
}

// =============================================================================
// AUTHENTICATION MIDDLEWARE
// =============================================================================

/**
 * Middleware to require authentication using Lab auth.
 * For use on dashboard/lab routes.
 * Sets `session` in the context.
 *
 * @example
 * app.use("*", requireLabAuth);
 */
export const requireLabAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authStartedAt = performance.now();
    const labAuth = getRequestLabAuth(c);
    const session = await labAuth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("session", session as SessionData);
    c.set("authSource", "lab");
    addServerTiming(c, "auth", authStartedAt, "lab");

    await next();
  },
);

/**
 * Middleware to require authentication using Portal auth.
 * For use on client portal routes.
 * Sets `session` in the context.
 *
 * @example
 * app.use("*", requirePortalAuth);
 */
export const requirePortalAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const portalAuth = getRequestPortalAuth(c);
    const session = await portalAuth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("session", session as SessionData);
    c.set("authSource", "portal");

    await next();
  },
);

/**
 * Middleware to require authentication using Backoffice auth.
 * For use on internal backoffice routes.
 * Sets `session` in the context.
 *
 * @example
 * app.use("*", requireBackofficeAuthSession);
 */
export const requireBackofficeAuthSession = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const authStartedAt = performance.now();
  const backofficeAuth = getRequestBackofficeAuth(c);
  const session = await backofficeAuth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  c.set("session", session as SessionData);
  c.set("authSource", "backoffice");
  addServerTiming(c, "auth", authStartedAt, "backoffice");

  await next();
});

/**
 * Middleware to require authentication (tries both auth instances).
 * For use on routes that should accept both lab and portal users.
 * Sets `session` in the context.
 *
 * @example
 * app.use("*", requireAuth);
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const portalAuth = getRequestPortalAuth(c);

    // Try portal auth first (portal_session cookie)
    let authSource: AuthSource = "portal";
    let session = await portalAuth.api.getSession({
      headers: c.req.raw.headers,
    });

    // If no portal session, try lab auth (lab_session cookie)
    if (!session) {
      authSource = "lab";
      const labAuth = getRequestLabAuth(c);
      session = await labAuth.api.getSession({
        headers: c.req.raw.headers,
      });
    }

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("session", session as SessionData);
    c.set("authSource", authSource);

    await next();
  },
);

// =============================================================================
// ORGANIZATION TYPE
// =============================================================================

/**
 * Organization types for access control
 */
export type OrgType = "LAB" | "CLIENT";

// =============================================================================
// ORGANIZATION MIDDLEWARE
// =============================================================================

/**
 * Middleware to require an active organization.
 * Must be used after `requireAuth` (or requireLabAuth/requirePortalAuth).
 * Sets `member` in the context.
 *
 * Uses direct database query instead of auth API to avoid cookie conflicts
 * when both lab and portal sessions exist.
 *
 * @example
 * app.use("*", requireAuth);
 * app.use("*", requireOrganization);
 */
export const requireOrganization = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const orgStartedAt = performance.now();
  const session = c.get("session");

  if (!session?.session?.activeOrganizationId) {
    throw new HTTPException(400, {
      message: "No active organization. Please select an organization.",
    });
  }

  const activeOrgId = session.session.activeOrganizationId;
  const userId = session.user.id;

  // Query the database directly for member and organization info
  // This avoids issues with multiple auth cookies
  const result = await db
    .select({
      memberId: memberTable.id,
      memberRole: memberTable.role,
      orgType: organizationTable.type,
    })
    .from(memberTable)
    .innerJoin(
      organizationTable,
      eq(memberTable.organizationId, organizationTable.id),
    )
    .where(
      and(
        eq(memberTable.userId, userId),
        eq(memberTable.organizationId, activeOrgId),
      ),
    )
    .limit(1);

  const memberInfo = result[0];

  if (!memberInfo) {
    throw new HTTPException(403, {
      message: "Not a member of this organization",
    });
  }

  const orgType = (memberInfo.orgType as OrgType) ?? "LAB";

  const unitScope =
    orgType === "LAB"
      ? await resolveMemberUnitScope({
          organizationId: activeOrgId,
          memberId: memberInfo.memberId,
          memberRole: memberInfo.memberRole as RoleName,
          userId,
          requestedScope: c.req.header("x-active-unit-id") ?? null,
        })
      : {
          activeUnitId: null,
          activeUnitName: null,
          accessibleUnitIds: [],
          accessibleUnits: [],
          selectedUnitScope: "unit" as const,
          canAccessAllUnits: false,
          unitRole: null,
        };

  c.set("member", {
    id: memberInfo.memberId,
    role: memberInfo.memberRole as RoleName,
    organizationId: activeOrgId,
    organizationType: orgType,
    userId: userId,
    activeUnitId: unitScope.activeUnitId,
    activeUnitName: unitScope.activeUnitName,
    accessibleUnitIds: unitScope.accessibleUnitIds,
    accessibleUnits: unitScope.accessibleUnits,
    selectedUnitScope: unitScope.selectedUnitScope,
    canAccessAllUnits: unitScope.canAccessAllUnits,
    unitRole: unitScope.unitRole,
  });

  addServerTiming(c, "org", orgStartedAt);

  await next();
});

// =============================================================================
// PERMISSION MIDDLEWARE
// =============================================================================

/**
 * Middleware factory to require specific permissions.
 * Must be used after `requireAuth` and `requireOrganization`.
 *
 * @example
 * app.post(
 *   "/calibrations",
 *   requireAuth,
 *   requireOrganization,
 *   requirePermission({ calibration: ["create"] }),
 *   handler
 * );
 */
export function requirePermission(permissions: PermissionCheck) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const permStartedAt = performance.now();
    const authSource = c.get("authSource") as AuthSource;
    const member = c.get("member") as MemberData | undefined;

    if (member) {
      const hasPermission = hasPermissionLocally(
        getEffectivePermissionRole(member, permissions),
        permissions,
      );

      if (!hasPermission) {
        throw new HTTPException(403, {
          message: "Insufficient permissions",
        });
      }

      addServerTiming(c, "perm", permStartedAt, `${authSource}-local`);

      try {
        await next();
      } finally {
        applyServerTimingHeader(c);
      }

      return;
    }

    let result: { success?: boolean } | null = null;

    if (authSource === "lab") {
      const labAuth = getRequestLabAuth(c);
      result = await labAuth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { permissions },
      });
    } else if (authSource === "portal") {
      const portalAuth = getRequestPortalAuth(c);
      result = await portalAuth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { permissions },
      });
    } else if (authSource === "backoffice") {
      throw new HTTPException(403, {
        message: "Organization permissions are unavailable in backoffice auth",
      });
    } else {
      // Fallback for legacy/misconfigured middleware chains
      const labAuth = getRequestLabAuth(c);
      result = await labAuth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { permissions },
      });
    }

    if (!result?.success) {
      throw new HTTPException(403, {
        message: "Insufficient permissions",
      });
    }

    addServerTiming(c, "perm", permStartedAt, authSource);

    try {
      await next();
    } finally {
      applyServerTimingHeader(c);
    }
  });
}

// =============================================================================
// ROLE MIDDLEWARE
// =============================================================================

/**
 * Middleware factory to require one of multiple roles.
 * Must be used after `requireAuth` and `requireOrganization`.
 *
 * @example
 * app.get(
 *   "/audit",
 *   requireAuth,
 *   requireOrganization,
 *   requireRole(["admin", "owner"]),
 *   handler
 * );
 */
export function requireRole(allowedRoles: RoleName[]) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const member = c.get("member");

    if (!allowedRoles.includes(member.role)) {
      throw new HTTPException(403, {
        message: "Insufficient role privileges",
      });
    }

    await next();
  });
}

// =============================================================================
// ORGANIZATION TYPE MIDDLEWARE
// =============================================================================

/**
 * Middleware factory to require a specific organization type.
 * Must be used after `requireAuth` and `requireOrganization`.
 *
 * This provides defense-in-depth by ensuring only LAB organizations
 * can access internal lab routes, regardless of RBAC permissions.
 * Essential for ISO 17025 auditability.
 *
 * @example
 * app.post(
 *   "/customers",
 *   requireAuth,
 *   requireOrganization,
 *   requireOrgType("LAB"),
 *   requirePermission({ client: ["create"] }),
 *   handler
 * );
 */
export function requireOrgType(allowedType: OrgType) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const member = c.get("member");

    if (member.organizationType !== allowedType) {
      throw new HTTPException(403, {
        message: `This action requires a ${allowedType} organization`,
      });
    }

    await next();
  });
}

// =============================================================================
// CALIBRATION WORKFLOW MIDDLEWARE
// =============================================================================

/**
 * State getter function type for calibration workflow middleware.
 * Should fetch the calibration and return its current state.
 */
export type CalibrationStateGetter<T extends { Variables: AuthVariables }> = (
  c: Parameters<ReturnType<typeof createMiddleware<T>>>[0],
) => Promise<CalibrationState>;

/**
 * Middleware factory for calibration workflow actions.
 * Enforces ISO 17025 separation of duties based on calibration state.
 * Must be used after `requireAuth` and `requireOrganization`.
 *
 * @example
 * // Define a state getter for your calibrations
 * const getCalibrationState: CalibrationStateGetter<{ Variables: AuthVariables }> = async (c) => {
 *   const id = c.req.param("id");
 *   const calibration = await db.query.calibrations.findFirst({ where: eq(calibrations.id, id) });
 *   return calibration?.state ?? "draft";
 * };
 *
 * app.post(
 *   "/calibrations/:id/approve",
 *   requireAuth,
 *   requireOrganization,
 *   requireCalibrationAction("approve", getCalibrationState),
 *   handler
 * );
 */
export function requireCalibrationAction<
  T extends { Variables: AuthVariables },
>(action: CalibrationAction, getState: CalibrationStateGetter<T>) {
  return createMiddleware<T>(async (c, next) => {
    const member = c.get("member") as MemberData;
    const state = await getState(c);

    const effectiveRole = getCalibrationAuthorizationRole(member);

    if (!canPerformCalibrationAction(effectiveRole, state, action)) {
      throw new HTTPException(403, {
        message: `Cannot ${action} calibration in '${state}' state with role '${effectiveRole}'`,
      });
    }

    await next();
  });
}

// =============================================================================
// COMBINED MIDDLEWARE
// =============================================================================

/**
 * Combined middleware for protected routes (accepts both lab and portal auth).
 * Requires authentication and active organization.
 *
 * @example
 * const protectedRoutes = new Hono<{ Variables: AuthVariables }>();
 * protectedRoutes.use("*", ...requireProtected);
 */
export const requireProtected = [requireAuth, requireOrganization] as const;

/**
 * Combined middleware for LAB-protected routes.
 * Only accepts lab_session cookies.
 * Requires authentication and active organization.
 */
export const requireLabProtected = [
  requireLabAuth,
  requireOrganization,
] as const;

/**
 * Combined middleware for Portal-protected routes.
 * Only accepts portal_session cookies.
 * Requires authentication and active organization.
 */
export const requirePortalProtected = [
  requirePortalAuth,
  requireOrganization,
] as const;

export const requireInternalOperator = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const session = c.get("session");
  const envAllowlist =
    (c.env as Record<string, unknown> | undefined)?.INTERNAL_OPERATOR_EMAILS ??
    process.env.INTERNAL_OPERATOR_EMAILS;

  if (
    !isInternalOperatorEmail(
      session?.user?.email,
      typeof envAllowlist === "string" ? envAllowlist : undefined,
    )
  ) {
    throw new HTTPException(403, {
      message: "Internal operator access required",
    });
  }

  await next();
});

export const requireBackofficeAccess = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const session = c.get("session");
  const roles = parsePlatformRoles(session?.user?.role);

  if (!canAccessBackoffice(session?.user?.role)) {
    throw new HTTPException(403, {
      message: "Backoffice access required",
    });
  }

  c.set("platformRoles", roles);
  await next();
});

export const requirePlatformAdmin = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const session = c.get("session");
  const roles = parsePlatformRoles(session?.user?.role);

  if (!hasPlatformRole(session?.user?.role, "platform_admin")) {
    throw new HTTPException(403, {
      message: "Platform admin access required",
    });
  }

  c.set("platformRoles", roles);
  await next();
});

/**
 * Create a protected route handler with permission check.
 *
 * @example
 * app.post("/calibrations", ...withPermission({ calibration: ["create"] }), handler);
 */
export function withPermission(permissions: PermissionCheck) {
  return [...requireProtected, requirePermission(permissions)] as const;
}

/**
 * Create a protected route handler with role check.
 *
 * @example
 * app.get("/admin", ...withRole(["admin", "owner"]), handler);
 */
export function withRole(allowedRoles: RoleName[]) {
  return [...requireProtected, requireRole(allowedRoles)] as const;
}

/**
 * Create a protected LAB-only route handler with permission check.
 * Uses lab auth only (lab_session cookie) to avoid conflicts with portal sessions.
 * Combines: requireLabAuth + requireOrganization + requireOrgType("LAB") + requirePermission
 *
 * @example
 * app.post("/customers", ...withLabPermission({ client: ["create"] }), handler);
 */
export function withLabPermission(permissions: PermissionCheck) {
  return [
    ...requireLabProtected,
    requireOrgType("LAB"),
    requirePermission(permissions),
  ] as const;
}
