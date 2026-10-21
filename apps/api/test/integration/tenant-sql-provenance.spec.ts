import { describe, expect, it } from "vitest";
import { deriveTenantTables } from "./tenant-sql-analyzer";
import { deriveForeignKeys, ScopedRowTracker } from "./tenant-sql-provenance";

const { tenant } = deriveTenantTables();
const tracker = () => new ScopedRowTracker(deriveForeignKeys(), tenant);

const SCOPED_READ = `select "id" from "calibration_job" where ("calibration_job"."id" = $1 and "calibration_job"."organization_id" = $2) limit $3`;
const UNSCOPED_UPDATE = `update "calibration_job" set "status" = $1 where "calibration_job"."id" = $2`;

describe("ScopedRowTracker", () => {
  it("derives foreign keys from the schema", () => {
    expect(
      deriveForeignKeys().get("job_commercial_snapshot")?.get("job_id"),
    ).toBe("calibration_job");
  });

  it("covers a by-PK write whose id an org-scoped read just returned", () => {
    const t = tracker();
    t.record(SCOPED_READ, ["job-1", "org-1", 1], ["calibration_job"]);
    expect(t.covers(UNSCOPED_UPDATE, ["X", "job-1"], ["calibration_job"])).toBe(
      true,
    );
  });

  it("does not cover a by-PK write of an id never read through a scoped query", () => {
    const t = tracker();
    t.record(SCOPED_READ, ["job-1", "org-1", 1], ["calibration_job"]);
    expect(
      t.covers(UNSCOPED_UPDATE, ["X", "job-OTHER"], ["calibration_job"]),
    ).toBe(false);
  });

  it("does not carry a scoped read across tables", () => {
    const t = tracker();
    t.record(SCOPED_READ, ["job-1", "org-1", 1], ["calibration_job"]);
    expect(
      t.covers(
        `update "asset" set "name" = $1 where "asset"."id" = $2`,
        ["n", "job-1"],
        ["asset"],
      ),
    ).toBe(false);
  });

  it("covers children reached through a foreign key to a scoped parent", () => {
    const t = tracker();
    t.record(SCOPED_READ, ["job-1", "org-1", 1], ["calibration_job"]);
    expect(
      t.covers(
        `select "id" from "job_commercial_snapshot" where "job_commercial_snapshot"."job_id" = $1 limit $2`,
        ["job-1", 1],
        ["job_commercial_snapshot"],
      ),
    ).toBe(true);
  });

  it("forgets after reset", () => {
    const t = tracker();
    t.record(SCOPED_READ, ["job-1", "org-1", 1], ["calibration_job"]);
    t.reset();
    expect(t.covers(UNSCOPED_UPDATE, ["X", "job-1"], ["calibration_job"])).toBe(
      false,
    );
  });
});
