import { describe, expect, it } from "vitest";

import { trainingRecordEndpoints } from "./training-records";
import {
  buildTrainingRecordListItem,
  buildTrainingRecordsListResponse,
} from "./training-records.fixtures";

describe("training-record endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      trainingRecordEndpoints.list.response.safeParse(
        buildTrainingRecordsListResponse(),
      ).success,
    ).toBe(true);
    expect(
      trainingRecordEndpoints.list.response.safeParse(
        buildTrainingRecordsListResponse([
          buildTrainingRecordListItem({ userId: null, passed: true }),
        ]),
      ).success,
    ).toBe(true);
  });
});
