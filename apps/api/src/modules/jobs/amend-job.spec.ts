import { calibrationJob } from "@calibra-facil/db/schema";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// amend-job.ts opens database connections at import time through its lib imports;
// technicalRecordOf is pure, so the unit tier stubs the two that do.
vi.mock("../../lib/certificate-numbering", () => ({
  generateCertificateIdentity: vi.fn(),
}));
vi.mock("../../lib/org-transaction", () => ({
  orgTransactionWithExecutor: vi.fn(),
}));

import { technicalRecordOf } from "./amend-job";
import type { JobRow } from "./job-actor";

/**
 * Every column of calibration_job is either part of the technical record an
 * amendment carries over (roadmap 2 B3, ISO/IEC 17025 §7.8.8) or is deliberately
 * not carried, with the reason. A column added to the table later fails this test
 * until someone classifies it: an amendment must not silently drop (or copy) a
 * field of the frozen record.
 */
const NOT_CARRIED: Record<string, string> = {
  id: "identity of the new row",
  jobId: "the amendment gets its own certificate number",
  certificateName: "the amendment gets its own certificate number",
  certificateNumberingSnapshot: "numbering of the new certificate number",
  organizationId: "set explicitly from the original",
  unitId: "set explicitly from the original",
  status: "the clone is created DRAFT and walks the state machine",
  visitId: "belongs to the original's business context",
  sourceServiceOrderId: "belongs to the original's business context",
  asFoundConformity: "derived at approval from the frozen results",
  asFoundMargins: "derived at approval from the frozen results",
  scopeComplianceStatus: "re-stamped at submit and approval",
  scopeComplianceFindings: "re-stamped at submit and approval",
  scopeOverrideJustification: "an approver's decision, taken again at approval",
  certificateUrl: "the amendment is a new document",
  labelUrl: "the amendment is a new document",
  verificationToken: "the amendment has its own public token",
  createdAt: "the new row's own",
  createdBy: "the user who opens the amendment",
  updatedAt: "the new row's own",
  approvedBy: "approval is done again",
  approvedAt: "approval is done again",
  rejectedBy: "review is done again",
  rejectedAt: "review is done again",
  rejectionReason: "review is done again",
  supersedesId: "set explicitly: the link to the original",
  supersededById: "set when a later amendment is issued",
  amendmentNumber: "set explicitly",
  amendmentReason: "set explicitly: the written reason of this amendment",
  supersededAt: "set when a later amendment is issued",
  signatureMetadata: "the amendment is signed again",
  signatureVerdict: "the amendment is signed again",
};

/** Narrowing only: the test row is built column by column from the table itself. */
function isJobRow(value: unknown): value is JobRow {
  return typeof value === "object" && value !== null;
}

function original(): JobRow {
  const columns = Object.keys(getTableColumns(calibrationJob));
  // Every column carries a distinct marker so a copied value is identifiable.
  const row: unknown = Object.fromEntries(
    columns.map((name) => [name, `v:${name}`]),
  );
  if (!isJobRow(row)) throw new Error("unreachable");
  return row;
}

describe("technicalRecordOf (the technical record an amendment clones)", () => {
  it("REQ-B3-A4: classifies every column of calibration_job as carried or deliberately not carried", () => {
    const carried = Object.keys(technicalRecordOf(original()));
    const all = Object.keys(getTableColumns(calibrationJob));

    const unclassified = all.filter(
      (name) => !carried.includes(name) && !(name in NOT_CARRIED),
    );
    expect(unclassified).toEqual([]);
    // A carried column is not also listed as dropped.
    expect(carried.filter((name) => name in NOT_CARRIED)).toEqual([]);
  });

  it("REQ-B3-A4: carries the values as they are, the frozen record included", () => {
    const row = original();
    const record = technicalRecordOf(row);

    for (const [name, value] of Object.entries(record)) {
      expect(value, name).toBe(Reflect.get(row, name));
    }
    expect(Object.keys(record).toSorted()).toEqual(
      expect.arrayContaining([
        "performedAt",
        "assetSnapshot",
        "environmentalSnapshot",
        "calibrationLocationSnapshot",
        "calibrationPhaseSnapshot",
        "methodDeviations",
        "methodSnapshot",
        "standardsSnapshot",
        "data",
        "results",
      ]),
    );
  });
});
