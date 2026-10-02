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

## Environment Variables

```env
DATABASE_URL=postgres://user:pass@host:5432/database
```

For Cloudflare Workers, the database is accessed via Hyperdrive binding.

## Exports

- `@calibra-facil/db` - Database connection instance
- `@calibra-facil/db/schema` - All table definitions
