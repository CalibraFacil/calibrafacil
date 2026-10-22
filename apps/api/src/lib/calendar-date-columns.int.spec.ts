/**
 * calendar-date-columns.int.spec.ts: real-Postgres proof that the columns which
 * name a calendar day are Postgres `date` columns (migration 0116) and that the
 * conversion keeps the day each value named.
 *
 *   REQ-CAL-001  the columns are `date`; any Date written is stored as the day
 *                it names and read back as UTC midnight of that day
 *   REQ-CAL-002  migration 0116 converts timestamp values by the display rule
 *                (exact UTC midnight = its UTC day, else the Sao Paulo day), is
 *                idempotent, and leaves the calibration_job immutability guard
 *                comparing an unchanged due_date as equal
 *   REQ-CAL-003  a Drizzle operator on such a column compares DAYS
 */

import { insertJobs } from "../../test/integration/job-fixtures";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  referenceStandard,
  service,
} from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";

const CALENDAR_COLUMNS = [
  ["organization", "accreditation_valid_from"],
  ["organization", "accreditation_valid_until"],
  ["asset", "last_calibration_date"],
  ["asset", "next_calibration_date"],
  ["asset", "next_legal_verification_date"],
  ["reference_standard", "calibration_date"],
  ["reference_standard", "next_calibration_date"],
  ["reference_standard_certificate_document", "calibration_date"],
  ["reference_standard_certificate_document", "next_calibration_date"],
  ["calibration_job", "due_date"],
  ["billing_document", "issue_date"],
  ["billing_document", "due_date"],
  ["receivable_installment", "due_date"],
] as const;

const MIGRATION = readFileSync(
  new URL(
    "../../../../packages/db/drizzle/0116_calendar_date_columns.sql",
    import.meta.url,
  ),
  "utf8",
);

