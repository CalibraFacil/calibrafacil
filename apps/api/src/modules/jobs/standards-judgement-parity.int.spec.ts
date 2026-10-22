/**
 * standards-judgement-parity.int.spec.ts: real-Postgres half of the parity test
 * of the one standards judgement (REQ-SJ-3, REQ-SJ-4, Q12). Every row of the
 * shared fixture table is loaded into the standards table and judged through the
 * cloud adapter (`judgeSnapshotStandards`); the verdict and refusal code must be
 * the ones the pure function gives. The offline half runs the same table through
 * the SQLite adapter (`packages/local-db/src/standards-judgement-parity.test.ts`).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { organizationUnit, referenceStandard } from "@calibra-facil/db/schema";
import {
  judgeExecutionStandards,
  type JudgedStandardFacts,
} from "@calibra-facil/schemas";
import {
  JUDGEMENT_TODAY,
  STANDARDS_JUDGEMENT_FIXTURES,
  fixtureJudgementInput,
  fixtureStandardIds,
  summarizeJudgement,
} from "@calibra-facil/schemas/standards-judgement-fixtures";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  judgeSnapshotStandards,
  standardsRefusalApiCode,
  standardsRefusalDomainError,
} from "./standards-judgement";

type World = {
  mine: Awaited<ReturnType<typeof seedOrg>>;
  other: Awaited<ReturnType<typeof seedOrg>>;
};

let world: World;

beforeAll(async () => {
  await truncateAll();
  const mine = await seedOrg({ orgId: "org-sj-mine", userId: "user-sj-mine" });
  const other = await seedOrg({
    orgId: "org-sj-other",
    userId: "user-sj-other",
  });
  world = { mine, other };
});

beforeEach(async () => {
  await db.delete(referenceStandard);
});

async function insertStandard(input: {
  id: number;
  key: string;
  org: World["mine"];
  status: "ACTIVE" | "INACTIVE";
  deleted: boolean;
  nextCalibrationDate: string | null;
  unitId?: number;
}) {
  await db.insert(referenceStandard).values({
    id: input.id,
    organizationId: input.org.orgId,
    unitId: input.unitId ?? input.org.unitId,
    createdBy: input.org.userId,
    name: input.key,
    kind: "generic_scalar",
    serialNumber: `SN-${input.id}`,
    certificateNumber: `CERT-${input.id}`,
    calibrationDate: new Date("2025-01-10T15:00:00.000Z"),
    // The column is a calendar date; "no readable date" is stored as the epoch.
    nextCalibrationDate: input.nextCalibrationDate
      ? new Date(`${input.nextCalibrationDate}T00:00:00.000Z`)
      : new Date("1970-01-01T00:00:00.000Z"),
    coverageFactor: 2,
    distribution: "normal",
    status: input.status,
    referenceValue: 1,
    uncertainty: 0.01,
    deletedAt: input.deleted ? new Date("2026-10-01T00:00:00.000Z") : null,
  });
}

describe("cloud standards judgement parity (REQ-SJ-3, REQ-SJ-4)", () => {
  it.each(
    STANDARDS_JUDGEMENT_FIXTURES.map((fixture) => [fixture.name, fixture]),
  )("REQ-SJ-4: %s", async (_name, fixture) => {
    const ids = fixtureStandardIds(fixture);
    const facts: JudgedStandardFacts[] = [];
    for (const standard of fixture.standards) {
      if (standard.world === "absent") continue;
      const id = ids.get(standard.key) ?? 0;
      const status = standard.status ?? "ACTIVE";
      const deleted = standard.deleted ?? false;
      await insertStandard({
        id,
        key: standard.key,
        org: standard.world === "other_org" ? world.other : world.mine,
        status,
        deleted,
        nextCalibrationDate: standard.nextCalibrationDate,
      });
      facts.push({
        id,
        name: standard.key,
        status,
        deletedAt: deleted ? new Date("2026-10-01T00:00:00.000Z") : null,
        nextCalibrationDate: standard.nextCalibrationDate,
        inScope: standard.world !== "other_org",
      });
    }
    const input = fixtureJudgementInput(fixture);

    const result = await judgeSnapshotStandards({
      standardIds: input.standardIds,
      organizationId: world.mine.orgId,
      performedAt: input.performedAt,
      now: input.today,
      backdateReason: input.backdateReason,
      mode: input.mode,
      requireBackdateReason: input.requireBackdateReason,
    });

    expect(summarizeJudgement(fixture, result)).toEqual(fixture.expected);
    // ... exactly what the pure function says of the same facts.
    expect(result).toEqual(judgeExecutionStandards(input, facts));
    if (result.ok && fixture.expected.ok) {
      expect(result.standardsJudgedAt).toEqual(
        fixture.expected.judgedAt === "today"
          ? JUDGEMENT_TODAY
          : new Date(fixture.performedAt ?? ""),
      );
    }
    // The cloud's error for a refusal carries the very code of the cause, with
    // the status the cloud has always answered (400).
    if (!result.ok && !fixture.expected.ok) {
      const error = standardsRefusalDomainError(result);
      expect(error.code).toBe(fixture.expected.code);
      expect(error.status).toBe(400);
      expect(standardsRefusalApiCode(result)).toBe(error.code);
    }
  });

  it("REQ-SJ-3: a standard of the organization outside the caller's unit scope is not found", async () => {
    const [otherUnit] = await db
      .insert(organizationUnit)
      .values({
        organizationId: world.mine.orgId,
        name: "Filial",
        slug: "filial",
        status: "ACTIVE",
        isDefault: false,
        createdBy: world.mine.userId,
      })
      .returning({ id: organizationUnit.id });
    await insertStandard({
      id: 901,
      key: "FILIAL",
      org: world.mine,
      status: "ACTIVE",
      deleted: false,
      nextCalibrationDate: "2027-03-01",
      unitId: otherUnit?.id,
    });

    const result = await judgeSnapshotStandards({
      standardIds: [901],
      organizationId: world.mine.orgId,
      unitScope: buildUnitScopeCondition(referenceStandard.unitId, {
        selectedUnitScope: "unit",
        activeUnitId: world.mine.unitId,
        accessibleUnitIds: [world.mine.unitId],
      }),
      performedAt: JUDGEMENT_TODAY,
      now: JUDGEMENT_TODAY,
      mode: "desktop_legacy",
    });

    expect(result).toEqual({
      ok: false,
      code: "standard_not_found",
      standardIds: [901],
      standardNames: [],
    });
  });
});
