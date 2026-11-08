/**
 * job-standards.int.spec.ts: the reverse traceability of reference standards against a real
 * Postgres.
 *
 *   REQ-JS-1  `syncJobStandardLinks` keeps the `job_standard` projection equal to the job's
 *             snapshot: untouched when the snapshot was not written (undefined), cleared for
 *             null, rewritten without duplicates, and a standard the laboratory does not have
 *             rolls the whole rewrite back
 *   REQ-JS-2  `findImpactedCertificates` lists the issued certificates that relied on a
 *             standard inside the approval window, collapses an amendment chain to its current
 *             certificate, keeps a superseded original whose replacement did not use the
 *             standard (annotated with it), flags what a recall already notified, and never
 *             reaches another laboratory
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  jobStandard,
  nonConformance,
  ootNotification,
  referenceStandard,
  standardRecall,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import { orgDb } from "../../lib/org-db";
import { truncateAll } from "../../../test/integration/db";
import {
  seedBillingLab,
  type BillingLab,
} from "../../../test/integration/billing-fixtures";
import { insertJob } from "../../../test/integration/job-fixtures";
import { seedStandard } from "../../../test/integration/seed";
import { withStatusRepair } from "../../../test/integration/state-fixtures";
import {
  findImpactedCertificates,
  syncJobStandardLinks,
} from "./job-standards";

beforeEach(async () => {
  await truncateAll();
});

function snapshotOf(id: number): StandardSnapshot {
  return {
    id,
    name: `Padrão ${id}`,
    certificateNumber: "C",
    calibrationDate: new Date("2026-01-01T00:00:00.000Z"),
    nextCalibrationDate: null,
    uncertainty: null,
    uncertaintyUnit: null,
    coverageFactor: 2,
    distribution: "normal",
    drift: null,
    certifiedValues: null,
  };
}

async function newStandard(lab: BillingLab, serial: string) {
  const id = await seedStandard({
    organizationId: lab.orgId,
    unitId: lab.unitId,
    createdBy: lab.userId,
    name: serial,
  });
  await withStatusRepair((tx) =>
    tx
      .update(referenceStandard)
      .set({ serialNumber: serial })
      .where(eq(referenceStandard.id, id)),
  );
  return id;
}

async function newJob(
  lab: BillingLab,
  jobId: string,
  overrides: Partial<typeof calibrationJob.$inferInsert> = {},
) {
  const row = await insertJob({
    jobId,
    organizationId: lab.orgId,
    unitId: lab.unitId,
    customerId: lab.customerId,
    assetId: lab.assetId,
    serviceId: lab.serviceId,
    createdBy: lab.userId,
    status: "APPROVED",
    approvedAt: new Date("2026-03-01T12:00:00.000Z"),
    performedAt: new Date("2026-02-28T12:00:00.000Z"),
    methodSnapshot: {
      methodId: 1,
      methodName: "Test",
      methodVersion: 1,
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
    certificateName: jobId,
    ...overrides,
  });
  return row.id;
}

async function linksOf(jobId: number) {
  return (
    await db
      .select({ standardId: jobStandard.standardId })
      .from(jobStandard)
      .where(eq(jobStandard.jobId, jobId))
  )
    .map((row) => row.standardId)
    .toSorted((a, b) => a - b);
}

describe("syncJobStandardLinks", () => {
  it("REQ-JS-1: mirrors the snapshot without duplicates, leaves the links alone for an unwritten snapshot, clears them for null", async () => {
    const lab = await seedBillingLab("lab-js");
    const first = await newStandard(lab, "SN-1");
    const second = await newStandard(lab, "SN-2");
    const jobId = await newJob(lab, "CAL-JS-1");
    const handle = orgDb(lab.orgId);

    await syncJobStandardLinks(
      jobId,
      [snapshotOf(first), snapshotOf(first), snapshotOf(second)],
      null,
      lab.orgId,
      handle,
    );
    expect(await linksOf(jobId)).toEqual(
      [first, second].toSorted((a, b) => a - b),
    );

    // `undefined`: this write did not touch the snapshot, so the links stay.
    await syncJobStandardLinks(jobId, undefined, null, lab.orgId, handle);
    expect(await linksOf(jobId)).toHaveLength(2);

    // A rewrite replaces the set.
    await syncJobStandardLinks(
      jobId,
      [snapshotOf(second)],
      null,
      lab.orgId,
      handle,
    );
    expect(await linksOf(jobId)).toEqual([second]);

    await syncJobStandardLinks(jobId, null, null, lab.orgId, handle);
    expect(await linksOf(jobId)).toEqual([]);
  });

  it("REQ-JS-1: a standard the laboratory does not have fails the rewrite and the previous links survive", async () => {
    const lab = await seedBillingLab("lab-js");
    const first = await newStandard(lab, "SN-1");
    const jobId = await newJob(lab, "CAL-JS-1");
    const handle = orgDb(lab.orgId);
    await syncJobStandardLinks(
      jobId,
      [snapshotOf(first)],
      null,
      lab.orgId,
      handle,
    );

    await expect(
      syncJobStandardLinks(
        jobId,
        [snapshotOf(first), snapshotOf(999_999)],
        null,
        lab.orgId,
        handle,
      ),
    ).rejects.toThrow();

    expect(await linksOf(jobId)).toEqual([first]);
  });
});

describe("findImpactedCertificates", () => {
  const WINDOW = {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-12-31T00:00:00.000Z"),
  };

  async function link(lab: BillingLab, jobId: number, standardId: number) {
    await syncJobStandardLinks(
      jobId,
      [snapshotOf(standardId)],
      null,
      lab.orgId,
      orgDb(lab.orgId),
    );
  }

  function impacted(lab: BillingLab, standardId: number) {
    return orgDb(lab.orgId).transaction((o) =>
      findImpactedCertificates(
        { standardId, organizationId: lab.orgId, ...WINDOW },
        o,
      ),
    );
  }

  it("REQ-JS-2: lists the issued certificates in the window, newest approval first, and nothing else", async () => {
    const lab = await seedBillingLab("lab-js");
    const other = await seedBillingLab("lab-js-other");
    const standard = await newStandard(lab, "SN-1");
    const otherStandard = await newStandard(other, "SN-O");
    const inWindowOld = await newJob(lab, "CAL-OLD", {
      approvedAt: new Date("2026-02-01T12:00:00.000Z"),
    });
    const inWindowNew = await newJob(lab, "CAL-NEW", {
      approvedAt: new Date("2026-04-01T12:00:00.000Z"),
    });
    const outside = await newJob(lab, "CAL-OUT", {
      approvedAt: new Date("2025-06-01T12:00:00.000Z"),
    });
    const draft = await newJob(lab, "CAL-DRAFT", {
      status: "DRAFT",
      approvedAt: null,
    });
    for (const id of [inWindowOld, inWindowNew, outside, draft]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a few sequential writes.
      await link(lab, id, standard);
    }
    // Another laboratory's certificate on its own standard: never reachable.
    const foreign = await newJob(other, "CAL-FOREIGN");
    await link(other, foreign, otherStandard);

    const rows = await impacted(lab, standard);

    expect(rows.map((row) => row.certificateNumber)).toEqual([
      "CAL-NEW",
      "CAL-OLD",
    ]);
    expect(rows[0]).toMatchObject({
      status: "APPROVED",
      customer: { id: lab.customerId, name: `Customer ${lab.orgId}` },
      supersededByJobId: null,
      alreadyNotified: false,
    });
    expect(await impacted(lab, 999_999)).toEqual([]);
  });

  it("REQ-JS-2: an amendment chain is collapsed to its current certificate; a superseded original whose replacement did not use the standard stays, annotated", async () => {
    const lab = await seedBillingLab("lab-js");
    const standard = await newStandard(lab, "SN-1");
    // Chain 1: original and replacement both used the standard.
    const replacement = await newJob(lab, "CAL-R1");
    const original = await newJob(lab, "CAL-O1", {
      status: "SUPERSEDED",
      supersededById: replacement,
    });
    // Chain 2: the replacement did NOT use the standard.
    const replacementWithout = await newJob(lab, "CAL-R2");
    const originalKept = await newJob(lab, "CAL-O2", {
      status: "SUPERSEDED",
      supersededById: replacementWithout,
    });
    for (const id of [replacement, original, originalKept]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a few sequential writes.
      await link(lab, id, standard);
    }

    const rows = await impacted(lab, standard);

    expect(rows.map((row) => row.certificateNumber).toSorted()).toEqual([
      "CAL-O2",
      "CAL-R1",
    ]);
    const kept = rows.find((row) => row.certificateNumber === "CAL-O2");
    expect(kept).toMatchObject({
      status: "SUPERSEDED",
      supersededByJobId: replacementWithout,
      supersededByCertificateNumber: "CAL-R2",
    });
  });

  it("REQ-JS-2: flags a certificate a recall of this standard already notified", async () => {
    const lab = await seedBillingLab("lab-js");
    const standard = await newStandard(lab, "SN-1");
    const otherStandard = await newStandard(lab, "SN-2");
    const notified = await newJob(lab, "CAL-NOTIFIED");
    const pending = await newJob(lab, "CAL-PENDING");
    await link(lab, notified, standard);
    await link(lab, pending, standard);

    async function notifyUnder(forStandard: number, jobId: number) {
      const [nc] = await withStatusRepair((tx) =>
        tx
          .insert(nonConformance)
          .values({
            ncNumber: `NC-${forStandard}-${jobId}`,
            organizationId: lab.orgId,
            type: "work",
            description: "Padrão fora de tolerância",
            detectedBy: lab.userId,
            detectedAt: new Date("2026-05-01T00:00:00.000Z"),
            status: "open",
            createdBy: lab.userId,
          })
          .returning({ id: nonConformance.id }),
      );
      const [recall] = await withStatusRepair((tx) =>
        tx
          .insert(standardRecall)
          .values({
            organizationId: lab.orgId,
            standardId: forStandard,
            ncId: nc?.id ?? 0,
            createdBy: lab.userId,
          })
          .returning({ id: standardRecall.id }),
      );
      await withStatusRepair((tx) =>
        tx.insert(ootNotification).values({
          organizationId: lab.orgId,
          ncId: nc?.id ?? 0,
          jobId,
          recallId: recall?.id ?? null,
          approvedBy: lab.userId,
        }),
      );
    }
    await notifyUnder(standard, notified);
    // A recall of ANOTHER standard that notified the pending certificate does not count.
    await notifyUnder(otherStandard, pending);

    const rows = await impacted(lab, standard);

    expect(
      Object.fromEntries(
        rows.map((row) => [row.certificateNumber, row.alreadyNotified]),
      ),
    ).toEqual({ "CAL-NOTIFIED": true, "CAL-PENDING": false });
  });
});
