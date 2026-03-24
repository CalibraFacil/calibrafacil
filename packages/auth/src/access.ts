import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * =============================================================================
 * CALIBRA-FACIL PERMISSION SYSTEM
 * =============================================================================
 *
 * ISO 17025:2017 / RBC-Inmetro Compliant Access Control
 *
 * This file defines the custom access control system for the Calibration Lab SaaS.
 * It follows ISO 17025 compliance requirements and the workflow state machine.
 *
 * PERMISSION HIERARCHY (highest to lowest):
 * 1. owner       - Full administrative control, can delete organization
 * 2. admin       - Full operational control (Manager role in workflows)
 * 3. technician  - Execute calibrations, submit for review
 * 4. member      - Basic read-only access (default role for new members)
 * 5. client_user - External client portal access
 *
 * WORKFLOW PERMISSIONS (ISO 17025 Separation of Duties):
 * - Draft state: technician can edit, submit
 * - Review state: only admin/owner can approve, reject, or edit (with reason)
 * - Approved state: immutable, read-only for all
 */

// =============================================================================
// CUSTOM STATEMENT DEFINITIONS
// =============================================================================

/**
 * Define all resources and their available actions.
 * Using `as const` for TypeScript inference.
 *
 * Resources are organized by domain:
 * - Organization management (default Better Auth)
 * - Lab operations (custom)
 * - Client portal (custom)
 */
export const statements = {
  // ---------------------------------------------------------------------------
  // Default Better Auth statements (organization, member, invitation)
  // ---------------------------------------------------------------------------
  ...defaultStatements,

  // ---------------------------------------------------------------------------
  // CALIBRATION - Core domain entity for calibration jobs
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Start a new calibration job
   * - read: View calibration details
   * - update: Modify calibration data (in draft/review)
   * - delete: Remove a calibration (only in draft)
   * - submit: Transition from Draft -> Review
   * - approve: Transition from Review -> Approved (creates Deep Freeze snapshot)
   * - reject: Transition from Review -> Draft
   */
  calibration: [
    "create",
    "read",
    "update",
    "delete",
    "submit",
    "approve",
    "reject",
  ],

  // ---------------------------------------------------------------------------
  // REQUEST - Client portal calibration intake queue
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Submit a new client calibration request
   * - read: View request details and queue state
   * - update: Review, approve, reject, and annotate requests
   * - convert: Convert approved requests into internal calibration jobs
   */
  request: ["create", "read", "update", "convert"],

  // ---------------------------------------------------------------------------
  // TEMPLATE - Calculation templates that define math models and form schemas
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Create a new calculation template
   * - read: View template definitions
   * - update: Modify template logic/schema
   * - delete: Remove a template
   * - publish: Make template available for use (versioning)
   */
  template: ["create", "read", "update", "delete", "publish"],

  // ---------------------------------------------------------------------------
  // STANDARD - Reference standards with calibration certificates
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Register a new reference standard
   * - read: View standard details and certificate data
   * - update: Update standard information
   * - delete: Remove a standard
   * - renew: Update calibration certificate (creates new version)
   */
  standard: ["create", "read", "update", "delete", "renew"],

  // ---------------------------------------------------------------------------
  // EQUIPMENT - Equipment under test (EUT) from clients
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Register new equipment
   * - read: View equipment details
   * - update: Modify equipment information
   * - delete: Remove equipment record
   */
  equipment: ["create", "read", "update", "delete"],

  // ---------------------------------------------------------------------------
  // CLIENT - Client companies that send equipment for calibration
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Register a new client company
   * - read: View client information
   * - update: Modify client details
   * - delete: Remove client (only if no active calibrations)
   * - manage_portal: Manage client portal access
   */
  client: ["create", "read", "update", "delete", "manage_portal"],

  // ---------------------------------------------------------------------------
  // CERTIFICATE - Generated PDF calibration certificates
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - read: View certificate details
   * - download: Download PDF certificate
   * - verify: Verify certificate authenticity
   */
  certificate: ["read", "download", "verify"],

  // ---------------------------------------------------------------------------
  // REPORT - Analytics and reporting
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - read: View reports and KPIs
   * - export: Export report data
   */
  report: ["read", "export"],

  // ---------------------------------------------------------------------------
  // AUDIT - Audit trail logs (ISO 17025 clause 8.4)
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - read: View audit logs
   * - export: Export audit data
   */
  audit: ["read", "export"],

  // ---------------------------------------------------------------------------
  // SETTINGS - Organization settings
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - read: View organization settings
   * - update: Modify organization settings
   */
  settings: ["read", "update"],

  // ---------------------------------------------------------------------------
  // BILLING - Subscription and billing management
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - read: View billing information
   * - update: Modify billing settings, manage subscription
   */
  billing: ["read", "update"],

  // ---------------------------------------------------------------------------
  // SERVICE - Commercial service catalog / product registry
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Create a new service offering
   * - read: View service details and pricing
   * - update: Modify service information
   * - delete: Deactivate a service (soft delete)
   */
  service: ["create", "read", "update", "delete"],

  // ---------------------------------------------------------------------------
  // NON-CONFORMANCE - ISO 17025:2017 Clause 8.7 (Control of nonconforming work)
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Register a new non-conformance
   * - read: View NC details and history
   * - update: Update NC information (disposition, resolution)
   * - approve_disposition: Approve "use as is" / "concession" dispositions
   * - escalate: Escalate NC to CAPA
   */
  non_conformance: [
    "create",
    "read",
    "update",
    "approve_disposition",
    "escalate",
  ],

  // ---------------------------------------------------------------------------
  // CAPA - ISO 17025:2017 Clause 8.2 (Corrective Actions)
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Create a new CAPA
   * - read: View CAPA details and history
   * - update: Update CAPA information
   * - implement: Mark a CAPA as implemented
   * - verify: Verify CAPA effectiveness
   * - close: Close a verified CAPA
   */
  capa: ["create", "read", "update", "implement", "verify", "close"],

  // ---------------------------------------------------------------------------
  // COMPETENCE - ISO 17025:2017 Clause 6.2.3 (Personnel competence tracking)
  // ---------------------------------------------------------------------------
  /**
   * Actions:
   * - create: Request a new qualification
   * - read: View competence records and training history
   * - update: Update competence details, assign training, manage workflow
   * - delete: Soft delete a competence record
   * - evaluate: Evaluate a technician's competence after training
   * - approve: Approve a qualification (final step)
   */
  competence: ["create", "read", "update", "delete", "evaluate", "approve"],
} as const;

