import { describe, expect, it } from "vitest";
import { intervalOf, judgeCrons } from "./health-alerts";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const ENTRIES = [
  { path: "/api/cron/queue-backstop", schedule: "*/30 * * * *" },
  { path: "/api/cron/certificate-drift", schedule: "0 6 * * *" },
  { path: "/api/cron/records-purge", schedule: "0 5 * * 0" },
];

function ago(minutes: number) {
  return new Date(NOW.getTime() - minutes * 60_000);
}

describe("health alerts (roadmap 2 G2)", () => {
  it("reads a schedule's interval from its next two runs", () => {
    expect(intervalOf("*/30 * * * *", NOW)).toBe(30 * 60_000);
    expect(intervalOf("0 6 * * *", NOW)).toBe(24 * 60 * 60_000);
    expect(intervalOf("0 5 * * 0", NOW)).toBe(7 * 24 * 60 * 60_000);
  });

  it("flags a job whose last success is older than twice its interval plus ten minutes", () => {
    const { stale } = judgeCrons(
      [
        // every 30 min: 70 min ago is the limit
        {
          job: "queue-backstop",
          lastSuccessAt: ago(71),
          lastRunAt: ago(1),
          consecutiveFailures: 0,
        },
        // daily: 47 h ago is fine
        {
          job: "certificate-drift",
          lastSuccessAt: ago(47 * 60),
          lastRunAt: ago(47 * 60),
          consecutiveFailures: 0,
        },
      ],
      ENTRIES,
      NOW,
    );
    expect(stale).toEqual(["queue-backstop"]);
  });

  it("flags three failures in a row, and judges nothing for a job that never ran", () => {
    const { stale, failing } = judgeCrons(
      [
        {
          job: "certificate-drift",
          lastSuccessAt: ago(60),
          lastRunAt: ago(5),
          consecutiveFailures: 3,
        },
        {
          job: "records-purge",
          lastSuccessAt: null,
          lastRunAt: null,
          consecutiveFailures: 0,
        },
      ],
      ENTRIES,
      NOW,
    );
    expect(failing).toEqual(["certificate-drift"]);
    expect(stale).toEqual([]);
  });

  it("a job that ran but never succeeded is judged from its first run", () => {
    const { stale } = judgeCrons(
      [
        {
          job: "queue-backstop",
          lastSuccessAt: null,
          lastRunAt: ago(90),
          consecutiveFailures: 1,
        },
      ],
      ENTRIES,
      NOW,
    );
    expect(stale).toEqual(["queue-backstop"]);
  });
});
