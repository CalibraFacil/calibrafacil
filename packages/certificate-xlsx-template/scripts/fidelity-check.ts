import { resolve } from "node:path";

import {
  createConfiguredXlsxToPdfConverter,
  ExcelTsCertificateWorkbookEngine,
  validateCertificateXlsxBindingManifest,
} from "../src/index.js";
import {
  readBytes,
  readManifest,
  readSampleData,
  templatePath,
  tmpRoot,
  writeBytes,
} from "./fixture-common.js";
import { comparePdfPair } from "./pdf-compare.js";

const compareRoot = resolve(tmpRoot, "compare");
const engine = new ExcelTsCertificateWorkbookEngine();
const converter = createConfiguredXlsxToPdfConverter();
const original = await readBytes(templatePath);
const data = await readSampleData();
const manifest = validateCertificateXlsxBindingManifest(await readManifest());
const noopWorkbook = await engine.fillScalars(original, [], {});
const scalars = await engine.fillScalarsWithWarnings(
  original,
  manifest.scalarBindings,
  data,
);

const outputs = {
  original: await converter.convert(original, {
    fileName: "original.xlsx",
    singlePageSheets: true,
  }),
  noop: await converter.convert(noopWorkbook, {
    fileName: "noop-roundtrip.xlsx",
    singlePageSheets: true,
  }),
  filled: await converter.convert(scalars.workbook, {
    fileName: "filled.xlsx",
    singlePageSheets: true,
  }),
};

await writeBytes(resolve(compareRoot, "original.pdf"), outputs.original.bytes);
await writeBytes(
  resolve(compareRoot, "noop-roundtrip.pdf"),
  outputs.noop.bytes,
);
await writeBytes(resolve(compareRoot, "filled.pdf"), outputs.filled.bytes);

const noopDiff = await comparePdfPair({
  leftPdf: resolve(compareRoot, "original.pdf"),
  rightPdf: resolve(compareRoot, "noop-roundtrip.pdf"),
  diffPpm: resolve(compareRoot, "page-1-diff.ppm"),
});
const filledDiff = await comparePdfPair({
  leftPdf: resolve(compareRoot, "original.pdf"),
  rightPdf: resolve(compareRoot, "filled.pdf"),
  diffPpm: resolve(compareRoot, "page-1-filled-diff.ppm"),
});

console.log(
  JSON.stringify(
    {
      compareRoot,
      diff: {
        noopRoundtrip: noopDiff,
        filled: filledDiff,
      },
      warnings: scalars.warnings,
      metadata: Object.fromEntries(
        Object.entries(outputs).map(([key, value]) => [key, value.metadata]),
      ),
    },
    null,
    2,
  ),
);
