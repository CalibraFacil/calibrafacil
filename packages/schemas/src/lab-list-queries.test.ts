import { describe, expect, it } from "vitest";
import {
  ListCalibrationRequestsQuerySchema,
  ListJobsQuerySchema,
  ListNonConformancesQuerySchema,
  ListVisitsQuerySchema,
} from "./index";
import { ListServiceOrdersQuerySchema } from "./service-orders";

// The lab lists once took `dateFrom` / `dateTo` as instants (UTC midnight, so
// the last day was cut off) and nothing called them. A lab day filter, when one
// is needed, goes through the lab-day helpers; until then the parameter does
// not exist, so an old caller cannot get an off-by-one-day answer.
describe("lab list queries carry no date range", () => {
  const withDates = { dateFrom: "2026-11-01", dateTo: "2026-11-08" };

  it.each([
    ["jobs", ListJobsQuerySchema],
    ["non-conformances", ListNonConformancesQuerySchema],
    ["visits", ListVisitsQuerySchema],
    ["calibration requests", ListCalibrationRequestsQuerySchema],
    ["service orders", ListServiceOrdersQuerySchema],
  ])("%s ignores dateFrom and dateTo", (_name, schema) => {
    const parsed = schema.parse(withDates);
    expect(parsed).not.toHaveProperty("dateFrom");
    expect(parsed).not.toHaveProperty("dateTo");
  });
});
