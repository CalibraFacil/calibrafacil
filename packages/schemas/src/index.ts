import { z } from "zod";

export const TaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(3, "Title must be at least 3 characters"),
  status: z.enum(["pending", "completed"]).default("pending"),
});

export type Task = z.infer<typeof TaskSchema>;

export const GetTasksQuerySchema = z.object({
  status: z.string().optional(),
});

// =============================================================================
// CUSTOMER SCHEMAS
// =============================================================================

/**
 * Address schema for customer addresses (Brazilian format)
 */
export const AddressSchema = z.object({
  cep: z.string().optional(),
  number: z.string().optional(),
  street: z.string().optional(),
  neighbourhood: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

export type Address = z.infer<typeof AddressSchema>;

/**
 * Schema for creating a new customer
 */
export const CreateCustomerSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  taxId: z.string().optional(),
  email: z
    .string()
    .email("Email invalido")
    .optional()
    .or(z.literal("")),
  phone: z.string().optional(),
  address: AddressSchema.optional(),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

/**
 * Schema for updating a customer
 */
export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

/**
 * Schema for listing customers with pagination and search
 */
export const ListCustomersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().optional(),
});

export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;

// =============================================================================
// PORTAL USER MANAGEMENT SCHEMAS
// =============================================================================

/**
 * Schema for inviting a portal user
 */
export const CreatePortalInvitationSchema = z.object({
  email: z.string().email("Email invalido"),
  role: z.enum(["client_user"]).default("client_user"),
});

export type CreatePortalInvitationInput = z.infer<typeof CreatePortalInvitationSchema>;

/**
 * Schema for updating a portal member's role
 */
export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["client_user"]),
});

export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;

// =============================================================================
// COMPLIANCE SCHEMAS - ISO 17025:2017
// =============================================================================

/**
 * Qualification status values for ISO 17025 compliance
 */
export const QualificationStatusSchema = z.enum([
  "pending",
  "qualified",
  "suspended",
  "expired",
]);

export type QualificationStatus = z.infer<typeof QualificationStatusSchema>;

/**
 * Schema for customer compliance data
 */
export const CustomerComplianceSchema = z.object({
  qualificationStatus: QualificationStatusSchema.optional(),
  qualificationDate: z.string().optional(),
  qualificationExpiresAt: z.string().optional(),
  contractNumber: z.string().optional(),
  contractSignedAt: z.string().optional(),
  contractExpiresAt: z.string().optional(),
  qualityRequirementsAcknowledged: z.boolean().optional(),
  notes: z.string().optional(),
});

export type CustomerComplianceInput = z.infer<typeof CustomerComplianceSchema>;

/**
 * Schema for updating compliance data
 * Requires reason for audit trail (ISO 17025 clause 8.4)
 */
export const UpdateComplianceSchema = z.object({
  compliance: CustomerComplianceSchema,
  reason: z.string().min(1, "Motivo e obrigatorio para alteracoes de conformidade"),
});

export type UpdateComplianceInput = z.infer<typeof UpdateComplianceSchema>;

/**
 * Schema for audit log query with pagination
 */
export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
