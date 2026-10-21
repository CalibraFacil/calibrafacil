import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  calibrationJob,
  organization,
  service,
} from "@calibra-facil/db/schema";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { processScheduledNotifications } from "./scheduled";
import { db, truncateAll } from "../test/integration/db";
import {
  seedReferenceStandard,
  seedScheduledAsset,
  seedScheduledOrg,
} from "../test/integration/seed-scheduled";

// REQ-CAL-003: the compliance sweep compares calendar-day columns (an asset's
// next calibration, a standard's validity, a job's due date, the accreditation
// vigencia) with TODAY IN THE LABORATORY (America/Sao_Paulo), not with the
// database's UTC clock. Seeded relative to the laboratory's own today, so the
// expectations hold at any hour; between 21:00 and 24:00 in Sao Paulo (the UTC
// day is already tomorrow) they are exactly the cases the UTC clock got wrong:
// "valid through today" read as expired, "due today" read as overdue.

function buildEnv() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "[worker-int] scheduled spec ran before setup.ts set DATABASE_URL",
    );
  }
  return { DATABASE_URL: databaseUrl };
}

const METHOD_SNAPSHOT = {
  methodId: 1,
  methodName: "Metodo",
  methodVersion: 1,
  dataFields: [],
  variableBindings: [],
  formulas: [],
  measurementModels: [],
  validations: [],
  uncertaintyParams: [],
} satisfies Record<string, unknown>;

describe("processScheduledNotifications: calendar days in the laboratory (REQ-CAL-003)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  const today = () => labToday();
  const yesterday = () => addCalendarDays(labToday(), -1);

  it("REQ-CAL-003: a standard valid through today is expiring, not expired; one that ended yesterday is expired", async () => {
    const org = await seedScheduledOrg();
    await seedReferenceStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.ownerUserId,
      serialNumber: "SN-TODAY",
      certificateNumber: "CERT-TODAY",
      nextCalibrationDate: today(),
    });
    await seedReferenceStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.ownerUserId,
      serialNumber: "SN-YESTERDAY",
      certificateNumber: "CERT-YESTERDAY",
      nextCalibrationDate: yesterday(),
    });

    const result = await processScheduledNotifications(buildEnv());

    expect(result.standardsExpiredProcessed).toBe(1); // yesterday's only
    expect(result.standardsProcessed).toBe(1); // today's, in the expiring window
  });

  it("REQ-CAL-003: an instrument due today is due for recalibration; one due yesterday is not in the upcoming window", async () => {
    const org = await seedScheduledOrg();
    await seedScheduledAsset({
      organizationId: org.orgId,
      unitId: org.unitId,
      tag: "DUE-TODAY",
      nextCalibrationDate: today(),
    });
    await seedScheduledAsset({
      organizationId: org.orgId,
      unitId: org.unitId,
      tag: "DUE-YESTERDAY",
      nextCalibrationDate: yesterday(),
    });

    const result = await processScheduledNotifications(buildEnv());

    expect(result.assetsProcessed).toBe(1);
  });

  it("REQ-CAL-003: a job due today is not overdue; one due yesterday is", async () => {
    const org = await seedScheduledOrg();
    const { assetId, customerId } = await seedScheduledAsset({
      organizationId: org.orgId,
      unitId: org.unitId,
      tag: "JOB-ASSET",
    });
    const [svc] = await db
      .insert(service)
      .values({
        organizationId: org.orgId,
        unitId: org.unitId,
        name: "Calibracao",
        isActive: true,
      })
      .returning();
    const base = {
      organizationId: org.orgId,
      unitId: org.unitId,
      customerId,
      assetId,
      serviceId: svc?.id ?? 0,
      createdBy: org.ownerUserId,
      status: "DRAFT" as const,
      methodSnapshot: METHOD_SNAPSHOT,
    };
    await db.insert(calibrationJob).values([
      { ...base, jobId: "J-TODAY", certificateName: "a", dueDate: today() },
      {
        ...base,
        jobId: "J-YESTERDAY",
        certificateName: "b",
        dueDate: yesterday(),
      },
    ]);

    const result = await processScheduledNotifications(buildEnv());

    expect(result.jobsProcessed).toBe(1);
  });

  it("REQ-CAL-003: an accreditation valid through today is still alerted; one that ended yesterday is not", async () => {
    const validToday = await seedScheduledOrg({
      orgId: "org-acc-today",
      userId: "owner-acc-today",
    });
    const endedYesterday = await seedScheduledOrg({
      orgId: "org-acc-yesterday",
      userId: "owner-acc-yesterday",
    });
    await db
      .update(organization)
      .set({
        accreditationActive: true,
        accreditationNumber: "0123",
        accreditationValidUntil: today(),
      })
      .where(eq(organization.id, validToday.orgId));
    await db
      .update(organization)
      .set({
        accreditationActive: true,
        accreditationNumber: "0456",
        accreditationValidUntil: yesterday(),
      })
      .where(eq(organization.id, endedYesterday.orgId));

    const result = await processScheduledNotifications(buildEnv());

    expect(result.accreditationsProcessed).toBe(1);
  });
});
