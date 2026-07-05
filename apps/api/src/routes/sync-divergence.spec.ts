import { describe, expect, it } from "vitest";
import { detectStaleDesktopBase } from "./sync";

// REL-01 slice 2 — Docker-free boundary coverage of the optimistic-concurrency
// comparator that guards the three blind desktop applies. The end-to-end apply +
// DB proof lives in sync-divergence.int.spec.ts; this pins the millisecond ISO
// comparison rules the acceptance criteria hinge on.
//
//   REQ-REL-SYNC-201  server updatedAt STRICTLY after base  → diverged
//   REQ-REL-SYNC-202  base == server updatedAt              → apply (no conflict)
//   REQ-REL-SYNC-203  null / absent base                    → apply (legacy)

describe("detectStaleDesktopBase — millisecond ISO comparison", () => {
  it("REQ-REL-SYNC-201: server updatedAt strictly after base → diverged", () => {
    const result = detectStaleDesktopBase({
      baseUpdatedAt: "2026-06-01T00:00:00.000Z",
      serverUpdatedAt: new Date("2026-06-01T00:00:00.001Z"),
    });

    expect(result).toEqual({
      diverged: true,
      serverUpdatedAtIso: "2026-06-01T00:00:00.001Z",
      baseUpdatedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("REQ-REL-SYNC-202: base equal to server updatedAt (to the ms) → NOT diverged", () => {
    // Equal = unchanged since pull; a `>=` comparator would (wrongly) flag this.
    expect(
      detectStaleDesktopBase({
        baseUpdatedAt: "2026-06-01T12:30:00.000Z",
        serverUpdatedAt: new Date("2026-06-01T12:30:00.000Z"),
      }),
    ).toEqual({ diverged: false });
  });

  it("REQ-REL-SYNC-202: server updatedAt before base → NOT diverged", () => {
    expect(
      detectStaleDesktopBase({
        baseUpdatedAt: "2026-06-01T12:30:00.000Z",
        serverUpdatedAt: new Date("2026-05-01T12:30:00.000Z"),
      }),
    ).toEqual({ diverged: false });
  });

  it("REQ-REL-SYNC-203: null base → NOT diverged (legacy desktop)", () => {
    expect(
      detectStaleDesktopBase({
        baseUpdatedAt: null,
        serverUpdatedAt: new Date("2026-06-01T12:30:00.000Z"),
      }),
    ).toEqual({ diverged: false });
  });

  it("REQ-REL-SYNC-203: absent (undefined) base → NOT diverged (older build)", () => {
    expect(
      detectStaleDesktopBase({
        baseUpdatedAt: undefined,
        serverUpdatedAt: new Date("2026-06-01T12:30:00.000Z"),
      }),
    ).toEqual({ diverged: false });
  });

  it("unparseable base → NOT diverged (cannot check, apply as today)", () => {
    expect(
      detectStaleDesktopBase({
        baseUpdatedAt: "not-a-date",
        serverUpdatedAt: new Date("2026-06-01T12:30:00.000Z"),
      }),
    ).toEqual({ diverged: false });
  });

  it("accepts an ISO string server updatedAt (not only a Date)", () => {
    expect(
      detectStaleDesktopBase({
        baseUpdatedAt: "2026-06-01T00:00:00.000Z",
        serverUpdatedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toEqual({
      diverged: true,
      serverUpdatedAtIso: "2026-07-01T00:00:00.000Z",
      baseUpdatedAt: "2026-06-01T00:00:00.000Z",
    });
  });
});
