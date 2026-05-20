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

### Other

- `TaskSchema` - basic task model
- `AuditLogQuerySchema` - pagination for audit logs
