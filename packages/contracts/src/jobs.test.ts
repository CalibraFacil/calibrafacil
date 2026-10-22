import { describe, expect, it, vi } from "vitest";

import {
  buildJobAmendResponse,
  buildJobDetail,
  buildJobExecutionWarning,
  buildJobMutationResponse,
  buildJobRow,
  buildJobsList,
} from "./jobs.fixtures";
import {
  compiledMethodSnapshotSchema,
  jobAmendResponseSchema,
  jobDetailSchema,
  jobDownloadUrlResponseSchema,
  jobMutationResponseSchema,
  jobRowSchema,
  jobTechniciansResponseSchema,
  jobsListResponseSchema,
  type JobDetail,
  type ServerShape,
} from "./jobs";
import { portalOverviewResponseSchema } from "./portal";
import {
  ResponseContractError,
  validateResponsePayload,
} from "./response-validation";

const holdAs = (value: ServerShape<JobDetail>) => value;

describe("jobs response schemas", () => {
  it("REQ-TC-1: the list response schema accepts a list and rejects an unknown status", () => {
    const list = buildJobsList();
    expect(jobsListResponseSchema.parse(list)).toEqual(list);

    const [first] = list.data;
    const broken = {
      ...list,
      data: [{ ...first, status: "ARCHIVED" }],
    };
    expect(jobsListResponseSchema.safeParse(broken).success).toBe(false);
  });

  it("REQ-TC-1: the detail schema validates only; it never adds, drops or rewrites a key", () => {
    const detail = buildJobDetail({ status: "APPROVED" });
    // Evidence is frozen: parsing must be the identity on a valid payload.
    expect(jobDetailSchema.parse(detail)).toEqual(detail);

    const withFutureField = { ...detail, somethingTheServerAddsLater: 1 };
    expect(jobDetailSchema.safeParse(withFutureField).success).toBe(true);
  });

  it("REQ-TC-1: the detail schema rejects a field of the wrong type and a missing snapshot", () => {
    const detail = buildJobDetail();
    expect(
      jobDetailSchema.safeParse({ ...detail, daysUntilDue: "12" }).success,
    ).toBe(false);

    const { methodSnapshot: _omitted, ...withoutSnapshot } = detail;
    expect(jobDetailSchema.safeParse(withoutSnapshot).success).toBe(false);
  });

  it("REQ-TC-1: mutation responses carry the full job row", () => {
    const mutation = buildJobMutationResponse({ status: "REVIEW" });
    expect(jobMutationResponseSchema.parse(mutation)).toEqual(mutation);
    expect(jobRowSchema.safeParse(buildJobRow()).success).toBe(true);

    const { verificationToken: _omitted, ...rowWithoutToken } = buildJobRow();
    expect(
      jobMutationResponseSchema.safeParse({
        message: "ok",
        data: rowWithoutToken,
      }).success,
    ).toBe(false);
  });

  it("REQ-P111-4: a draft save response carries the structured standards warnings and parsing keeps them", () => {
    const warning = buildJobExecutionWarning({
      reason: "standard_expired",
      standardIds: [11, 12],
      standardNames: ["Massa A", "Massa B"],
    });
    const mutation = buildJobMutationResponse(
      { status: "IN_PROGRESS" },
      "Dados salvos com sucesso",
      [warning],
    );

    const parsed = jobMutationResponseSchema.parse(mutation);

    expect(parsed.warnings).toEqual([
      {
        code: "standard_no_longer_valid",
        reason: "standard_expired",
        standardIds: [11, 12],
        standardNames: ["Massa A", "Massa B"],
      },
    ]);
    // Other mutations (approve, reject, ...) carry none.
    expect(
      jobMutationResponseSchema.safeParse(buildJobMutationResponse()).success,
    ).toBe(true);
  });

  it("REQ-P111-4: a warning with an unknown reason or a non-numeric standard id breaks the contract", () => {
    const valid = buildJobExecutionWarning();
    for (const broken of [
      { ...valid, reason: "standard_backdate_reason_required" },
      { ...valid, reason: "standard_not_found" },
      { ...valid, standardIds: ["11"] },
      { ...valid, standardNames: [11] },
      { ...valid, code: "something_else" },
    ]) {
      expect(
        jobMutationResponseSchema.safeParse({
          ...buildJobMutationResponse(),
          warnings: [broken],
        }).success,
      ).toBe(false);
    }
  });

  it("REQ-TC-1: amend, technicians and download responses are covered", () => {
    expect(
      jobAmendResponseSchema.safeParse(buildJobAmendResponse()).success,
    ).toBe(true);
    expect(
      jobAmendResponseSchema.safeParse({
        ...buildJobAmendResponse(),
        amendedJob: { id: 8, jobId: "x" },
      }).success,
    ).toBe(false);
    expect(
      jobTechniciansResponseSchema.safeParse({
        data: [{ id: "u1", name: "A", email: "a@lab.test", role: "admin" }],
      }).success,
    ).toBe(true);
    expect(
      jobDownloadUrlResponseSchema.safeParse({ url: "https://x/y.pdf" })
        .success,
    ).toBe(true);
    expect(jobDownloadUrlResponseSchema.safeParse({}).success).toBe(false);
  });

  it("REQ-TC-1: the compiled method read by the worksheet is validated separately from the opaque column", () => {
    expect(
      compiledMethodSnapshotSchema.safeParse({
        methodFingerprint: "abc",
        formulas: [{ key: "erro", expression: "a - b" }],
        acceptanceCriteria: [
          {
            key: "c1",
            expression: "erro <= 1",
            severity: "blocking",
            message: "fora",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      compiledMethodSnapshotSchema.safeParse({ formulas: [] }).success,
    ).toBe(false);
  });

  it("REQ-TC-3: ServerShape lets a handler hold Dates but not drift from the contract", () => {
    const serialized = buildJobDetail();
    const held = {
      ...serialized,
      createdAt: new Date(serialized.createdAt),
    } satisfies ServerShape<JobDetail>;
    expect(held.createdAt).toBeInstanceOf(Date);

    // @ts-expect-error daysUntilDue is number | null in the contract, not a string
    holdAs({ ...serialized, daysUntilDue: "12" });
  });
});

describe("portal overview response schema", () => {
  it("REQ-TC-4: accepts the empty overview the API returns for a customer without data", () => {
    const empty = {
      equipment: {
        total: 0,
        overdue: 0,
        dueSoon: 0,
        scheduled: 0,
        unscheduled: 0,
        inLab: 0,
        attention: [],
      },
      certificates: { available: 0, recent: [] },
      requests: { total: 0, open: 0, rejected: 0, recent: [] },
      serviceOrders: {
        total: 0,
        inProgress: 0,
        awaitingQuoteApproval: 0,
        readyForPickup: 0,
        awaitingQuote: [],
        recent: [],
      },
    };
    expect(portalOverviewResponseSchema.parse(empty)).toEqual(empty);
    expect(
      portalOverviewResponseSchema.safeParse({ ...empty, equipment: {} })
        .success,
    ).toBe(false);
  });
});

describe("validateResponsePayload", () => {
  const schema = jobDownloadUrlResponseSchema;

  it("REQ-TC-2: a payload that matches comes back as the very same object", () => {
    const payload = { url: "https://x/y.pdf", extra: true };
    expect(validateResponsePayload(schema, payload, "GET /x")).toBe(payload);
  });

  it("REQ-TC-2: strict mode (the default) throws with the endpoint and the failing paths", () => {
    const run = () =>
      validateResponsePayload(schema, { url: 3 }, "GET /api/jobs/:id/download");
    expect(run).toThrow(ResponseContractError);
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(ResponseContractError);
      if (error instanceof ResponseContractError) {
        expect(error.violation.endpoint).toBe("GET /api/jobs/:id/download");
        expect(error.violation.issues.map((issue) => issue.path)).toEqual([
          "url",
        ]);
        expect(error.message).toContain("GET /api/jobs/:id/download");
      }
    }
  });

  it("REQ-TC-2: warn mode reports a structured violation and hands the payload through", () => {
    const onViolation = vi.fn();
    const payload = { url: 3 };

    const result = validateResponsePayload(schema, payload, "GET /x", {
      responseValidation: "warn",
      onResponseContractViolation: onViolation,
    });

    expect(result).toBe(payload);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({
      endpoint: "GET /x",
      issues: [expect.objectContaining({ path: "url", code: "invalid_type" })],
    });
  });

  it("REQ-TC-2: the default warn sink is one JSON line and never carries response values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      validateResponsePayload(
        schema,
        { url: ["secret-customer-value"] },
        "GET /x",
        { responseValidation: "warn" },
      );
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).not.toContain("secret-customer-value");
      expect(JSON.parse(line)).toMatchObject({
        level: "warn",
        tag: "response-contract",
        endpoint: "GET /x",
      });
    } finally {
      warn.mockRestore();
    }
  });
});
