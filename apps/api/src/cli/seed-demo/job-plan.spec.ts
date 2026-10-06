import { describe, expect, it } from "vitest";

import { buildAssetPlan } from "./asset-plan";
import {
  buildJobPlan,
  FULL_PLAN,
  OPEN_PIPELINE,
  QUICK_PLAN,
  REJECTED_COUNT,
} from "./job-plan";
import { createRng } from "./prng";

const NOW = new Date("2026-10-14T18:00:00.000Z");
const assets = buildAssetPlan(createRng("plan-assets"));

function planFor(size = FULL_PLAN, now = NOW) {
  return buildJobPlan(now, assets, size, createRng("plan"));
}

describe("buildJobPlan", () => {
  const plan = planFor();

  it("covers every pipeline stage with the intended number of jobs", () => {
    const count = (state: string) =>
      plan.filter((job) => job.final === state).length;
    expect(count("APPROVED")).toBe(FULL_PLAN.approved);
    expect(count("REJECTED")).toBe(REJECTED_COUNT);
    expect(count("DRAFT")).toBe(OPEN_PIPELINE.DRAFT);
    expect(count("IN_PROGRESS")).toBe(OPEN_PIPELINE.IN_PROGRESS);
    expect(count("REVIEW")).toBe(OPEN_PIPELINE.REVIEW);
  });

  it("calibrates each instrument at most once", () => {
    expect(new Set(plan.map((job) => job.assetTag)).size).toBe(plan.length);
  });

  it("numbers jobs in creation order", () => {
    expect(plan.map((job) => job.slot)).toEqual(plan.map((_, index) => index));
    const created = plan.map((job) => job.createdAt.getTime());
    expect(created.toSorted((a, b) => a - b)).toEqual(created);
  });

  // The seed runs whenever setup runs: mid-week, early on a Monday, at the
  // weekend, late at night, in the first minutes of a month.
  it.each([
    "2026-10-14T18:00:00.000Z",
    "2026-10-12T11:40:00.000Z",
    "2026-10-17T15:00:00.000Z",
    "2026-10-15T22:30:00.000Z",
    "2026-10-19T02:00:00.000Z",
    "2026-11-01T03:10:00.000Z",
  ])("keeps every timeline in order and in the past (now = %s)", (iso) => {
    const now = new Date(iso);
    for (const job of planFor(FULL_PLAN, now)) {
      expect(job.createdAt.getTime()).toBeLessThan(now.getTime());
      if (job.performedAt && job.submittedAt) {
        expect(job.createdAt.getTime()).toBeLessThan(job.performedAt.getTime());
        expect(job.performedAt.getTime()).toBeLessThan(
          job.submittedAt.getTime(),
        );
      }
      if (job.submittedAt && job.decidedAt) {
        expect(job.submittedAt.getTime()).toBeLessThan(job.decidedAt.getTime());
      }
      if (job.decidedAt)
        expect(job.decidedAt.getTime()).toBeLessThan(now.getTime());
    }
  });

  it("never lets a reviewer approve their own work", () => {
    for (const job of plan) {
      if (job.reviewer) expect(job.reviewer).not.toBe(job.technician);
    }
  });

  it("has exactly one overdue open job and some due today", () => {
    const open = plan.filter((job) =>
      ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.final),
    );
    expect(
      open.filter((job) => job.dueDate.getTime() < NOW.getTime()),
    ).toHaveLength(1);
    const endOfToday = new Date("2026-10-15T02:59:59.999Z").getTime();
    expect(
      open.filter(
        (job) =>
          job.dueDate.getTime() >= NOW.getTime() &&
          job.dueDate.getTime() <= endOfToday,
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("scales down for the quick profile", () => {
    expect(
      planFor(QUICK_PLAN).filter((job) => job.final === "APPROVED"),
    ).toHaveLength(QUICK_PLAN.approved);
  });

  it("is reproducible", () => {
    expect(planFor()).toEqual(plan);
  });

  it("refuses a pool that is too small", () => {
    expect(() =>
      buildJobPlan(NOW, assets.slice(0, 20), FULL_PLAN, createRng("x")),
    ).toThrow();
  });
});
