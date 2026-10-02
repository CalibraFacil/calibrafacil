# @calibra-facil/auth

Authentication and authorization system using Better-Auth with organization support.

## Overview

This package provides authentication, session management, and role-based access control for the Calibra Fácil platform. It integrates with Better-Auth and includes ISO 17025 compliant permission management.

## Auth Surfaces

Calibra Facil uses separate Better Auth instances for each product surface:

- LAB dashboard: mounted under `/api/auth/lab`
- Client portal: mounted under `/api/auth/portal`

LAB access is passwordless. A new laboratory is provisioned by the self-service sign-up (off unless `PUBLIC_SIGNUP_ENABLED=true`) or by the dev seed, and its owner receives a setup link to `/claim-account?token=...`. The claim flow is passkey-first and only offers magic-link or email OTP fallback after the setup token proves the user is allowed to claim a LAB account. Raw setup tokens are never stored; only hashed token secrets are persisted.

Other LAB users enter through a pending LAB invitation, while client portal users continue to use the portal-specific auth flow.

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

// Sign in (passwordless: passkey, magic link or email OTP)
await authClient.signIn.magicLink({ email });

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