// =============================================================================
// ACCESS CONTROL INSTANCE
// =============================================================================

/**
 * Create the access control instance with our custom statements.
 * This is used to define roles and check permissions.
 */
export const ac = createAccessControl(statements);

// =============================================================================
// ROLE DEFINITIONS
// =============================================================================

/**
 * MEMBER ROLE (Default for new members)
 * - Basic read-only access to most resources
 * - Can view calibrations, templates, standards, equipment, and clients
 * - Cannot create, edit, or delete anything
 * - Cannot access billing or sensitive settings
 */
export const member = ac.newRole({
  // Inherit default member permissions for organization management
  ...memberAc.statements,

  // Read-only access to operational data
  calibration: ["read"],
  request: ["read"],
  template: ["read"],
  standard: ["read"],
  equipment: ["read"],
  client: ["read"],
  certificate: ["read", "download"],
  report: ["read"],
  settings: ["read"],
  // Read-only access to service catalog
  service: ["read"],
  // Read-only access to non-conformances
  non_conformance: ["read"],
  // Read-only access to CAPAs
  capa: ["read"],
  // Read-only access to competence records
  competence: ["read"],
});

/**
 * TECHNICIAN ROLE
 * - Execute calibrations: create, edit drafts, submit for review
 * - Cannot approve or reject (manager responsibility - ISO 17025 separation of duties)
 * - Cannot modify templates or standards
 * - Can manage equipment and clients
 */
