# @calibra-facil/worker

Background job processor for PDF generation and scheduled compliance checks.

## Overview

The worker handles asynchronous tasks that are too heavy for the main API, including PDF certificate generation using Puppeteer and daily compliance notification checks.

## Features

### Queue Processing

Processes messages from the Postgres-backed `app_queue_job` table:

```typescript
interface QueueMessage {
  type: "CERTIFICATE" | "LABEL"; // Default: CERTIFICATE
  jobId: number;
  userId: string;
}
```

**Certificate Generation:**

1. Fetches calibration job data from database
2. Renders `CertificateHtml` component to HTML string
3. Generates PDF using Puppeteer/Chromium
4. Uploads to R2 bucket using scoped keys (`org/{orgId}/{YYYY}/jobs/{jobId}/cert.pdf`)
5. Updates job status to APPROVED with `certificate_url`
6. Records audit log entry

**Label Generation:**

1. Fetches label data (job_id, asset tag, lab name)
2. Generates QR code (verification URL) as SVG
3. Renders `LabelHtml` component (50mm × 30mm format)
4. Generates PDF for thermal printer
5. Uploads to R2 using scoped keys (`org/{orgId}/{YYYY}/jobs/{jobId}/label.pdf`) and updates job with `label_url`

### Scheduled Tasks

Runs daily at 08:00 UTC from the long-running worker process:

- **Asset Recalibration Alerts:** Assets due within 7 days
- **Standard Expiry Alerts:** Reference standards expiring within 30 days
- **Overdue Job Alerts:** Jobs past their due date

Uses `scheduled_notification` table to prevent duplicate alerts.

## Development

```bash
# From root
pnpm turbo dev --filter=@calibra-facil/worker

# Or from this directory
pnpm dev
```

## Environment Variables

Create `.env` from `.env.example`:

```env
DATABASE_URL=
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
CHROMIUM_PACK_R2_BUCKET=
CHROMIUM_PACK_R2_KEY=
CHROMIUM_PACK_URL=
SIGNING_MASTER_KEY=
INTEGRATIONS_MASTER_KEY=
```

## Deployment

```bash
pnpm deploy
```

Or via CI/CD on push to main branch.

## Project Structure

```
src/
├── bun.ts             # Bun process entrypoint
├── index.ts           # Queue and scheduled job handlers
├── certificate.ts     # Certificate PDF generation
├── label.ts           # Label PDF generation
└── scheduled.ts       # Cron job handlers
```
