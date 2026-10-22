import { describe, expect, it } from "vitest";
import type { z } from "zod";

import * as fixtures from "./jobs.fixtures";
import {
  jobAmendResponseSchema,
  jobDetailSchema,
  jobDownloadUrlResponseSchema,
  jobExecutionWarningSchema,
  jobMethodSnapshotSchema,
  jobMutationResponseSchema,
  jobRowSchema,
  jobsListResponseSchema,
} from "./jobs";
import { portalOverviewResponseSchema } from "./portal";

/**
 * Every builder the shared fixtures module exports, with the response schema
 * its payload must satisfy. Adding a builder without a row here fails the
 * "no unregistered fixture" test, so a fixture cannot escape the check.
 */
const registry = {
  buildJobRow: [fixtures.buildJobRow, jobRowSchema],
  buildJobMutationResponse: [
    fixtures.buildJobMutationResponse,
    jobMutationResponseSchema,
  ],
  buildJobExecutionWarning: [
    fixtures.buildJobExecutionWarning,
    jobExecutionWarningSchema,
  ],
  buildJobDetail: [fixtures.buildJobDetail, jobDetailSchema],
  buildJobsList: [fixtures.buildJobsList, jobsListResponseSchema],
  buildJobAmendResponse: [
    fixtures.buildJobAmendResponse,
    jobAmendResponseSchema,
  ],
  buildSimpleMethodSnapshot: [
    fixtures.buildSimpleMethodSnapshot,
    jobMethodSnapshotSchema,
  ],
  buildExecutableJobDetail: [
    fixtures.buildExecutableJobDetail,
    jobDetailSchema,
  ],
  buildApprovedJobDetail: [fixtures.buildApprovedJobDetail, jobDetailSchema],
  buildJobDownloadUrlResponse: [
    fixtures.buildJobDownloadUrlResponse,
    jobDownloadUrlResponseSchema,
  ],
  buildPortalOverview: [
    fixtures.buildPortalOverview,
    portalOverviewResponseSchema,
  ],
} satisfies Record<string, readonly [() => unknown, z.ZodType]>;

describe("shared contract fixtures", () => {
  it("REQ-E2E-3: every exported fixture builder is registered with its schema", () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(registry).sort());
  });

  for (const [name, [build, schema]] of Object.entries(registry)) {
    it(`REQ-E2E-3: ${name}() parses with its response schema`, () => {
      const result = schema.safeParse(build());
      expect(
        result.success ? [] : result.error.issues,
        `${name} drifted from its schema`,
      ).toEqual([]);
    });
  }

  it("REQ-E2E-3: an overridden fixture still satisfies the schema it is served under", () => {
    expect(
      jobDetailSchema.safeParse(
        fixtures.buildExecutableJobDetail({ status: "REVIEW", data: null }),
      ).success,
    ).toBe(true);
    expect(
      jobMutationResponseSchema.safeParse(
        fixtures.buildJobMutationResponse({ status: "REVIEW" }, "Enviado"),
      ).success,
    ).toBe(true);
    expect(
      jobMutationResponseSchema.safeParse(
        fixtures.buildJobMutationResponse({}, "Salvo", [
          fixtures.buildJobExecutionWarning(),
        ]),
      ).success,
    ).toBe(true);
    expect(
      portalOverviewResponseSchema.safeParse(
        fixtures.buildPortalOverview({
          certificates: { available: 0, recent: [] },
        }),
      ).success,
    ).toBe(true);
  });
});
