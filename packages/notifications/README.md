# @calibra-facil/notifications

Notification service for in-app and email notifications.

## Overview

This package orchestrates notifications across multiple channels (in-app database storage and email over SMTP or the Resend API).

## Installation

```bash
pnpm add @calibra-facil/notifications
```

## Usage

```typescript
import { notify } from "@calibra-facil/notifications";

// One path for every type: the payload is typed by the type.
await notify("JOB_APPROVED", { jobId: 123, approvedByUserId: "user_xxx" });
await notify("CERTIFICATE_READY", { jobId: 123 });
```

## How a notification is delivered

- `src/recipes/*.ts`: one recipe per type of the registry
  (`packages/schemas/src/notification-types.ts`). A recipe loads what the
  notification is about, decides who receives it and yields one row per
  recipient (in-app title/message/link, e-mail context).
- `src/recipes/types.ts`: `NotificationPayloads` (the arguments of each type) and
  `NotificationRecipes`, which maps **every** registry type to its recipe. A new
  type in the registry does not compile until it has a payload and a recipe.
- `src/delivery.ts`: `sendNotification`, which applies the recipient's
  preferences, inserts the in-app row and sends the e-mail.
- `src/service.ts`: `notify`, which sends each row a recipe yields.

To add a notification type: add it to the registry, add its payload to
`NotificationPayloads`, add its recipe to the domain file it belongs to.

## Notification Types

| Type                          | Description                        |
| ----------------------------- | ---------------------------------- |
| `JOB_SUBMITTED_FOR_REVIEW`    | Job submitted for approval         |
| `JOB_APPROVED`                | Job approved                       |
| `JOB_REJECTED`                | Job rejected with reason           |
| `JOB_ASSIGNED`                | Technician assigned to job         |
| `CERTIFICATE_READY`           | Certificate available for download |
| `ASSET_DUE_FOR_RECALIBRATION` | Asset due for recalibration        |
| `STANDARD_EXPIRING`           | Reference standard expiring soon   |
| `JOB_OVERDUE`                 | Job past due date                  |
| `PAYMENT_NOTIFICATION`        | Payment status update              |
| `COMPLIANCE_ALERT`            | General compliance alert           |

## Channels

- **inApp** - Stored in database notifications table
- **email** - Sent through the platform transport (SMTP or Resend)

## Default Preferences

Most notifications are enabled for both channels by default. `JOB_ASSIGNED` is in-app only to reduce email noise.

## Exports

- `@calibra-facil/notifications` - Main notification functions
- `@calibra-facil/notifications/service` - Full service implementation