function statementsOf(migration: string): string[] {
  return migration
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** `ALTER TABLE "t" ALTER COLUMN "c" TYPE date USING (...)` of the migration. */
function alterStatements() {
  return Array.from(
    MIGRATION.matchAll(
      /ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" TYPE date USING \(.*?\);/g,
    ),
    (match) => ({ table: match[1], column: match[2], statement: match[0] }),
  );
}

async function columnTypes(): Promise<Map<string, string>> {
  const rows = await db.execute<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(sql`
    select table_name, column_name, data_type
      from information_schema.columns
     where table_schema = 'public'
       and (table_name, column_name) in (${sql.join(
         CALENDAR_COLUMNS.map(([t, c]) => sql`(${t}, ${c})`),
         sql`, `,
       )})`);
  return new Map(
    Array.from(rows).map((row) => [
      `${row.table_name}.${row.column_name}`,
      row.data_type,
    ]),
  );
}

describe("calendar-date columns (migration 0116)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-CAL-001: every column that names a calendar day is a Postgres date", async () => {
    const types = await columnTypes();
    expect(types.size).toBe(CALENDAR_COLUMNS.length);
    for (const [table, column] of CALENDAR_COLUMNS) {
      expect(types.get(`${table}.${column}`), `${table}.${column}`).toBe(
        "date",
      );
    }
  });

  it("REQ-CAL-002: the migration converts exactly the columns schema.ts declares as calendar dates", () => {
    const converted = alterStatements().map(
      ({ table, column }) => `${table}.${column}`,
    );
    expect(converted.sort()).toEqual(
      CALENDAR_COLUMNS.map(([table, column]) => `${table}.${column}`).sort(),
    );
  });

  describe("REQ-CAL-002: the USING expression of the migration", () => {
    // Day D = 2026-10-15. Sao Paulo is UTC-3 (no DST).
    const CASES: Array<[string, string]> = [
      ["2026-10-15 00:00:00", "2026-10-15"], // typed day: exact UTC midnight
      ["2026-10-15 15:00:00", "2026-10-15"], // web local noon
      ["2026-10-15 03:00:00", "2026-10-15"], // 00:00 in Sao Paulo
      ["2026-10-15 01:30:00", "2026-10-14"], // 22:30 in Sao Paulo the day before
      ["2026-10-15 02:59:59.999", "2026-10-14"], // 23:59:59.999 the day before
      ["2026-10-15 23:59:59", "2026-10-15"],
      ["2026-10-15 00:00:00.001", "2026-10-14"], // not midnight: Sao Paulo evening
      ["2018-01-10 01:59:00", "2018-01-09"], // pre-2019 DST (UTC-2)
      ["2018-01-10 02:30:00", "2018-01-10"],
    ];

    it("is present for every converted column", () => {
      expect(alterStatements()).toHaveLength(CALENDAR_COLUMNS.length);
    });

    it.each(alterStatements())(
      "yields the day each value names for $table.$column",
      async ({ column, statement }) => {
        await db.execute(sql.raw(`DROP TABLE IF EXISTS calendar_probe`));
        await db.execute(
          sql.raw(`CREATE TABLE calendar_probe ("${column}" timestamp)`),
        );
        try {
          for (const [input] of CASES) {
            await db.execute(
              sql.raw(
                `INSERT INTO calendar_probe ("${column}") VALUES ('${input}')`,
              ),
            );
          }
          await db.execute(
            sql.raw(`INSERT INTO calendar_probe ("${column}") VALUES (NULL)`),
          );
          // The migration's own statement, pointed at the probe table. It sits
          // inside the idempotency guard of the migration, so run the bare ALTER.
          await db.execute(
            sql.raw(
              statement.replace(
                /ALTER TABLE "\w+"/,
                "ALTER TABLE calendar_probe",
              ),
            ),
          );
          const rows = await db.execute<{ day: string | null }>(
            sql.raw(
              `SELECT "${column}"::text AS day FROM calendar_probe ORDER BY ctid`,
            ),
          );
          expect(Array.from(rows).map((row) => row.day)).toEqual([
            ...CASES.map(([, day]) => day),
            null,
          ]);
        } finally {
          await db.execute(sql.raw(`DROP TABLE IF EXISTS calendar_probe`));
        }
      },
    );
  });

  it("REQ-CAL-002: running the migration file converts timestamp columns, and running it again is a no-op", async () => {
    // Put the columns back to what production had before the migration.
    for (const [table, column] of CALENDAR_COLUMNS) {
      await db.execute(
        sql.raw(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamp USING "${column}"::timestamp`,
        ),
      );
    }
    const before = await columnTypes();
    expect(
      [...before.values()].every((type) => type.startsWith("timestamp")),
    ).toBe(true);

    for (const statement of statementsOf(MIGRATION)) {
      await db.execute(sql.raw(statement));
    }
    const after = await columnTypes();
    expect([...after.values()].every((type) => type === "date")).toBe(true);

    for (const statement of statementsOf(MIGRATION)) {
      await db.execute(sql.raw(statement));
    }
    expect(
      [...(await columnTypes()).values()].every((type) => type === "date"),
    ).toBe(true);
  });

  describe("REQ-CAL-001 / REQ-CAL-003: writes and operators go through the day rule", () => {
    async function seedStandardWithDates(
      nextCalibrationDate: Date,
      name = "Padrao",
    ) {
      const org = await seedOrg({ orgId: "org-cal", userId: "user-cal" });
      const [row] = await db
        .insert(referenceStandard)
        .values({
          organizationId: org.orgId,
          unitId: org.unitId,
          createdBy: org.userId,
          name,
          kind: "generic_scalar",
          serialNumber: "SN-CAL",
          certificateNumber: "CERT-CAL",
          calibrationDate: new Date("2026-01-10T15:00:00.000Z"),
          nextCalibrationDate,
          coverageFactor: 2,
          distribution: "normal",
          status: "ACTIVE",
          referenceValue: 1,
          uncertainty: 0.01,
        })
        .returning({ id: referenceStandard.id });
      if (!row) throw new Error("insert failed");
      return { ...org, id: row.id };
    }

    it("REQ-CAL-001: a Date is stored as the day it names and read back as UTC midnight", async () => {
      const { id } = await seedStandardWithDates(
        new Date("2026-10-15T15:00:00.000Z"),
      );
      const [row] = await db
        .select({
          calibrationDate: referenceStandard.calibrationDate,
          nextCalibrationDate: referenceStandard.nextCalibrationDate,
        })
        .from(referenceStandard)
        .where(eq(referenceStandard.id, id));
      expect(row?.nextCalibrationDate.toISOString()).toBe(
        "2026-10-15T00:00:00.000Z",
      );
      expect(row?.calibrationDate.toISOString()).toBe(
        "2026-01-10T00:00:00.000Z",
      );
      const raw = await db.execute<{ day: string }>(
        sql`select next_calibration_date::text as day from reference_standard where id = ${id}`,
      );
      expect(Array.from(raw)[0]?.day).toBe("2026-10-15");
    });

    it("REQ-CAL-001: 01:30Z (22:30 in Sao Paulo) is stored as the previous day", async () => {
      const { id } = await seedStandardWithDates(
        new Date("2026-10-16T01:30:00.000Z"),
      );
      const raw = await db.execute<{ day: string }>(
        sql`select next_calibration_date::text as day from reference_standard where id = ${id}`,
      );
      expect(Array.from(raw)[0]?.day).toBe("2026-10-15");
    });

    it("REQ-CAL-003: lt/gte with a Date parameter compare calendar days, not instants", async () => {
      const { id, orgId } = await seedStandardWithDates(
        new Date("2026-10-15T00:00:00.000Z"),
      );
      const idsWhere = async (condition: ReturnType<typeof lt>) =>
        (
          await db
            .select({ id: referenceStandard.id })
            .from(referenceStandard)
            .where(and(eq(referenceStandard.organizationId, orgId), condition))
        ).map((row) => row.id);

      // Any instant of 2026-10-15 in Sao Paulo (03:00Z .. 02:59:59Z next day)
      // names the same day as the stored value: neither "before" it ...
      for (const instant of [
        "2026-10-15T03:00:00.000Z",
        "2026-10-15T15:00:00.000Z",
        "2026-10-16T02:59:59.000Z",
      ]) {
        expect(
          await idsWhere(
            lt(referenceStandard.nextCalibrationDate, new Date(instant)),
          ),
          `lt ${instant}`,
        ).toEqual([]);
        expect(
          await idsWhere(
            gte(referenceStandard.nextCalibrationDate, new Date(instant)),
          ),
          `gte ${instant}`,
        ).toEqual([id]);
      }
      // ... and one instant later (00:00 of the 16th in Sao Paulo) it is past.
      expect(
        await idsWhere(
          lt(
            referenceStandard.nextCalibrationDate,
            new Date("2026-10-16T03:00:00.000Z"),
          ),
        ),
      ).toEqual([id]);
    });
  });

  describe("REQ-CAL-002: the calibration_job immutability guard and due_date", () => {
    async function seedApprovedJob(dueDate: Date) {
      const org = await seedOrg({ orgId: "org-guard", userId: "user-guard" });
      const customerId = await seedCustomer({
        labOrganizationId: org.orgId,
        name: "Cliente",
      });
      const [type] = await db
        .insert(assetType)
        .values({ name: "AT", slug: "at-guard", definition: [] })
        .returning({ id: assetType.id });
      const [instrument] = await db
        .insert(asset)
        .values({
          labOrganizationId: org.orgId,
          unitId: org.unitId,
          customerId,
          assetTypeId: type?.id ?? 0,
          name: "Instrumento",
          serialNumber: "SN-G",
          tag: "TAG-G",
        })
        .returning({ id: asset.id });
      const [svc] = await db
        .insert(service)
        .values({
          organizationId: org.orgId,
          unitId: org.unitId,
          name: "Calibracao",
          isActive: true,
        })
        .returning({ id: service.id });
      const [job] = await insertJobs({
        jobId: "CAL-GUARD-1",
        organizationId: org.orgId,
        unitId: org.unitId,
        customerId,
        assetId: instrument?.id ?? 0,
        serviceId: svc?.id ?? 0,
        createdBy: org.userId,
        status: "APPROVED",
        methodSnapshot: {
          methodId: 1,
          methodName: "M",
          methodVersion: 1,
          dataFields: [],
          variableBindings: [],
          formulas: [],
          measurementModels: [],
          validations: [],
          uncertaintyParams: [],
        },
        data: {},
        results: { value: 1, expandedUncertainty: 0.1, k: 2 },
        dueDate,
        performedAt: new Date("2026-02-01T10:00:00.000Z"),
        approvedBy: org.userId,
        approvedAt: new Date("2026-02-02T10:00:00.000Z"),
        certificateUrl: "https://files.test/c.pdf",
      });
      if (!job) throw new Error("job insert failed");
      return { ...org, id: job.id };
    }

    it("REQ-CAL-002 [HIGH RISK]: rewriting an APPROVED job's due_date with the SAME day (another instant) is not an edit", async () => {
      const { id, orgId } = await seedApprovedJob(
        new Date("2026-11-20T00:00:00.000Z"),
      );
      await db
        .update(calibrationJob)
        .set({ dueDate: new Date("2026-11-20T15:00:00.000Z") })
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, orgId),
          ),
        );
      const [row] = await db
        .select({ dueDate: calibrationJob.dueDate })
        .from(calibrationJob)
        .where(eq(calibrationJob.id, id));
      expect(row?.dueDate?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    });

    it("REQ-CAL-002 [HIGH RISK]: changing an APPROVED job's due_date to another day is still refused", async () => {
      const { id, orgId } = await seedApprovedJob(
        new Date("2026-11-20T00:00:00.000Z"),
      );
      await expect(
        db
          .update(calibrationJob)
          .set({ dueDate: new Date("2026-11-21T00:00:00.000Z") })
          .where(
            and(
              eq(calibrationJob.id, id),
              eq(calibrationJob.organizationId, orgId),
            ),
          ),
      ).rejects.toThrow();
    });
  });
});
