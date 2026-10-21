import { describe, expect, it } from "vitest";

import {
  BACKDATE_REASON_THRESHOLD_DAYS,
  resolveExecutionPerformedAt,
} from "./index";

const NOW = new Date("2026-03-20T15:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

// The rules are the cloud's POST /jobs/:id/submit (apps/api/src/routes/jobs.ts):
// the date must parse, must not be in the future, and a reason is required once
// it is more than 7 whole days in the past.
describe("resolveExecutionPerformedAt", () => {
  it("uses the given instant", () => {
    const result = resolveExecutionPerformedAt({
      performedAt: daysAgo(2),
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      performedAt: new Date(daysAgo(2)),
      backdateDays: 2,
      backdateReason: null,
    });
  });

  it("defaults to now when no date is given", () => {
    const result = resolveExecutionPerformedAt({ now: NOW });

    expect(result).toMatchObject({ ok: true, backdateDays: 0 });
    expect(result.ok && result.performedAt.getTime()).toBe(NOW.getTime());
  });

  it("rejects an unparseable date", () => {
    expect(
      resolveExecutionPerformedAt({ performedAt: "ontem", now: NOW }),
    ).toEqual({
      ok: false,
      code: "invalid",
      message: "Data de execução inválida",
    });
  });

  it("rejects a date in the future", () => {
    expect(
      resolveExecutionPerformedAt({
        performedAt: new Date(NOW.getTime() + 1000).toISOString(),
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      code: "future",
      message: "A data de execução não pode estar no futuro",
    });
  });

  it("does not ask for a reason at exactly the threshold", () => {
    expect(BACKDATE_REASON_THRESHOLD_DAYS).toBe(7);
    expect(
      resolveExecutionPerformedAt({ performedAt: daysAgo(7), now: NOW }),
    ).toMatchObject({ ok: true, backdateDays: 7, backdateReason: null });
  });

  it("requires a reason beyond the threshold", () => {
    expect(
      resolveExecutionPerformedAt({
        performedAt: daysAgo(8),
        backdateReason: "   ",
        now: NOW,
      }),
    ).toEqual({
      ok: false,
      code: "reason_required",
      message: "Motivo obrigatório para lançamentos com mais de 7 dias",
      backdateDays: 8,
    });
  });

  it("returns the trimmed reason beyond the threshold", () => {
    expect(
      resolveExecutionPerformedAt({
        performedAt: daysAgo(30),
        backdateReason: "  Equipamento só chegou hoje  ",
        now: NOW,
      }),
    ).toMatchObject({
      ok: true,
      backdateDays: 30,
      backdateReason: "Equipamento só chegou hoje",
    });
  });
});
