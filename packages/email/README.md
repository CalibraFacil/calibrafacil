# @calibra-facil/email

Email templates built with React Email for transactional emails.

## Overview

This package provides React-based email templates that are rendered to HTML and sent via Resend.

## Installation

```bash
pnpm add @calibra-facil/email
```

## Usage

```typescript
import { OrganizationInvitationEmail } from "@calibra-facil/email";
import { render } from "@react-email/render";

const html = await render(
  OrganizationInvitationEmail({
    inviterName: "John",
    organizationName: "Lab XYZ",
    inviteLink: "https://...",
  }),
);
```

## Available Templates

| Template                      | Description                                           |
| ----------------------------- | ----------------------------------------------------- |
| `OrganizationInvitationEmail` | Team member invitations                               |
| `NotificationEmail`           | Generic notification template                         |
| `JobNotificationEmail`        | Job status updates (submitted, approved, rejected)    |
| `CertificateReadyEmail`       | Certificate ready for download                        |
| `ComplianceAlertEmail`        | Compliance reminders (assets due, standards expiring) |
| `PaymentNotificationEmail`    | Payment confirmations, invoices                       |

## Components

- `EmailLayout` - Common layout with header/footer
- `StatusBox` - Status badge components

## Development

Preview templates locally:

```bash
pnpm dev
```

Opens React Email preview at `http://localhost:3000`.
