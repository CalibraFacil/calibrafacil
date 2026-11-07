import { describe, expect, it } from "vitest";
import {
  resolvePortalAmendmentInfo,
  type AmendmentChainJob,
  type AmendmentChainLoader,
} from "./certificate-amendment-chain";

function job(
  overrides: Partial<AmendmentChainJob> & { id: number },
): AmendmentChainJob {
  return {
    jobId: `CAL-2026-${String(overrides.id).padStart(4, "0")}`,
    status: "APPROVED",
    supersedesId: null,
    supersededById: null,
    amendmentNumber: null,
    amendmentReason: null,
    approvedAt: new Date("2026-06-01T12:00:00Z"),
    supersededAt: null,
    ...overrides,
  };
}

/**
 * Fake of `createPortalAmendmentChainLoader`: resolves from an in-memory set,
 * applying the same terminal-status gate the DB loader applies in SQL. Jobs
 * absent from the set stand in for other-tenant rows.
 */
function loaderFor(jobs: AmendmentChainJob[]): AmendmentChainLoader {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return async (id) => {
    const found = byId.get(id);
    if (!found) return null;
    if (found.status !== "APPROVED" && found.status !== "SUPERSEDED")
      return null;
    return found;
  };
}

describe("resolvePortalAmendmentInfo", () => {
  it("reports a plain certificate with no amendment history", async () => {
    const original = job({ id: 1 });
    const info = await resolvePortalAmendmentInfo(original, loaderFor([]));

    expect(info.isAmendment).toBe(false);
    expect(info.isSuperseded).toBe(false);
    expect(info.supersedes).toBeNull();
    expect(info.supersededBy).toBeNull();
    expect(info.chain).toEqual([
      {
        id: 1,
        jobId: original.jobId,
        amendmentNumber: null,
        approvedAt: original.approvedAt,
        isCurrent: true,
      },
    ]);
  });

  it("links an amended-once pair in both directions", async () => {
    const original = job({
      id: 1,
      status: "SUPERSEDED",
      supersededById: 2,
      supersededAt: new Date("2026-07-01T12:00:00Z"),
      amendmentReason: "Erro de digitação",
    });
    const amendment = job({
      id: 2,
      supersedesId: 1,
      amendmentNumber: 1,
      amendmentReason: "Erro de digitação",
    });
    const loader = loaderFor([original, amendment]);

    const fromOriginal = await resolvePortalAmendmentInfo(original, loader);
    expect(fromOriginal.isSuperseded).toBe(true);
    expect(fromOriginal.isAmendment).toBe(false);
    expect(fromOriginal.supersededBy).toEqual({
      id: 2,
      jobId: amendment.jobId,
      amendmentNumber: 1,
      approvedAt: amendment.approvedAt,
    });
    expect(fromOriginal.chain.map((m) => m.id)).toEqual([1, 2]);
    expect(fromOriginal.chain.map((m) => m.isCurrent)).toEqual([false, true]);

    const fromAmendment = await resolvePortalAmendmentInfo(amendment, loader);
    expect(fromAmendment.isAmendment).toBe(true);
    expect(fromAmendment.isSuperseded).toBe(false);
    expect(fromAmendment.amendmentNumber).toBe(1);
    expect(fromAmendment.supersedes).toEqual({ id: 1, jobId: original.jobId });
    expect(fromAmendment.chain.map((m) => m.id)).toEqual([1, 2]);
  });

  it("walks chained re-amendments from any member", async () => {
    const a = job({ id: 1, status: "SUPERSEDED", supersededById: 2 });
    const b = job({
      id: 2,
      status: "SUPERSEDED",
      supersedesId: 1,
      supersededById: 3,
      amendmentNumber: 1,
    });
    const c = job({ id: 3, supersedesId: 2, amendmentNumber: 2 });
    const loader = loaderFor([a, b, c]);

    const fromMiddle = await resolvePortalAmendmentInfo(b, loader);
    expect(fromMiddle.isAmendment).toBe(true);
    expect(fromMiddle.isSuperseded).toBe(true);
    expect(fromMiddle.supersedes?.id).toBe(1);
    expect(fromMiddle.supersededBy?.id).toBe(3);
    expect(fromMiddle.chain.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(fromMiddle.chain.map((m) => m.isCurrent)).toEqual([
      false,
      false,
      true,
    ]);

    const fromOriginal = await resolvePortalAmendmentInfo(a, loader);
    // Immediate replacement, not the end of the chain.
    expect(fromOriginal.supersededBy?.id).toBe(2);
    expect(fromOriginal.chain.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("keeps a DRAFT replacement unlinkable while still flagging supersession", async () => {
    // Mirrors verify.ts: opening an amendment sets supersededById immediately,
    // but the replacement stays DRAFT until approved.
    const original = job({
      id: 1,
      status: "SUPERSEDED",
      supersededById: 2,
      supersededAt: new Date("2026-07-01T12:00:00Z"),
    });
    const draftReplacement = job({
      id: 2,
      status: "DRAFT",
      supersedesId: 1,
      amendmentNumber: 1,
      approvedAt: null,
    });

    const info = await resolvePortalAmendmentInfo(
      original,
      loaderFor([original, draftReplacement]),
    );

    expect(info.isSuperseded).toBe(true);
    expect(info.supersededBy).toBeNull();
    expect(info.chain.map((m) => m.id)).toEqual([1]);
  });

  it("never links a chain member the loader does not resolve (tenant scope)", async () => {
    const amendment = job({ id: 2, supersedesId: 1, amendmentNumber: 1 });
    // Original absent from the loader's set — e.g. filtered out by the
    // customer-scope condition in the DB loader.
    const info = await resolvePortalAmendmentInfo(amendment, loaderFor([]));

    expect(info.isAmendment).toBe(true);
    expect(info.supersedes).toBeNull();
    expect(info.chain.map((m) => m.id)).toEqual([2]);
  });

  it("terminates on corrupted cyclic links", async () => {
    const a = job({ id: 1, status: "SUPERSEDED", supersededById: 2 });
    const b = job({
      id: 2,
      status: "SUPERSEDED",
      supersedesId: 1,
      supersededById: 1, // corruption: points back at the original
      amendmentNumber: 1,
    });

    const info = await resolvePortalAmendmentInfo(a, loaderFor([a, b]));
    expect(info.chain.map((m) => m.id)).toEqual([1, 2]);
  });
});
