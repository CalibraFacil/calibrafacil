# @calibra-facil/auth

Authentication and authorization system using Better-Auth with organization support.

## Overview

This package provides authentication, session management, and role-based access control for the Calibra Fácil platform. It integrates with Better-Auth and includes ISO 17025 compliant permission management.

## Installation

```bash
pnpm add @calibra-facil/auth
```

## Usage

### Server-side

```typescript
import { auth } from "@calibra-facil/auth";

// In Hono route
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
```

### Client-side

```typescript
import { authClient } from "@calibra-facil/auth/client";

// Sign in
await authClient.signIn.email({ email, password });

// Get session
const session = await authClient.getSession();
```

### Access Control

```typescript
import { ac } from "@calibra-facil/auth/access";

// Check permission
const canApprove = ac.hasPermission(userRole, "calibration", "approve");
```

## Roles

| Role          | Description                                 |
| ------------- | ------------------------------------------- |
| `owner`       | Full admin control, can delete organization |
| `admin`       | Full operational control, can approve jobs  |
| `technician`  | Execute calibrations, submit for review     |
| `member`      | Read-only access (default)                  |
| `client_user` | External portal access                      |

## Permissions

Resources and actions:

- **calibration:** create, read, update, delete, submit, approve, reject
- **template:** create, read, update, delete
- **method:** create, read, update, delete
- **standard:** create, read, update, delete
- **client:** create, read, update, delete
- **asset:** create, read, update, delete
- **organization:** default Better Auth permissions

## ISO 17025 Workflow

The permission system enforces ISO 17025 workflow requirements:

- **Draft:** Technician can edit and submit
- **Review:** Only admin/owner can approve, reject, or edit (with reason)
- **Approved:** Immutable, read-only

## Exports

- `@calibra-facil/auth` - Main auth factory
- `@calibra-facil/auth/client` - Client-side auth
- `@calibra-facil/auth/access` - Permission definitions
