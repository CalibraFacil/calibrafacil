import { describe, expect, it } from "vitest";

import {
  assertAssetBelongsToVisitCustomer,
  canAddJobToVisit,
  resolveVisitJobRemoval,
} from "../visit-jobs";

// =============================================================================
// canAddJobToVisit — REQ-VISITJOB-003
// =============================================================================

describe("canAddJobToVisit", () => {
  it("REQ-VISITJOB-003: allows adding when visit is PROPOSED", () => {
    const result = canAddJobToVisit({ status: "PROPOSED", customerId: 1 });
    expect(result.ok).toBe(true);
  });

  it("REQ-VISITJOB-003: rejects with 409 when visit is CONFIRMED (not PROPOSED)", () => {
    const result = canAddJobToVisit({ status: "CONFIRMED", customerId: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("REQ-VISITJOB-003: rejects with 409 when visit is CANCELLED", () => {
    const result = canAddJobToVisit({ status: "CANCELLED", customerId: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("REQ-VISITJOB-003: rejects with 409 when visit is COMPLETED", () => {
    const result = canAddJobToVisit({ status: "COMPLETED", customerId: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("REQ-VISITJOB-003: rejects with 409 when visit is IN_PROGRESS", () => {
    const result = canAddJobToVisit({ status: "IN_PROGRESS", customerId: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });
});

// =============================================================================
// assertAssetBelongsToVisitCustomer — REQ-VISITJOB-004
// =============================================================================

describe("assertAssetBelongsToVisitCustomer", () => {
  it("REQ-VISITJOB-004: allows when asset customerId matches visit customerId", () => {
    const result = assertAssetBelongsToVisitCustomer(
      { customerId: 42 },
      { status: "PROPOSED", customerId: 42 },
    );
    expect(result.ok).toBe(true);
  });

  it("REQ-VISITJOB-004: rejects with 400 when asset customerId differs from visit customerId", () => {
    const result = assertAssetBelongsToVisitCustomer(
      { customerId: 99 },
      { status: "PROPOSED", customerId: 42 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.body).toContain("Ativo nao pertence ao cliente da visita");
    }
  });
});

// =============================================================================
// resolveVisitJobRemoval — REQ-VISITJOB-006,007,008,009
// =============================================================================

describe("resolveVisitJobRemoval", () => {
  const draftJob = { status: "DRAFT" as const, visitId: 5 };

  it("REQ-VISITJOB-006: returns ok:true for PROPOSED+DRAFT job matching visit", () => {
    const result = resolveVisitJobRemoval({
      visitStatus: "PROPOSED",
      job: draftJob,
      visitId: 5,
    });
    expect(result.ok).toBe(true);
  });

  it("REQ-VISITJOB-007: rejects with 409 when job is not DRAFT (e.g. IN_PROGRESS)", () => {
    const result = resolveVisitJobRemoval({
      visitStatus: "PROPOSED",
      job: { status: "IN_PROGRESS" as const, visitId: 5 },
      visitId: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("REQ-VISITJOB-007: rejects with 409 when job is APPROVED", () => {
    const result = resolveVisitJobRemoval({
      visitStatus: "PROPOSED",
      job: { status: "APPROVED" as const, visitId: 5 },
      visitId: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("REQ-VISITJOB-008: rejects with 409 when visit is not PROPOSED (e.g. CONFIRMED)", () => {
    const result = resolveVisitJobRemoval({
      visitStatus: "CONFIRMED",
      job: draftJob,
      visitId: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("REQ-VISITJOB-008: rejects with 409 when visit is CANCELLED", () => {
    const result = resolveVisitJobRemoval({
      visitStatus: "CANCELLED",
      job: draftJob,
      visitId: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
    }
  });

  it("REQ-VISITJOB-009: rejects with 404 when job is null (not found)", () => {
    const result = resolveVisitJobRemoval({
      visitStatus: "PROPOSED",
      job: null,
      visitId: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it("REQ-VISITJOB-009: rejects with 404 when job.visitId does not match :id", () => {
    const result = resolveVisitJobRemoval({
      visitStatus: "PROPOSED",
      job: { status: "DRAFT" as const, visitId: 99 },
      visitId: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});