export const technician = ac.newRole({
  // Inherit default member permissions for organization management
  ...memberAc.statements,

  // Calibration operations (execute workflow)
  // - Can create new calibrations
  // - Can read all calibrations
  // - Can update calibrations in Draft state (enforced at application level)
  // - Can delete calibrations in Draft state (enforced at application level)
  // - Can submit for review (Draft -> Review)
  // - CANNOT approve or reject (manager only - ISO 17025 clause 6.2.4)
  calibration: ["create", "read", "update", "delete", "submit"],
  request: ["read", "update", "convert"],

  // Read-only access to templates (cannot modify calculation logic)
  template: ["read"],

  // Read-only access to standards (cannot modify reference data)
  standard: ["read"],

  // Full access to equipment management
  equipment: ["create", "read", "update", "delete"],

  // Full access to client management
  client: ["create", "read", "update", "delete"],

  // Certificate access
  certificate: ["read", "download", "verify"],

  // Read-only reports
  report: ["read"],

  // Read-only audit logs
  audit: ["read"],

  // Read-only settings
  settings: ["read"],

  // Read-only access to service catalog (needs to see services to create jobs)
  service: ["read"],

  // NC: can create and update (set disposition for rework/scrap), cannot approve use_as_is/concession
  non_conformance: ["create", "read", "update"],

  // CAPA: can create, update, and implement (cannot verify/close - requires admin/owner)
  capa: ["create", "read", "update", "implement"],
  // Competence: can request qualifications and view
  competence: ["create", "read"],
});

/**
 * ADMIN ROLE (Manager in workflow documentation)
 * - Full operational control of the lab
 * - Can approve/reject calibrations (ISO 17025 review authority)
 * - Can edit calibrations in Review state (with audit reason)
 * - Can manage templates and standards
 * - Can manage organization members
 * - Cannot delete organization or manage billing
 */
export const admin = ac.newRole({
  // Inherit default admin permissions for organization management
  ...adminAc.statements,

  // Full calibration control including workflow transitions
  calibration: [
    "create",
    "read",
    "update",
    "delete",
    "submit",
    "approve",
    "reject",
  ],
  request: ["create", "read", "update", "convert"],

  // Full template management
  template: ["create", "read", "update", "delete", "publish"],

  // Full standard management
  standard: ["create", "read", "update", "delete", "renew"],

  // Full equipment management
  equipment: ["create", "read", "update", "delete"],

  // Full client management including portal access
  client: ["create", "read", "update", "delete", "manage_portal"],

  // Full certificate access
  certificate: ["read", "download", "verify"],

  // Full report access
  report: ["read", "export"],

  // Full audit access
  audit: ["read", "export"],

  // Full settings access
  settings: ["read", "update"],

  // Read-only billing (cannot modify subscription)
  billing: ["read"],

  // Full service catalog management
  service: ["create", "read", "update", "delete"],

  // Full NC management including disposition approval and CAPA escalation
  non_conformance: [
    "create",
    "read",
    "update",
    "approve_disposition",
    "escalate",
  ],

  // Full CAPA management
  capa: ["create", "read", "update", "implement", "verify", "close"],
  // Full competence management
  competence: ["create", "read", "update", "delete", "evaluate", "approve"],
});

/**
 * OWNER ROLE
 * - Absolute control over the organization
 * - All permissions of admin
 * - Can delete the organization
 * - Can manage billing and subscription
 * - Can transfer ownership
 */
export const owner = ac.newRole({
  // Inherit default owner permissions for organization management
  ...ownerAc.statements,

  // Full calibration control
  calibration: [
    "create",
    "read",
    "update",
    "delete",
    "submit",
    "approve",
    "reject",
  ],
  request: ["create", "read", "update", "convert"],

  // Full template management
  template: ["create", "read", "update", "delete", "publish"],

  // Full standard management
  standard: ["create", "read", "update", "delete", "renew"],

  // Full equipment management
  equipment: ["create", "read", "update", "delete"],

  // Full client management
  client: ["create", "read", "update", "delete", "manage_portal"],

  // Full certificate access
  certificate: ["read", "download", "verify"],

  // Full report access
  report: ["read", "export"],

  // Full audit access
  audit: ["read", "export"],

  // Full settings access
  settings: ["read", "update"],

  // Full billing access (owner-only)
  billing: ["read", "update"],

  // Full service catalog management
  service: ["create", "read", "update", "delete"],

  // Full NC management
  non_conformance: [
    "create",
    "read",
    "update",
    "approve_disposition",
    "escalate",
  ],

  // Full CAPA management
  capa: ["create", "read", "update", "implement", "verify", "close"],
  // Full competence management
  competence: ["create", "read", "update", "delete", "evaluate", "approve"],
});

