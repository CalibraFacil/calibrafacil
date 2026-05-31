import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), "index.ts");
const source = readFileSync(sourcePath, "utf8");

function extractSourceBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} must exist after ${startMarker}`);
  return source.slice(start, end);
}

const previewBody = extractSourceBlock(
  "async function processXlsxPreviewJob",
  "function formatCustomerAddress",
);
assert.doesNotMatch(
  previewBody,
  /issued_certificate_snapshot|updateJobWithCertificate|certificate_url\s*=/,
  "XLSX previews must not issue certificates or mutate calibration_job certificate_url",
);
assert.match(
  previewBody,
  /certificate_template_preview[\s\S]*status = 'RENDERED'/,
  "XLSX previews should only update preview metadata on success",
);
assert.doesNotMatch(
  previewBody,
  /singlePageSheets:\s*true/,
  "XLSX previews must honor certificate page setup instead of forcing one-page sheets",
);
assert.doesNotMatch(
  source,
  /A1:W47|A48:W100|rowBreaks|printAreas|Planilha1/,
  "XLSX rendering must not hardcode EXEMPLO page split/layout corrections",
);

const issuedBody = extractSourceBlock(
  "async function processXlsxIssuedCertificate",
  "export async function processBackgroundJob",
);
const existingSnapshotIndex = issuedBody.indexOf("existingSnapshot");
// Artifacts are stored via bucketBinding(env, <bucket>).put(...) after the
// documents/media split, so match the `.put(` call rather than the old binding.
const firstPutIndex = issuedBody.indexOf(".put(");
const insertSnapshotIndex = issuedBody.indexOf(
  "insert into issued_certificate_snapshot",
);

assert.notEqual(
  existingSnapshotIndex,
  -1,
  "XLSX issuance must check for an existing issued snapshot",
);
assert.notEqual(
  firstPutIndex,
  -1,
  "XLSX issuance must store generated artifacts",
);
assert.notEqual(
  insertSnapshotIndex,
  -1,
  "XLSX issuance must write an immutable issued snapshot",
);
assert(
  existingSnapshotIndex < firstPutIndex,
  "XLSX issuance must check existing snapshot before writing R2 artifacts",
);
assert(
  existingSnapshotIndex < insertSnapshotIndex,
  "XLSX issuance must check existing snapshot before inserting issued snapshots",
);
assert.match(
  issuedBody,
  /if \(existingSnapshot\)[\s\S]*return \{ success: true, certificateUrl \};/,
  "XLSX issuance retries must reuse the existing artifact URL and return early",
);
assert.doesNotMatch(
  issuedBody,
  /singlePageSheets:\s*true/,
  "XLSX issuance must honor certificate page setup instead of forcing one-page sheets",
);

console.log("xlsx certificate worker safety checks passed");
