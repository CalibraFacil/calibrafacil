import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalJobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "SUPERSEDED";

export type LocalJobsListInput = {
  page: number;
  limit: number;
  customerId?: number;
  query?: string;
  status?: LocalJobStatus;
};

export type LocalJobsListData = {
  data: Array<{
    id: number;
    jobId: string;
    customerName: string | null;
    assetName: string | null;
    serviceName: string | null;
    technicianName: string | null;
    status: LocalJobStatus;
    dueDate: string | null;
    isOverdue: boolean | null;
    createdAt: string;
    syncState: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type LocalJobProjectionInput = {
  id: string;
  remoteId?: number | null;
  jobId: string;
  organizationId: string;
  unitId: number;
  customerId: string;
  assetId: string;
  serviceId: string;
  technicianId?: string | null;
  methodSnapshotJson?: string;
  assetSnapshotJson?: string;
  standardsSnapshotJson?: string | null;
  environmentalSnapshotJson?: string | null;
  calibrationLocationSnapshotJson?: string | null;
  calibrationPhaseSnapshotJson?: string | null;
  dataJson?: string | null;
  resultsJson?: string | null;
  status: LocalJobStatus;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
  syncState?: string;
};

type LocalJobListRow = {
  remote_id: number | null;
  local_id: string;
  job_id: string | null;
  customer_name: string | null;
  asset_name: string | null;
  service_name: string | null;
  technician_name: string | null;
  status: LocalJobStatus;
  due_date: string | null;
  created_at: string;
  sync_state: string;
};

export function listLocalJobs(
  database: LocalDatabase,
  input: LocalJobsListInput,
): LocalJobsListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions: string[] = ["j.deleted_at IS NULL"];
  const params: Record<string, string | number> = {};

  if (input.customerId) {
    const customerId = resolveLocalCustomerId(database, input.customerId);
    if (customerId) {
      conditions.push("j.customer_id = @customerId");
      params.customerId = customerId;
    } else {
      conditions.push("1 = 0");
    }
  }

  if (input.status) {
    conditions.push("j.status = @status");
    params.status = input.status;
  }

  if (input.query) {
    conditions.push(`(
      j.job_id LIKE @query OR
      c.name LIKE @query OR
      a.name LIKE @query OR
      a.serial_number LIKE @query
    )`);
    params.query = `%${input.query}%`;
  }

  const whereClause = conditions.join(" AND ");
  const totalRow = database
    .prepare<typeof params, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM calibration_jobs j
LEFT JOIN customers c ON c.id = j.customer_id
LEFT JOIN assets a ON a.id = j.asset_id
LEFT JOIN services s ON s.id = j.service_id
WHERE ${whereClause}
`,
    )
    .get(params);

  const pageParams = { ...params, limit, offset };
  const rows = database
    .prepare<typeof pageParams, LocalJobListRow>(
      `
SELECT
  j.remote_id,
  j.id AS local_id,
  j.job_id,
  c.name AS customer_name,
  a.name AS asset_name,
  s.name AS service_name,
  NULL AS technician_name,
  j.status,
  j.due_date,
  j.created_at,
  j.sync_state
FROM calibration_jobs j
LEFT JOIN customers c ON c.id = j.customer_id
LEFT JOIN assets a ON a.id = j.asset_id
LEFT JOIN services s ON s.id = j.service_id
WHERE ${whereClause}
ORDER BY j.created_at DESC
LIMIT @limit OFFSET @offset
`,
    )
    .all(pageParams);

  return {
    data: rows.map((row) => ({
      id: row.remote_id ?? stableLocalNumericId(row.local_id),
      jobId: row.job_id ?? row.local_id,
      customerName: row.customer_name,
      assetName: row.asset_name,
      serviceName: row.service_name,
      technicianName: row.technician_name,
      status: row.status,
      dueDate: row.due_date,
      isOverdue: row.due_date ? row.due_date < new Date().toISOString() : false,
      createdAt: row.created_at,
      syncState: row.sync_state,
    })),
    pagination: {
      page,
      limit,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / limit),
    },
  };
}

function resolveLocalCustomerId(database: LocalDatabase, numericId: number) {
  const remoteRow = database
    .prepare<
      { remoteId: number },
      { id: string }
    >("SELECT id FROM customers WHERE remote_id = @remoteId LIMIT 1")
    .get({ remoteId: numericId });
  if (remoteRow) return remoteRow.id;

  const rows = database
    .prepare<[], { id: string }>("SELECT id FROM customers")
    .all();
  return (
    rows.find((row) => stableLocalNumericId(row.id) === numericId)?.id ?? null
  );
}

export function upsertLocalJobProjection(
  database: LocalDatabase,
  job: LocalJobProjectionInput,
) {
  database
    .prepare(
      `
INSERT INTO calibration_jobs (
  id,
  remote_id,
  job_id,
  certificate_name,
  organization_id,
  unit_id,
  customer_id,
  asset_id,
  service_id,
  technician_id,
  method_snapshot_json,
  asset_snapshot_json,
  standards_snapshot_json,
  environmental_snapshot_json,
  calibration_location_snapshot_json,
  calibration_phase_snapshot_json,
  data_json,
  results_json,
  status,
  due_date,
  version,
  created_at,
  updated_at,
  sync_state
) VALUES (
  @id,
  @remoteId,
  @jobId,
  NULL,
  @organizationId,
  @unitId,
  @customerId,
  @assetId,
  @serviceId,
  @technicianId,
  @methodSnapshotJson,
  @assetSnapshotJson,
  @standardsSnapshotJson,
  @environmentalSnapshotJson,
  @calibrationLocationSnapshotJson,
  @calibrationPhaseSnapshotJson,
  @dataJson,
  @resultsJson,
  @status,
  @dueDate,
  0,
  @createdAt,
  @updatedAt,
  @syncState
)
ON CONFLICT(id) DO UPDATE SET
  remote_id = excluded.remote_id,
  job_id = excluded.job_id,
  customer_id = excluded.customer_id,
  asset_id = excluded.asset_id,
  service_id = excluded.service_id,
  technician_id = excluded.technician_id,
  method_snapshot_json = excluded.method_snapshot_json,
  asset_snapshot_json = excluded.asset_snapshot_json,
  standards_snapshot_json = excluded.standards_snapshot_json,
  environmental_snapshot_json = excluded.environmental_snapshot_json,
  calibration_location_snapshot_json = excluded.calibration_location_snapshot_json,
  calibration_phase_snapshot_json = excluded.calibration_phase_snapshot_json,
  data_json = excluded.data_json,
  results_json = excluded.results_json,
  status = excluded.status,
  due_date = excluded.due_date,
  updated_at = excluded.updated_at,
  sync_state = excluded.sync_state
`,
    )
    .run({
      remoteId: job.remoteId ?? null,
      technicianId: job.technicianId ?? null,
      methodSnapshotJson: job.methodSnapshotJson ?? "{}",
      assetSnapshotJson: job.assetSnapshotJson ?? "{}",
      standardsSnapshotJson: job.standardsSnapshotJson ?? null,
      environmentalSnapshotJson: job.environmentalSnapshotJson ?? null,
      calibrationLocationSnapshotJson:
        job.calibrationLocationSnapshotJson ?? null,
      calibrationPhaseSnapshotJson: job.calibrationPhaseSnapshotJson ?? null,
      dataJson: job.dataJson ?? null,
      resultsJson: job.resultsJson ?? null,
      dueDate: job.dueDate ?? null,
      syncState: job.syncState ?? "local",
      ...job,
    });
}