/**
 * CLIENT_USER ROLE (External Portal Access)
 * - For external clients accessing their data through the portal
 * - Can only see their own organization's data
 * - Can register equipment for calibration
 * - Can view calibration status and download certificates
 * - Can view invoices
 */
export const client_user = ac.newRole({
  // Note: No organization management permissions needed for external clients
  // They simply exist within their organization context

  // Equipment: clients can register their own items
  equipment: ["read", "create", "update"],

  // Calibration: read-only access to see status
  calibration: ["read"],

  // Requests: create and track portal intake
  request: ["create", "read"],

  // Certificates: full access to their certificates
  certificate: ["read", "download", "verify"],

  // Billing: can see their invoices
  billing: ["read"],

  // Read-only access to service catalog (can see services for quote requests)
  service: ["read"],
});

// =============================================================================
// ROLES EXPORT
// =============================================================================

/**
 * All roles to be passed to the Better Auth organization plugin.
 * The key names define the role identifiers used in the database.
 */
export const roles = {
  owner,
  admin,
  technician,
  member,
  client_user,
} as const;

/**
 * Type for role names (for type-safe role checks)
 */
export type RoleName = keyof typeof roles;

/**
 * Default role for new members joining the organization via invitation.
 * New members start with minimal permissions until upgraded by an admin/owner.
 */
export const DEFAULT_ROLE: RoleName = "member";

/**
 * Role hierarchy for permission inheritance checks.
 * Higher index = more permissions.
 * Note: client_user is separate as it's for external portal access.
 */
export const ROLE_HIERARCHY: RoleName[] = [
  "client_user",
  "member",
  "technician",
  "admin",
  "owner",
];

/**
 * Internal roles (lab staff) for UI filtering
 */
export const INTERNAL_ROLES: RoleName[] = [
  "member",
  "technician",
  "admin",
  "owner",
];

/**
 * External roles that are allowed to access the client portal.
 *
 * Note: Keeping this list explicit prevents leaking internal lab members
 * (owner/admin/technician/member) into portal user management screens.
 */
export const PORTAL_ACCESS_ROLES = ["client_user"] as const;

/**
 * Roles that should be visible in customer portal member lists.
 *
 * Currently this matches portal access roles, but is separate so we can evolve
 * visibility rules independently (e.g. future hidden service roles).
 */
export const PORTAL_VISIBLE_MEMBER_ROLES = [...PORTAL_ACCESS_ROLES] as const;

/**
 * Roles that can be managed (removed) from customer portal user management.
 */
export const PORTAL_MANAGEABLE_MEMBER_ROLES = ["client_user"] as const;

export type PortalAccessRole = (typeof PORTAL_ACCESS_ROLES)[number];
export type PortalVisibleMemberRole =
  (typeof PORTAL_VISIBLE_MEMBER_ROLES)[number];
export type PortalManageableMemberRole =
  (typeof PORTAL_MANAGEABLE_MEMBER_ROLES)[number];

export function isPortalAccessRole(role: string): role is PortalAccessRole {
  return PORTAL_ACCESS_ROLES.includes(role as PortalAccessRole);
}

export function isPortalVisibleMemberRole(
  role: string,
): role is PortalVisibleMemberRole {
  return PORTAL_VISIBLE_MEMBER_ROLES.includes(role as PortalVisibleMemberRole);
}

export function isPortalManageableMemberRole(
  role: string,
): role is PortalManageableMemberRole {
  return PORTAL_MANAGEABLE_MEMBER_ROLES.includes(
    role as PortalManageableMemberRole,
  );
}

/**
 * Role labels for UI display (Portuguese)
 */
export const roleLabels: Record<RoleName, string> = {
  member: "Membro",
  technician: "Tecnico",
  admin: "Administrador",
  owner: "Proprietario",
  client_user: "Cliente",
};

/**
 * Role descriptions for UI display (Portuguese)
 */
