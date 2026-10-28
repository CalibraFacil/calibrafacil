import { describe, expect, it } from "vitest";
import { JobStatusSchema, type JobStatus } from "./index";
import {
  JOB_COMMANDS,
  JOB_TRANSITIONS,
  allowedFrom,
  canTransition,
  requireTargetOf,
  targetOf,
  type JobCommand,
} from "./job-transitions";

const STATUSES: readonly JobStatus[] = JobStatusSchema.options;

/**
 * The documented machine, written out independently of the module under test:
 * every command with the exact `from -> to` pairs it performs today. A change
 * to JOB_TRANSITIONS that is not a deliberate change to this table fails.
 */
const DOCUMENTED_MACHINE: Record<
  JobCommand,
  ReadonlyArray<readonly [JobStatus | null, JobStatus]>
> = {
  create: [[null, "DRAFT"]],
  execute: [
    ["DRAFT", "IN_PROGRESS"],
    ["IN_PROGRESS", "IN_PROGRESS"],
    ["REJECTED", "REJECTED"],
  ],
  submit: [
    ["DRAFT", "REVIEW"],
    ["IN_PROGRESS", "REVIEW"],
    ["REJECTED", "REVIEW"],
  ],
  reject: [
    ["REVIEW", "REJECTED"],
    ["RENDER_FAILED", "REJECTED"],
  ],
  approve: [["REVIEW", "GENERATING_PDF"]],
  complete_render: [
    ["GENERATING_PDF", "APPROVED"],
    ["SUPERSEDED", "SUPERSEDED"],
  ],
  fail_render: [["GENERATING_PDF", "RENDER_FAILED"]],
  retry_render: [["RENDER_FAILED", "GENERATING_PDF"]],
  revert_approval: [["GENERATING_PDF", "REVIEW"]],
  cancel: [
    ["DRAFT", "CANCELED"],
    ["IN_PROGRESS", "CANCELED"],
    ["REVIEW", "CANCELED"],
    ["REJECTED", "CANCELED"],
  ],
  amend: [["APPROVED", "SUPERSEDED"]],
  edit: [
    ["DRAFT", "DRAFT"],
    ["IN_PROGRESS", "IN_PROGRESS"],
    ["REVIEW", "REVIEW"],
    ["REJECTED", "REJECTED"],
    ["GENERATING_PDF", "GENERATING_PDF"],
  ],
  assign: [
    ["DRAFT", "DRAFT"],
    ["IN_PROGRESS", "IN_PROGRESS"],
    ["REVIEW", "REVIEW"],
    ["REJECTED", "REJECTED"],
  ],
};

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "SUPERSEDED",
  "CANCELED",
]);

function expectedTarget(
  from: JobStatus,
  command: JobCommand,
): JobStatus | undefined {
  return DOCUMENTED_MACHINE[command].find(([f]) => f === from)?.[1];
}

