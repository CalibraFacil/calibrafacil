import { describe, expect, it } from "vitest";

import {
  judgeDraftExecutionStandards,
  judgeExecutionStandards,
  type JudgedStandardFacts,
} from "./standards-judgement";
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

describe("judgeDraftExecutionStandards: a draft save keeps a standard already in the saved snapshot (REQ-P111-1, REQ-P111-2)", () => {
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
  const expired: JudgedStandardFacts = {
    ...live,
    id: 2,
    name: "Massa Vencida",
    nextCalibrationDate: "2020-01-01",
  };
  const inactive: JudgedStandardFacts = {
    ...live,
    id: 3,
    name: "Massa Inativa",
    status: "INACTIVE",
  };
  const deleted: JudgedStandardFacts = {
    ...live,
    id: 4,
    name: "Massa Excluida",
    deletedAt: "2026-10-01",
  };
  const facts = [live, expired, inactive, deleted];

  it("REQ-P111-1: a standard NOT in the saved snapshot that is expired, inactive or deleted is refused with the code the judgement always gave", () => {
    for (const [fact, code] of [
      [expired, "standard_expired"],
      [inactive, "standard_inactive"],
      [deleted, "standard_deleted"],
    ] as const) {
      const result = judgeDraftExecutionStandards(
        { ...base, standardIds: [1, fact.id], savedStandardIds: [1] },
        facts,
      );
      expect(result).toEqual({
        ok: false,
        code,
        standardIds: [fact.id],
        standardNames: [fact.name],
      });
    }
  });

  it("REQ-P111-1: with an empty saved snapshot the draft judgement refuses exactly as the strict one", () => {
    const input = {
      ...base,
      standardIds: [2, 3],
      requireBackdateReason: false,
    };
    const strict = judgeExecutionStandards(input, facts);
    const draft = judgeDraftExecutionStandards(
      { ...input, savedStandardIds: [] },
      facts,
    );
    expect(draft).toEqual(strict);
  });

  it("REQ-P111-1: a standard that is not found stays refused even when the saved snapshot named it", () => {
    const result = judgeDraftExecutionStandards(
      { ...base, standardIds: [1, 9], savedStandardIds: [1, 9] },
      facts,
    );
    expect(result).toEqual({
      ok: false,
      code: "standard_not_found",
      standardIds: [9],
      standardNames: [],
    });
  });

  it("REQ-P111-1: a new invalid standard refuses the save even when a carried one also warns", () => {
    const result = judgeDraftExecutionStandards(
      { ...base, standardIds: [2, 3], savedStandardIds: [2] },
      facts,
    );
    expect(result).toMatchObject({
      ok: false,
      code: "standard_inactive",
      standardIds: [3],
    });
  });

  it("REQ-P111-2: standards already in the saved snapshot that became expired, inactive or deleted are accepted with one structured warning per reason", () => {
    const result = judgeDraftExecutionStandards(
      { ...base, standardIds: [1, 2, 3, 4], savedStandardIds: [1, 2, 3, 4] },
      facts,
    );
    // Only the standard judged valid is listed as judged; the stale ones are
    // reported under `warnings` and nowhere else.
    expect(result).toMatchObject({ ok: true, standardIds: [1] });
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings).toEqual([
      {
        code: "standard_no_longer_valid",
        reason: "standard_deleted",
        standardIds: [4],
        standardNames: ["Massa Excluida"],
      },
      {
        code: "standard_no_longer_valid",
        reason: "standard_inactive",
        standardIds: [3],
        standardNames: ["Massa Inativa"],
      },
      {
        code: "standard_no_longer_valid",
        reason: "standard_expired",
        standardIds: [2],
        standardNames: ["Massa Vencida"],
      },
    ]);
  });

  it("REQ-P111-2: a draft whose standards are all valid carries no warning", () => {
    const result = judgeDraftExecutionStandards(
      { ...base, standardIds: [1], savedStandardIds: [1] },
      facts,
    );
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it("REQ-P111-2: a carried standard that is valid only because the work is back-dated needs no reason on a draft and does not warn", () => {
    const result = judgeDraftExecutionStandards(
      {
        ...base,
        standardIds: [1],
        savedStandardIds: [1],
        performedAt: new Date("2026-09-01T15:00:00.000Z"),
      },
      [{ ...live, nextCalibrationDate: "2026-09-30" }],
    );
    expect(result).toMatchObject({
      ok: true,
      warnings: [],
      reasonRequired: true,
    });
  });
});

describe("judgement by the certificate valid on the day of the work (roadmap 2 C3)", () => {
  // Two certificates: [2026-01-10, 2026-06-30] and, after a renewal,
  // [2026-07-01, 2027-06-30]. Today is 2026-10-21 (JUDGEMENT_TODAY).
  const renewed: JudgedStandardFacts = {
    id: 7,
    name: "Massa E2",
    status: "ACTIVE",
    deletedAt: null,
    nextCalibrationDate: "2027-06-30",
    inScope: true,
    calibrations: [
      { calibrationDate: "2026-01-10", nextCalibrationDate: "2026-06-30" },
      { calibrationDate: "2026-07-01", nextCalibrationDate: "2027-06-30" },
    ],
  };
  const judge = (performedAt: string, facts: JudgedStandardFacts) =>
    judgeExecutionStandards(
      {
        standardIds: [facts.id],
        performedAt: new Date(performedAt),
        today: JUDGEMENT_TODAY,
        mode: "cloud",
        backdateReason: "Registro feito depois da execução",
      },
      [facts],
    );

  it("work done under the earlier certificate is valid (it covered that day)", () => {
    expect(judge("2026-03-02T15:00:00.000Z", renewed)).toMatchObject({
      ok: true,
    });
  });

  it("work done before the first calibration is not made valid by a later certificate", () => {
    expect(judge("2025-12-01T15:00:00.000Z", renewed)).toMatchObject({
      ok: false,
      code: "standard_expired",
    });
    // Without the history, the current certificate alone would have passed it.
    expect(
      judge("2025-12-01T15:00:00.000Z", {
        ...renewed,
        calibrations: undefined,
      }),
    ).toMatchObject({ ok: true });
  });

  it("a gap between two certificates is not covered", () => {
    const withGap: JudgedStandardFacts = {
      ...renewed,
      calibrations: [
        { calibrationDate: "2026-01-10", nextCalibrationDate: "2026-05-31" },
        { calibrationDate: "2026-07-01", nextCalibrationDate: "2027-06-30" },
      ],
    };
    expect(judge("2026-06-15T15:00:00.000Z", withGap)).toMatchObject({
      ok: false,
      code: "standard_expired",
    });
  });
});

describe("certificates carried over by the history backfill (roadmap 2 C3)", () => {
  it("bound work only by their last valid day (an earlier, overwritten certificate may have covered it)", () => {
    const backfilled: JudgedStandardFacts = {
      id: 9,
      name: "Termômetro",
      status: "ACTIVE",
      deletedAt: null,
      nextCalibrationDate: "2027-06-30",
      inScope: true,
      calibrations: [
        { calibrationDate: null, nextCalibrationDate: "2027-06-30" },
      ],
    };
    expect(
      judgeExecutionStandards(
        {
          standardIds: [9],
          performedAt: new Date("2025-12-01T15:00:00.000Z"),
          today: JUDGEMENT_TODAY,
          mode: "cloud",
          backdateReason: "Registro tardio",
        },
        [backfilled],
      ),
    ).toMatchObject({ ok: true });
  });
});
