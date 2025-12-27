import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { labAuth, portalAuth } from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import {
  member as memberTable,
  organization as organizationTable,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  PermissionCheck,
  CalibrationState,
  CalibrationAction,
  RoleName,
} from "@calibra-facil/auth/access";
import { canPerformCalibrationAction } from "@calibra-facil/auth/access";

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
}

/**
 * Context type extension for authenticated requests
 */
export interface AuthVariables {
  session: SessionData;
  member: MemberData;
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
    const session = await labAuth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("session", session as SessionData);

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
    const session = await portalAuth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("session", session as SessionData);

    await next();
  },
);

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
    // Try portal auth first (portal_session cookie)
    let session = await portalAuth.api.getSession({
      headers: c.req.raw.headers,
    });

    // If no portal session, try lab auth (lab_session cookie)
    if (!session) {
      session = await labAuth.api.getSession({
        headers: c.req.raw.headers,
      });
    }

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("session", session as SessionData);

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

  c.set("member", {
    id: memberInfo.memberId,
    role: memberInfo.memberRole as RoleName,
    organizationId: activeOrgId,
    organizationType: orgType,
    userId: userId,
  });

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
    // Try lab auth first
    let result = await labAuth.api.hasPermission({
      headers: c.req.raw.headers,
      body: { permission: permissions },
    });

    // If no result from lab, try portal
    if (!result?.success) {
      result = await portalAuth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { permission: permissions },
      });
    }

    if (!result?.success) {
      throw new HTTPException(403, {
        message: "Insufficient permissions",
      });
    }

    await next();
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

    if (!canPerformCalibrationAction(member.role, state, action)) {
      throw new HTTPException(403, {
        message: `Cannot ${action} calibration in '${state}' state with role '${member.role}'`,
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
 * Combines: requireAuth + requireOrganization + requireOrgType("LAB") + requirePermission
 *
 * @example
 * app.post("/customers", ...withLabPermission({ client: ["create"] }), handler);
 */
export function withLabPermission(permissions: PermissionCheck) {
  return [
    ...requireProtected,
    requireOrgType("LAB"),
    requirePermission(permissions),
  ] as const;
}