describe("job transition table", () => {
  it("REQ-TR-1: lists every transition of the documented machine, no more and no less", () => {
    const documented = Object.entries(DOCUMENTED_MACHINE)
      .flatMap(([command, pairs]) =>
        pairs.map(([from, to]) => `${command}:${from ?? "-"}>${to}`),
      )
      .toSorted();
    const actual = JOB_TRANSITIONS.map(
      (t) => `${t.command}:${t.from ?? "-"}>${t.to}`,
    ).toSorted();

    expect(actual).toEqual(documented);
  });

  it("REQ-TR-1: has at most one target per (from, command)", () => {
    const keys = JOB_TRANSITIONS.map((t) => `${t.from ?? "-"}|${t.command}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("REQ-TR-1: every command is declared and has at least one transition", () => {
    expect([...JOB_COMMANDS].toSorted()).toEqual(
      Object.keys(DOCUMENTED_MACHINE).toSorted(),
    );
    for (const command of JOB_COMMANDS) {
      expect(
        JOB_TRANSITIONS.some((t) => t.command === command),
        `${command} has no transition`,
      ).toBe(true);
    }
  });

  it("REQ-TR-1: the table only mentions real statuses", () => {
    for (const { from, to } of JOB_TRANSITIONS) {
      expect(STATUSES).toContain(to);
      if (from !== null) expect(STATUSES).toContain(from);
    }
  });

  it("REQ-TR-1: allowedFrom lists the statuses a command may start from", () => {
    expect(allowedFrom("cancel")).toEqual([
      "DRAFT",
      "IN_PROGRESS",
      "REVIEW",
      "REJECTED",
    ]);
    expect(allowedFrom("approve")).toEqual(["REVIEW"]);
    expect(allowedFrom("amend")).toEqual(["APPROVED"]);
    // Q19: a technician is assigned only while the job is still open.
    expect(allowedFrom("assign")).toEqual([
      "DRAFT",
      "IN_PROGRESS",
      "REVIEW",
      "REJECTED",
    ]);
    expect(allowedFrom("create")).toEqual([]);
  });

  it("REQ-TR-1: targetOf resolves the destination or null", () => {
    expect(targetOf("DRAFT", "execute")).toBe("IN_PROGRESS");
    expect(targetOf("REJECTED", "execute")).toBe("REJECTED");
    expect(targetOf("GENERATING_PDF", "revert_approval")).toBe("REVIEW");
    expect(targetOf("APPROVED", "cancel")).toBeNull();
    expect(targetOf(null, "create")).toBe("DRAFT");
  });

  it("REQ-TR-1: requireTargetOf throws on an illegal transition", () => {
    expect(requireTargetOf("REVIEW", "approve")).toBe("GENERATING_PDF");
    expect(() => requireTargetOf("APPROVED", "approve")).toThrow(
      /approve from APPROVED/,
    );
  });

  it("REQ-TR-1: canTransition and targetOf accept any string and refuse an unknown status", () => {
    expect(canTransition("REVIEW", "approve")).toBe(true);
    expect(canTransition("NOT_A_STATUS", "approve")).toBe(false);
    expect(targetOf("NOT_A_STATUS", "approve")).toBeNull();
  });
});

describe("job transition table, exhaustive over statuses x commands", () => {
  for (const command of JOB_COMMANDS) {
    for (const status of STATUSES) {
      const target = expectedTarget(status, command);
      it(`REQ-TR-3: ${status} --${command}--> ${target ?? "(illegal)"}`, () => {
        expect(canTransition(status, command)).toBe(target !== undefined);
        expect(targetOf(status, command)).toBe(target ?? null);
        expect(allowedFrom(command).includes(status)).toBe(
          target !== undefined,
        );
      });
    }
  }
});

function reachableFromCreation(): Set<JobStatus> {
  const seen = new Set<JobStatus>();
  const queue: JobStatus[] = [];
  for (const t of JOB_TRANSITIONS) {
    if (t.from === null) queue.push(t.to);
  }
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    for (const t of JOB_TRANSITIONS) {
      if (t.from === next) queue.push(t.to);
    }
  }
  return seen;
}

describe("job state machine shape", () => {
  it("REQ-TR-3: creation lands only in DRAFT", () => {
    expect(
      JOB_TRANSITIONS.filter((t) => t.from === null).map((t) => t.to),
    ).toEqual(["DRAFT"]);
  });

  it("REQ-TR-3: every status is reachable from DRAFT", () => {
    const reachable = reachableFromCreation();
    for (const status of STATUSES) {
      expect(reachable.has(status), `${status} unreachable`).toBe(true);
    }
  });

  it("REQ-TR-3: every non-terminal status has an exit to another status", () => {
    for (const status of STATUSES) {
      const exits = JOB_TRANSITIONS.filter(
        (t) => t.from === status && t.to !== status,
      );
      if (TERMINAL_STATUSES.has(status)) {
        expect(exits, `${status} is terminal`).toEqual([]);
      } else {
        expect(exits.length, `${status} has no exit`).toBeGreaterThan(0);
      }
    }
  });
});
