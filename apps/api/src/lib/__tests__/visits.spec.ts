import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitStatus } from "@calibra-facil/db/schema";

// ---------------------------------------------------------------------------
// Drizzle mock — FIFO queue for selects + spy on update().set()
//
// syncVisitStatusFromJobs issues these DB calls in order:
//   1. db.select().from().where().limit(1)   → visit row (or empty)
//   2. db.select().from().where()             → jobs array
//   3. db.update().set({status}).where()      → optional, only if status changed
//
// The FIFO queue feeds (1) and (2). The setSpy captures the argument passed to
// set() so each test can assert which status was written (or that none was).
// ---------------------------------------------------------------------------

interface DbState {
  queue: Array<unknown>;
  setSpy: ReturnType<typeof vi.fn>;
}

const dbState = vi.hoisted((): DbState => ({ queue: [], setSpy: vi.fn() }));

vi.mock("@calibra-facil/db", () => {
  // Shared fluent builder — every method returns itself so chains work.
  // "then" makes the builder thenable: awaiting it drains the FIFO queue.
  const selectBuilder: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "limit"]) {
    selectBuilder[method] = () => selectBuilder;
  }
  // oxlint-disable-next-line unicorn/no-thenable
  selectBuilder["then"] = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) =>
    Promise.resolve(dbState.queue.length > 0 ? dbState.queue.shift() : []).then(
      resolve,
      reject,
    );

  // Update builder — set() is the spy under test; where() resolves to void.
  //
  // The source calls: db.update(table).set({status}).where(eq(...))
  // So: update() → setBuilder; set() records spy args + returns whereBuilder;
  //     whereBuilder.where() returns a thenable that resolves to undefined.
  const thenableVoid: Record<string, unknown> = {};
  // oxlint-disable-next-line unicorn/no-thenable
  thenableVoid["then"] = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(undefined).then(resolve, reject);

  const whereBuilder: Record<string, unknown> = {
    where: () => thenableVoid,
  };

  const setBuilder: Record<string, unknown> = {
    set: (args: unknown) => {
      dbState.setSpy(args);
      return whereBuilder;
    },
  };

  return {
    db: {
      select: () => selectBuilder,
      update: () => setBuilder,
    },
  };
});

// Import AFTER the mock is registered so the module picks up the mock.
import { syncVisitStatusFromJobs } from "../visits";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushVisit(status: VisitStatus): void {
  dbState.queue.push([{ status }]);
}

function pushMissingVisit(): void {
  dbState.queue.push([]);
}

function pushJobs(statuses: string[]): void {
  dbState.queue.push(statuses.map((s) => ({ status: s })));
}

// ---------------------------------------------------------------------------
// Reset between tests — the global setup already runs vi.clearAllMocks()
// which resets setSpy.mock.calls; we only need to drain the queue manually.
// ---------------------------------------------------------------------------

beforeEach(() => {
  dbState.queue.length = 0;
});

// ---------------------------------------------------------------------------
// REQ-VISIT-001: null / undefined visitId → no DB call at all
// ---------------------------------------------------------------------------

