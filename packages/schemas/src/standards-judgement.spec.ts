import { describe, expect, it } from "vitest";

import { judgeExecutionStandards, type JudgedStandardFacts } from "./index";
import {
  JUDGEMENT_TODAY,
  STANDARDS_JUDGEMENT_FIXTURES,
  fixtureJudgementInput,
  fixtureStandardIds,
  summarizeJudgement,
  type StandardsJudgementFixture,
} from "./standards-judgement.fixtures";

/** The fixture's standards as a store would have loaded them. */
function factsFor(fixture: StandardsJudgementFixture) {
  const ids = fixtureStandardIds(fixture);
  const facts: JudgedStandardFacts[] = [];
  for (const standard of fixture.standards) {
    if (standard.world === "absent") continue;
    facts.push({
      id: ids.get(standard.key) ?? 0,
      name: standard.key,
      status: standard.status ?? "ACTIVE",
      deletedAt: standard.deleted ? new Date("2026-10-01T00:00:00Z") : null,
      nextCalibrationDate: standard.nextCalibrationDate,
      inScope: standard.world !== "other_org",
    });
  }
  return facts;
}

describe("judgeExecutionStandards: the fixture table (REQ-SJ-1, REQ-SJ-2, REQ-SJ-4)", () => {
  it("REQ-SJ-4: the table has at least 15 cases", () => {
    expect(STANDARDS_JUDGEMENT_FIXTURES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(
    STANDARDS_JUDGEMENT_FIXTURES.map((fixture) => [fixture.name, fixture]),
  )("REQ-SJ-1: %s", (_name, fixture) => {
    const result = judgeExecutionStandards(
      fixtureJudgementInput(fixture),
      factsFor(fixture),
    );

    expect(summarizeJudgement(fixture, result)).toEqual(fixture.expected);
    if (result.ok) {
      // The instant is exactly the performed date, or exactly today.
      expect(result.standardsJudgedAt).toEqual(
        fixture.expected.ok && fixture.expected.judgedAt === "today"
          ? JUDGEMENT_TODAY
          : new Date(fixture.performedAt ?? ""),
      );
    }
  });
});

describe("judgeExecutionStandards: details", () => {
  const base = {
    performedAt: new Date("2026-10-20T15:00:00.000Z"),
    today: JUDGEMENT_TODAY,
    mode: "cloud" as const,
  };
  const live: JudgedStandardFacts = {
    id: 1,
    name: "Massa Padrao",
    status: "ACTIVE",
    deletedAt: null,
    nextCalibrationDate: "2027-03-01",
    inScope: true,
  };

  it("REQ-SJ-1: duplicated ids are judged once", () => {
    const result = judgeExecutionStandards(
      { ...base, standardIds: [1, 1, 1] },
      [live],
    );
    expect(result).toMatchObject({ ok: true, standardIds: [1] });
  });

  it("REQ-SJ-1: a standard outside the scope never has its name disclosed", () => {
    const result = judgeExecutionStandards({ ...base, standardIds: [1] }, [
      { ...live, inScope: false },
    ]);
    expect(result).toEqual({
      ok: false,
      code: "standard_not_found",
      standardIds: [1],
      standardNames: [],
    });
  });

  it("REQ-SJ-2: not found outranks deleted, deleted outranks inactive, inactive outranks expired", () => {
    const expired = { ...live, nextCalibrationDate: "2020-01-01" };
    const inactive = { ...expired, id: 2, status: "INACTIVE" };
    const deleted = { ...inactive, id: 3, deletedAt: "2026-01-01" };
    const codeOf = (ids: number[], facts: JudgedStandardFacts[]) => {
      const result = judgeExecutionStandards(
        { ...base, standardIds: ids },
        facts,
      );
      return result.ok ? "ok" : result.code;
    };
    expect(codeOf([1, 2, 3, 4], [expired, inactive, deleted])).toBe(
      "standard_not_found",
    );
    expect(codeOf([1, 2, 3], [expired, inactive, deleted])).toBe(
      "standard_deleted",
    );
    expect(codeOf([1, 2], [expired, inactive])).toBe("standard_inactive");
    expect(codeOf([1], [expired])).toBe("standard_expired");
  });

  it("REQ-SJ-1: a public API judgement ignores the performed date and any reason", () => {
    const result = judgeExecutionStandards(
      {
        standardIds: [1],
        performedAt: new Date("2026-10-18T15:00:00.000Z"),
        today: JUDGEMENT_TODAY,
        backdateReason: "qualquer",
        mode: "public_api",
      },
      [{ ...live, nextCalibrationDate: "2026-10-18" }],
    );
    expect(result).toMatchObject({ ok: false, code: "standard_expired" });
  });
});