export const roleDescriptions: Record<RoleName, string> = {
  member: "Acesso somente leitura aos dados do laboratório",
  technician: "Executa calibrações e gerencia ativos e clientes",
  admin: "Controle operacional completo, aprova e rejeita calibrações",
  owner: "Controle total incluindo faturamento e exclusão da organização",
  client_user:
    "Acesso ao portal do cliente para visualizar ativos, certificados e solicitações",
};

/**
 * Get the hierarchy level of a role (0 = lowest, 4 = highest)
 */
export function getRoleLevel(role: RoleName): number {
  return ROLE_HIERARCHY.indexOf(role);
}

/**
 * Check if roleA has equal or higher permissions than roleB
 */
export function hasEqualOrHigherRole(
  roleA: RoleName,
  roleB: RoleName,
): boolean {
  return getRoleLevel(roleA) >= getRoleLevel(roleB);
}

// =============================================================================
// RESOURCE TYPE DEFINITIONS
// =============================================================================

/**
 * All available resources in the permission system
 */
export type Resource = keyof typeof statements;

/**
 * Actions available for each resource
 */
export type ActionForResource<R extends Resource> =
  (typeof statements)[R][number];

/**
 * Permission object type for hasPermission checks
 */
export type PermissionCheck = {
  [R in Resource]?: ActionForResource<R>[];
};

// =============================================================================
// WORKFLOW STATE PERMISSIONS (ISO 17025 Compliance)
// =============================================================================

/**
 * Calibration workflow states
 */
export type CalibrationState =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected";

/**
 * Calibration workflow action types
 */
export type CalibrationAction =
  | "edit"
  | "delete"
  | "submit"
  | "approve"
  | "reject";

/**
 * Defines which roles can perform actions based on calibration state.
 * This enforces ISO 17025 requirements for separation of duties and
 * immutability of approved records.
 */
export const calibrationWorkflowPermissions: Record<
  CalibrationState,
  Record<`can${Capitalize<CalibrationAction>}`, RoleName[]>
> = {
  draft: {
    canEdit: ["technician", "admin", "owner"],
    canDelete: ["technician", "admin", "owner"],
    canSubmit: ["technician", "admin", "owner"],
    canApprove: [],
    canReject: [],
  },
  submitted: {
    canEdit: [], // Cannot edit once submitted
    canDelete: ["admin", "owner"], // Only admin/owner can cancel
    canSubmit: [],
    canApprove: ["admin", "owner"],
    canReject: ["admin", "owner"],
  },
  in_review: {
    canEdit: ["admin", "owner"], // Reviewer can make corrections
    canDelete: [],
    canSubmit: [],
    canApprove: ["admin", "owner"],
    canReject: ["admin", "owner"],
  },
  approved: {
    // Immutable - ISO 17025 requirement
    canEdit: [],
    canDelete: [],
    canSubmit: [],
    canApprove: [],
    canReject: [],
  },
  rejected: {
    canEdit: ["technician", "admin", "owner"], // Can revise after rejection
    canDelete: ["technician", "admin", "owner"],
    canSubmit: ["technician", "admin", "owner"],
    canApprove: [],
    canReject: [],
  },
};

/**
 * Helper to check if a role can perform an action on a calibration
 * based on its current state.
 *
 * @example
 * if (canPerformCalibrationAction("technician", "draft", "submit")) {
 *   // Allow submit action
 * }
 */
export function canPerformCalibrationAction(
  role: RoleName,
  state: CalibrationState,
  action: CalibrationAction,
): boolean {
  const permissions = calibrationWorkflowPermissions[state];
  const key =
    `can${action.charAt(0).toUpperCase()}${action.slice(1)}` as keyof typeof permissions;
  return permissions[key].includes(role);
}

/**
 * Get all allowed actions for a role in a given calibration state.
 *
 * @example
 * const actions = getAllowedCalibrationActions("technician", "draft");
 * // ["edit", "delete", "submit"]
 */
export function getAllowedCalibrationActions(
  role: RoleName,
  state: CalibrationState,
): CalibrationAction[] {
  const actions: CalibrationAction[] = [
    "edit",
    "delete",
    "submit",
    "approve",
    "reject",
  ];
  return actions.filter((action) =>
    canPerformCalibrationAction(role, state, action),
  );
}
