# @calibra-facil/documents

Document templates for PDF certificate and label generation.

## Overview

This package provides React-based HTML templates that are rendered and converted to PDF by the worker using Puppeteer.

## Installation

```bash
pnpm add @calibra-facil/documents
```

## Usage

```typescript
import { CertificateHtml, LabelHtml } from "@calibra-facil/documents";
import { renderToString } from "react-dom/server";

// Render certificate HTML
const html = renderToString(
  CertificateHtml({
    jobId: "CAL-2024-0001",
    performedAt: new Date(),
    lab: { name: "Lab XYZ", accreditationNumber: "..." },
    customer: { name: "Customer ABC" },
    asset: { name: "Balança", serialNumber: "123" },
    results: { /* calibration results */ },
    approverName: "John Doe"
  })
);
```

## Document Types

### CertificateHtml

Full calibration certificate in A4 format.

**Props:**
- `jobId` - Certificate number
- `performedAt` - Calibration date
- `approvedAt` - Approval date
- `lab` - Laboratory info (name, accreditation, address)
- `customer` - Customer info
- `asset` - Calibrated instrument
- `methodSnapshot` - Method used (frozen at approval)
- `standardsSnapshot` - Standards used (frozen at approval)
- `results` - Calibration results with uncertainties
- `approverName` - Name of approver

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
- `@calibra-facil/documents/certificate` - Certificate template
