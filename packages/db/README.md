# @calibra-facil/db

Database schema and ORM layer using Drizzle ORM with PostgreSQL (Neon).

## Overview

This package provides the database schema definitions and connection management for the Calibra Fácil platform. It uses Drizzle ORM for type-safe database operations.

## Installation

```bash
pnpm add @calibra-facil/db
```

## Usage

```typescript
import { db } from "@calibra-facil/db";
import { customer, asset, calibrationJob } from "@calibra-facil/db/schema";

// Query example
const customers = await db
  .select()
  .from(customer)
  .where(eq(customer.organizationId, orgId));
```

## Schema Overview

### Authentication & Users

- `user` - User accounts
- `session` - User sessions with organization context
- `account` - OAuth provider accounts
- `verification` - Email verification tokens

### Organization (Lab)

- `organization` - Lab info (name, CNPJ, accreditation number, address)
- `member` - Team members with roles
- `invitation` - Pending invitations

### Customers

- `customer` - Client companies
- `customerCompliance` - Compliance tracking (qualification status, dates)
- `customerAuditLog` - Compliance audit trail

### Assets/Equipment

- `asset` - Instruments (serial number, tag, model, next calibration date)
- `assetType` - Dynamic equipment classifications
- `assetField` - Specifications per asset type

### Calibration

- `calibrationJob` - Jobs (status: DRAFT/REVIEW/APPROVED/REJECTED)
- `jobAuditLog` - Job state changes with reasons
- `calibrationMethod` - Method definitions (equation, uncertainty model)
- `referenceStandard` - Reference standards used in calibrations
- `scheduledNotification` - Tracks sent compliance alerts

## Commands

```bash
pnpm db:generate   # Generate migration from schema changes
pnpm db:migrate    # Run pending migrations
pnpm db:studio     # Open Drizzle Studio (port 4000)
```

## Job status guard

`calibration_job.status` is guarded by a trigger generated from the state machine in
`packages/schemas/src/job-transitions.ts` (migration 0119, repeated in `sql/schema-extras.sql`):

```bash
pnpm --filter @calibra-facil/db gen:job-transitions-sql   # prints the generated function
```

- A status change that is not a move of the table fails with `calibra: illegal job transition A -> B`
  (SQLSTATE `CF001`); inserts are accepted only in `DRAFT`.
- When the table changes, ship a **new** migration with the regenerated function and update
  `sql/schema-extras.sql`; `src/job-transitions-sql.test.ts` fails until both match.
- Audited repair: `SET LOCAL calibra.allow_status_repair = 'on'` inside a transaction (an APPROVED or
  SUPERSEDED job also needs `calibra.allow_audit_rewrite`, the immutability hatch of migration 0115). See
  `DEPLOYMENT.md`.

## Environment Variables

```env
DATABASE_URL=postgres://user:pass@host:5432/database
```

For Cloudflare Workers, the database is accessed via Hyperdrive binding.

## Exports

- `@calibra-facil/db` - Database connection instance
- `@calibra-facil/db/schema` - All table definitions
