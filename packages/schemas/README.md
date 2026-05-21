# @calibra-facil/schemas

Shared Zod validation schemas for API and form validation.

## Overview

This package provides centralized validation schemas used across the API and frontend applications, ensuring consistent data validation.

## Installation

```bash
pnpm add @calibra-facil/schemas
```

## Usage

```typescript
import { CreateCustomerSchema, CreateJobSchema } from "@calibra-facil/schemas";

// Validate input
const result = CreateCustomerSchema.safeParse(formData);
if (!result.success) {
  console.error(result.error.flatten());
}
```

## Available Schemas

### Customer Management

- `CreateCustomerSchema` - name, taxId, email, phone, address
- `UpdateCustomerSchema` - partial fields
- `ListCustomersQuerySchema` - pagination and search

### Portal Users

- `CreatePortalInvitationSchema` - email, role
- `UpdateMemberRoleSchema`

### Compliance

- `QualificationStatusSchema` - pending/qualified/suspended/expired
- `CustomerComplianceSchema` - compliance tracking fields
- `UpdateComplianceSchema` - with reason field for audit

### Assets

- `AssetTypeFieldDefinition` - key, label, type, unit, required
- Asset creation/update schemas

### Jobs

- `CreateJobSchema` - asset, customer, method, service, data
- `ExecuteJobSchema` - formula context, readings
- `SubmitForReviewSchema` - job submission
- `ApproveJobSchema` - approval with signature
- `RejectJobSchema` - rejection with reason

### Quality

- `CreateNonConformanceSchema` - type, description, detected timestamp, optional job
- `CreateCapaSchema` - CAPA classification, responsible user, dates, and action plan

## Schema-First Forms

Frontend forms should validate regulated workflow payloads with these schemas
before calling API mutations. Keep UI-only state, such as split date/time
controls, in feature form parsers and validate the final API payload shape here.

When adding a schema:

1. Export it from `src/index.ts`.
2. Add focused tests for valid payloads and operationally important invalid
   states.
3. Keep backend payload semantics stable unless the API contract changes in the
   same PR.

### Other

- `TaskSchema` - basic task model
- `AuditLogQuerySchema` - pagination for audit logs
