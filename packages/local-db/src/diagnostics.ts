import type { LocalDatabase } from "./database";
import { getLocalSchemaVersion } from "./database";
import { countOpenSyncConflicts, countPendingOutbox } from "./outbox";

export type LocalDatabaseDiagnostics = {
  schemaVersion: number;
  integrity: {
    ok: boolean;
    messages: string[];
  };
  pendingOutboxCount: number;
  conflictCount: number;
  activeCalibrationJobCount: number;
  activeServiceOrderWorkflowCount: number;
};

export function getLocalDatabaseDiagnostics(
  database: LocalDatabase,
): LocalDatabaseDiagnostics {
  const rows = database.pragma("integrity_check") as Array<
    Record<string, unknown>
  >;
  const messages = rows
    .map((row) => {
      const value = row.integrity_check;
      return typeof value === "string" ? value : null;
    })
    .filter((value): value is string => Boolean(value));

  return {
    schemaVersion: getLocalSchemaVersion(database),
    integrity: {
      ok: messages.length === 1 && messages[0] === "ok",
      messages,
    },
    pendingOutboxCount: countPendingOutbox(database),
    conflictCount: countOpenSyncConflicts(database),
    activeCalibrationJobCount: countActiveCalibrationJobs(database),
    activeServiceOrderWorkflowCount: countActiveServiceOrderWorkflows(database),
  };
}

function countActiveCalibrationJobs(database: LocalDatabase) {
  const row = database
    .prepare(
      `
SELECT COUNT(*) AS total
FROM calibration_jobs
WHERE status = 'IN_PROGRESS'
  AND deleted_at IS NULL
`,
    )
    .get() as { total: number };

  return row.total;
}

function countActiveServiceOrderWorkflows(database: LocalDatabase) {
  const row = database
    .prepare(
      `
SELECT COUNT(*) AS total
FROM service_orders
WHERE status IN ('repair_in_progress', 'calibration_in_progress')
`,
    )
    .get() as { total: number };

  return row.total;
}
