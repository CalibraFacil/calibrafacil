# @calibra-facil/documents

Document templates for label and service-order document generation.

## Overview

This package provides React-based HTML templates that are rendered and converted to PDF by the worker using Puppeteer. Calibration certificates are issued from XLSX workbook templates, not from this package.

## Installation

```bash
pnpm add @calibra-facil/documents
```

## Usage

```typescript
import { LabelHtml } from "@calibra-facil/documents";
import { renderToString } from "react-dom/server";

// Render label HTML
const html = renderToString(
  LabelHtml({
    jobId: "CAL-2024-0001",
    labName: "Lab XYZ",
    assetTag: "BAL-001",
    calibrationDate: new Date(),
    qrCodeDataUrl: "data:image/svg+xml;base64,...",
  }),
);
```

## Document Types

### LabelHtml

Thermal printer label (50mm × 30mm format).

**Props:**

- `jobId` - Certificate reference
- `labName` - Laboratory name
- `assetTag` - Equipment tag/ID
- `calibrationDate` - Date performed
- `qrCodeDataUrl` - QR code for verification URL

## Exports

- `@calibra-facil/documents` - Main exports
