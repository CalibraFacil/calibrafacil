import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  JUDGEMENT_TODAY,
  STANDARDS_JUDGEMENT_FIXTURES,
  fixtureJudgementInput,
  fixtureStandardIds,
  summarizeJudgement,
} from "@calibra-facil/schemas/standards-judgement-fixtures";
import {
  judgeExecutionStandards,
  type JudgedStandardFacts,
} from "@calibra-facil/schemas";
import { judgeLocalStandards, openLocalDatabase } from "./index";

// REQ-SJ-3 / REQ-SJ-4, offline: the SQLite adapter gives, for every row of the
// shared fixture table, the verdict and refusal code the pure function (and the
// cloud's Postgres adapter, `standards-judgement-parity.int.spec.ts`) gives.

let directory: string;
let database: ReturnType<typeof openLocalDatabase>;

beforeAll(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "calibra-sj-parity-"));
  database = openLocalDatabase({
    filePath: path.join(directory, "calibra.sqlite"),
  });
});

afterAll(() => {
  database.close();
  rmSync(directory, { force: true, recursive: true });
});

beforeEach(() => {
  database.prepare("DELETE FROM reference_standards").run();
});

describe("offline standards judgement parity (REQ-SJ-3, REQ-SJ-4)", () => {
  it.each(
    STANDARDS_JUDGEMENT_FIXTURES.map((fixture) => [fixture.name, fixture]),
  )("REQ-SJ-4: %s", (_name, fixture) => {
    const ids = fixtureStandardIds(fixture);
    const facts: JudgedStandardFacts[] = [];
    for (const standard of fixture.standards) {
      // The offline cache holds only the laboratory's own standards: another
      // organization's, and an unknown id, are simply not in it.
      if (standard.world === "absent" || standard.world === "other_org") {
        continue;
      }
      const id = ids.get(standard.key) ?? 0;
      const status = standard.status ?? "ACTIVE";
      database
        .prepare(
          `
INSERT INTO reference_standards (
  id, remote_id, organization_id, unit_id, name, serial_number,
  certificate_number, next_calibration_date, status, snapshot_json,
  pulled_at, sync_state
) VALUES (
  @id, @remoteId, 'org-1', 1, @name, @serial, 'CERT', @nextCalibrationDate,
  @status, '{}', '2026-01-15T11:00:00.000Z', @syncState
)
`,
        )
        .run({
          id: `standard:${id}`,
          remoteId: id,
          name: standard.key,
          serial: `SN-${id}`,
          nextCalibrationDate: standard.nextCalibrationDate,
          status,
          syncState: standard.deleted ? "deleted" : "synced",
        });
      facts.push({
        id,
        name: standard.key,
        status,
        deletedAt: standard.deleted ? "deleted" : null,
        nextCalibrationDate: standard.nextCalibrationDate,
        inScope: true,
      });
    }

    const result = judgeLocalStandards(
      database,
      fixtureJudgementInput(fixture),
    );

    expect(summarizeJudgement(fixture, result)).toEqual(fixture.expected);
    // ... and it is exactly what the pure function says of the same facts.
    expect(result).toEqual(
      judgeExecutionStandards(fixtureJudgementInput(fixture), facts),
    );
    if (result.ok && fixture.expected.ok) {
      expect(result.standardsJudgedAt).toEqual(
        fixture.expected.judgedAt === "today"
          ? JUDGEMENT_TODAY
          : new Date(fixture.performedAt ?? ""),
      );
    }
  });
});
