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
import {
  notifyJobApproved,
  notifyCertificateReady,
} from "@calibra-facil/notifications";

// Notify on job approval
await notifyJobApproved({
  jobId: 123,
  organizationId: "org_xxx",
  approverName: "John Doe",
});

// Notify certificate is ready
await notifyCertificateReady({
  jobId: 123,
  customerId: 456,
  certificateUrl: "https://...",
});
```

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
