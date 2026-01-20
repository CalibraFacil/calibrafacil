# @calibra-facil/worker

Background job processor for PDF generation and scheduled compliance checks, running on Cloudflare Workers.

## Overview

The worker handles asynchronous tasks that are too heavy for the main API, including PDF certificate generation using Puppeteer and daily compliance notification checks.

## Features

### Queue Processing

Processes messages from `calibration-pdf-queue`:

```typescript
interface QueueMessage {
  type: "CERTIFICATE" | "LABEL";  // Default: CERTIFICATE
  jobId: number;
  userId: string;
}
```

**Certificate Generation:**
1. Fetches calibration job data from database
2. Renders `CertificateHtml` component to HTML string
3. Generates PDF using Cloudflare Puppeteer
4. Uploads to R2 bucket
5. Updates job status to APPROVED with `certificate_url`
6. Records audit log entry

**Label Generation:**
1. Fetches label data (job_id, asset tag, lab name)
2. Generates QR code (verification URL) as SVG
3. Renders `LabelHtml` component (50mm × 30mm format)
4. Generates PDF for thermal printer
5. Uploads to R2 and updates job with `label_url`

### Scheduled Tasks

Runs daily at 08:00 UTC via cron trigger:

- **Asset Recalibration Alerts:** Assets due within 7 days
- **Standard Expiry Alerts:** Reference standards expiring within 30 days
- **Overdue Job Alerts:** Jobs past their due date

Uses `scheduled_notification` table to prevent duplicate alerts.

## Development

```bash
# From root
pnpm turbo dev --filter=@calibra-facil/worker

# Or from this directory
pnpm dev --remote  # Requires remote Puppeteer
```

## Environment Variables

Create `.dev.vars` from `.dev.vars.example`:

```env
# Database connection string (for local dev)
DATABASE_URL=
```

Cloudflare bindings (configured in `wrangler.jsonc`):
- `HYPERDRIVE` - Database connection via Hyperdrive
- `CERTIFICATES_BUCKET` - R2 bucket for storage
- `BROWSER` - Cloudflare Puppeteer service binding

## Deployment

```bash
pnpm exec wrangler deploy
```

Or via CI/CD on push to main branch.

## Project Structure

```
src/
├── index.ts           # Worker entry, queue and cron handlers
├── certificate.ts     # Certificate PDF generation
├── label.ts           # Label PDF generation
└── scheduled.ts       # Cron job handlers
```

## Cloudflare Resources

- **Queue:** `calibration-pdf-queue` - Receives PDF generation requests
- **R2 Bucket:** `calibrafacil-certificates` - Stores generated PDFs
- **Browser:** Puppeteer service for PDF rendering
- **Hyperdrive:** Database connection proxy
