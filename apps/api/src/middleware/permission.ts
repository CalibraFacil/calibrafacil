import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { auth } from "@calibra-facil/auth";
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
 * Middleware to require authentication.
 * Sets `session` in the context.
 *
 * @example
 * app.use("*", requireAuth);
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    c.set("session", session as SessionData);

    await next();
  }
);

// =============================================================================
// ORGANIZATION MIDDLEWARE
// =============================================================================

/**
 * Middleware to require an active organization.
 * Must be used after `requireAuth`.
 * Sets `member` in the context.
 *
 * @example
 * app.use("*", requireAuth);
 * app.use("*", requireOrganization);
 */
export const requireOrganization = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const session = c.get("session");

    if (!session?.session?.activeOrganizationId) {
      throw new HTTPException(400, {
        message: "No active organization. Please select an organization.",
      });
    }

    // Get member info for the active organization
    const fullOrganization = await auth.api.getFullOrganization({
      headers: c.req.raw.headers,
    });

    if (!fullOrganization?.members) {
      throw new HTTPException(403, {
        message: "Not a member of this organization",
      });
    }

    // Find the current user's membership
    const currentMember = fullOrganization.members.find(
      (m: { userId: string }) => m.userId === session.user.id
    );

    if (!currentMember) {
      throw new HTTPException(403, {
        message: "Not a member of this organization",
      });
    }

    c.set("member", {
      id: currentMember.id,
      role: currentMember.role as RoleName,
      organizationId: session.session.activeOrganizationId,
      userId: session.user.id,
    });

    await next();
  }
);

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
    const result = await auth.api.hasPermission({
      headers: c.req.raw.headers,
      body: { permission: permissions },
    });

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
// CALIBRATION WORKFLOW MIDDLEWARE
// =============================================================================

/**
 * State getter function type for calibration workflow middleware.
 * Should fetch the calibration and return its current state.
 */
export type CalibrationStateGetter<T extends { Variables: AuthVariables }> = (
  c: Parameters<ReturnType<typeof createMiddleware<T>>>[0]
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
export function requireCalibrationAction<T extends { Variables: AuthVariables }>(
  action: CalibrationAction,
  getState: CalibrationStateGetter<T>
) {
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
 * Combined middleware for protected routes.
 * Requires authentication and active organization.
 *
 * @example
 * const protectedRoutes = new Hono<{ Variables: AuthVariables }>();
 * protectedRoutes.use("*", ...requireProtected);
 */
export const requireProtected = [requireAuth, requireOrganization] as const;

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