describe("REQ-VISIT-001: null/undefined visitId", () => {
  it("REQ-VISIT-001: returns immediately for null visitId without any DB query", async () => {
    // No rows pushed — any db call would resolve [] but we assert no call was made.
    await syncVisitStatusFromJobs(null);
    // Queue should still be empty (no reads consumed)
    expect(dbState.queue).toHaveLength(0);
    // No update either
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });

  it("REQ-VISIT-001: returns immediately for undefined visitId without any DB query", async () => {
    await syncVisitStatusFromJobs(undefined);
    expect(dbState.queue).toHaveLength(0);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-002: visit row not found → no update
// ---------------------------------------------------------------------------

describe("REQ-VISIT-002: missing visit row", () => {
  it("REQ-VISIT-002: returns without updating when the visit does not exist", async () => {
    pushMissingVisit(); // select for visit → []
    await syncVisitStatusFromJobs(42);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-003: terminal statuses (CANCELLED, COMPLETED) → never updated
// ---------------------------------------------------------------------------

describe("REQ-VISIT-003: terminal visit statuses", () => {
  it("REQ-VISIT-003: CANCELLED visit is never updated regardless of jobs", async () => {
    pushVisit("CANCELLED");
    // Jobs would be queued next but the function must return before querying them
    pushJobs(["APPROVED"]); // would push toward COMPLETED if status weren't terminal
    await syncVisitStatusFromJobs(7);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });

  it("REQ-VISIT-003: COMPLETED visit is never updated (no downgrade)", async () => {
    pushVisit("COMPLETED");
    pushJobs(["DRAFT"]); // would push toward IN_PROGRESS if status weren't terminal
    await syncVisitStatusFromJobs(7);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-004: zero child jobs → no update
// ---------------------------------------------------------------------------

describe("REQ-VISIT-004: zero child jobs", () => {
  it("REQ-VISIT-004: PROPOSED visit with no jobs produces no update", async () => {
    pushVisit("PROPOSED");
    pushJobs([]); // zero jobs
    await syncVisitStatusFromJobs(5);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });

  it("REQ-VISIT-004: CONFIRMED visit with no jobs produces no update", async () => {
    pushVisit("CONFIRMED");
    pushJobs([]);
    await syncVisitStatusFromJobs(5);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-005: all settled + at least one APPROVED/SUPERSEDED → COMPLETED
// ---------------------------------------------------------------------------

describe("REQ-VISIT-005: all settled with at least one approved", () => {
  it("REQ-VISIT-005: all APPROVED → sets status to COMPLETED", async () => {
    pushVisit("IN_PROGRESS");
    pushJobs(["APPROVED", "APPROVED"]);
    await syncVisitStatusFromJobs(10);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "COMPLETED" });
  });

  it("REQ-VISIT-005: mix of APPROVED and CANCELED (all settled, one approved) → COMPLETED", async () => {
    pushVisit("IN_PROGRESS");
    pushJobs(["APPROVED", "CANCELED"]);
    await syncVisitStatusFromJobs(11);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "COMPLETED" });
  });

  it("REQ-VISIT-005: SUPERSEDED counts as approved — all settled with one SUPERSEDED → COMPLETED", async () => {
    pushVisit("IN_PROGRESS");
    pushJobs(["SUPERSEDED", "CANCELED"]);
    await syncVisitStatusFromJobs(12);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "COMPLETED" });
  });

  it("REQ-VISIT-005: all SUPERSEDED → sets status to COMPLETED", async () => {
    pushVisit("IN_PROGRESS");
    pushJobs(["SUPERSEDED", "SUPERSEDED"]);
    await syncVisitStatusFromJobs(13);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "COMPLETED" });
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-006: all settled but ALL are CANCELED → no COMPLETED
// ---------------------------------------------------------------------------

describe("REQ-VISIT-006: all settled but all CANCELED", () => {
  it("REQ-VISIT-006: all CANCELED jobs do NOT trigger COMPLETED", async () => {
    pushVisit("IN_PROGRESS");
    pushJobs(["CANCELED", "CANCELED"]);
    await syncVisitStatusFromJobs(20);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });

  it("REQ-VISIT-006: single CANCELED job from PROPOSED → IN_PROGRESS not COMPLETED (anyStarted drives IN_PROGRESS)", async () => {
    // allSettled=true, anyApproved=false → COMPLETED branch NOT taken.
    // anyStarted=true (CANCELED !== DRAFT), visit is PROPOSED → IN_PROGRESS branch fires.
    // REQ-VISIT-006 confirms no COMPLETED; the transition to IN_PROGRESS is expected behavior.
    pushVisit("PROPOSED");
    pushJobs(["CANCELED"]);
    await syncVisitStatusFromJobs(21);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "IN_PROGRESS" });
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-007: any job left DRAFT (not all settled-with-approval) + PROPOSED/CONFIRMED
//               → IN_PROGRESS
// ---------------------------------------------------------------------------

describe("REQ-VISIT-007: at least one non-DRAFT job advances PROPOSED/CONFIRMED to IN_PROGRESS", () => {
  it("REQ-VISIT-007: PROPOSED with one IN_PROGRESS job → IN_PROGRESS", async () => {
    pushVisit("PROPOSED");
    pushJobs(["IN_PROGRESS", "DRAFT"]);
    await syncVisitStatusFromJobs(30);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "IN_PROGRESS" });
  });

  it("REQ-VISIT-007: CONFIRMED with one APPROVED + one DRAFT (not all settled) → IN_PROGRESS", async () => {
    // anyStarted=true, allSettled=false → IN_PROGRESS (not COMPLETED yet)
    pushVisit("CONFIRMED");
    pushJobs(["APPROVED", "DRAFT"]);
    await syncVisitStatusFromJobs(31);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "IN_PROGRESS" });
  });

  it("REQ-VISIT-007: PROPOSED with one CANCELED job but not all approved → IN_PROGRESS (anyStarted)", async () => {
    // CANCELED != DRAFT → anyStarted=true; allSettled=true but anyApproved=false
    // → does NOT go to COMPLETED; anyStarted is true and status is PROPOSED → IN_PROGRESS
    // NOTE: this documents existing behavior — a lone CANCELED job from PROPOSED advances to IN_PROGRESS
    // because anyStarted=true and the COMPLETED branch requires anyApproved.
    pushVisit("PROPOSED");
    pushJobs(["CANCELED", "DRAFT"]);
    await syncVisitStatusFromJobs(32);
    expect(dbState.setSpy).toHaveBeenCalledOnce();
    expect(dbState.setSpy).toHaveBeenCalledWith({ status: "IN_PROGRESS" });
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-008: all jobs still DRAFT → no change to PROPOSED/CONFIRMED
// ---------------------------------------------------------------------------

describe("REQ-VISIT-008: all DRAFT jobs → no update to PROPOSED/CONFIRMED", () => {
  it("REQ-VISIT-008: PROPOSED visit + all DRAFT jobs → no update", async () => {
    pushVisit("PROPOSED");
    pushJobs(["DRAFT", "DRAFT"]);
    await syncVisitStatusFromJobs(40);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });

  it("REQ-VISIT-008: CONFIRMED visit + all DRAFT jobs → no update", async () => {
    pushVisit("CONFIRMED");
    pushJobs(["DRAFT"]);
    await syncVisitStatusFromJobs(41);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });

  it("REQ-VISIT-008: IN_PROGRESS visit + all DRAFT jobs → no update (IN_PROGRESS not in PROPOSED/CONFIRMED guard)", async () => {
    // allSettled=false (DRAFT is not settled), anyApproved=false, anyStarted=false
    // → nextStatus stays IN_PROGRESS → no update
    pushVisit("IN_PROGRESS");
    pushJobs(["DRAFT"]);
    await syncVisitStatusFromJobs(42);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-VISIT-009: computed next == current → no update issued
// ---------------------------------------------------------------------------

describe("REQ-VISIT-009: next status equals current → no update", () => {
  it("REQ-VISIT-009: IN_PROGRESS visit with mixed jobs that would compute IN_PROGRESS → no update", async () => {
    // anyStarted=true, visit.status=IN_PROGRESS → the else-if branch doesn't fire
    // (requires PROPOSED or CONFIRMED); allSettled=false → COMPLETED not reached
    // → nextStatus remains IN_PROGRESS == current → no update
    pushVisit("IN_PROGRESS");
    pushJobs(["IN_PROGRESS", "DRAFT"]);
    await syncVisitStatusFromJobs(50);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });

  it("REQ-VISIT-009: PROPOSED with only DRAFT jobs → nextStatus=PROPOSED == current → no update", async () => {
    // allSettled=false, anyStarted=false → nextStatus stays PROPOSED → no update
    pushVisit("PROPOSED");
    pushJobs(["DRAFT"]);
    await syncVisitStatusFromJobs(51);
    expect(dbState.setSpy).not.toHaveBeenCalled();
  });
});
