import { resolve } from "node:path";

import {
  createConfiguredXlsxToPdfConverter,
  ExcelTsCertificateWorkbookEngine,
} from "../src/index.js";
import { keepOnlyVisibleSheet } from "../src/ooxml.js";
import { readBytes, tmpRoot, writeBytes } from "./fixture-common.js";
import { comparePdfPair } from "./pdf-compare.js";

const workbookPath = process.env.WORKBOOK_PATH;
const sheetName = process.env.WORKSHEET_NAME;

if (!workbookPath) {
  throw new Error("WORKBOOK_PATH is required for workbook fidelity checks.");
}

const compareRoot = resolve(tmpRoot, "compare-workbook");
const engine = new ExcelTsCertificateWorkbookEngine();
const converter = createConfiguredXlsxToPdfConverter();
const source = await readBytes(workbookPath);
const original = sheetName
  ? keepOnlyVisibleSheet(source, sheetName, {
      printArea: process.env.PRINT_AREA,
      fitToWidth: process.env.FIT_TO_WIDTH
        ? Number.parseInt(process.env.FIT_TO_WIDTH, 10)
        : undefined,
      fitToHeight: process.env.FIT_TO_HEIGHT
        ? Number.parseInt(process.env.FIT_TO_HEIGHT, 10)
        : undefined,
    })
  : source;
const noopWorkbook = await engine.fillScalars(original, [], {});

const outputs = {
  original: await converter.convert(original, {
    fileName: "actual-original.xlsx",
    singlePageSheets: true,
  }),
  noop: await converter.convert(noopWorkbook, {
    fileName: "actual-noop-roundtrip.xlsx",
    singlePageSheets: true,
  }),
};

const originalPdf = resolve(compareRoot, "original.pdf");
const noopPdf = resolve(compareRoot, "noop-roundtrip.pdf");

await writeBytes(originalPdf, outputs.original.bytes);
await writeBytes(noopPdf, outputs.noop.bytes);

const diff = await comparePdfPair({
  leftPdf: originalPdf,
  rightPdf: noopPdf,
  diffPpm: resolve(compareRoot, "page-1-diff.ppm"),
});

console.log(
  JSON.stringify(
    {
      workbookPath,
      sheetName: sheetName ?? null,
      compareRoot,
      diff,
      metadata: Object.fromEntries(
        Object.entries(outputs).map(([key, value]) => [key, value.metadata]),
      ),
    },
    null,
    2,
  ),
);
