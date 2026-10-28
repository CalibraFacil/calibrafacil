import { isCalendarDatePast, labDaysUntil } from "@calibra-facil/schemas";
import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalJobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "RENDER_FAILED"
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
    certificateName: string | null;
    customerId: number;
    customerName: string | null;
    assetId: number;
    assetName: string | null;
    assetTag: string | null;
    serviceId: number;
    serviceName: string | null;
    technicianId: string | null;
    technicianName: string | null;
    status: LocalJobStatus;
    dueDate: string | null;
    performedAt: string | null;
    approvedAt: string | null;
    isOverdue: boolean | null;
    daysUntilDue: number | null;
    createdAt: string;
    updatedAt: string;
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
  certificate_name: string | null;
  customer_local_id: string;
  customer_remote_id: number | null;
  customer_name: string | null;
  asset_local_id: string;
  asset_remote_id: number | null;
  asset_name: string | null;
  asset_tag: string | null;
  service_local_id: string;
  service_remote_id: number | null;
  service_name: string | null;
  technician_id: string | null;
  technician_name: string | null;
  status: LocalJobStatus;
  due_date: string | null;
  performed_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
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
  j.certificate_name,
  j.customer_id AS customer_local_id,
  c.remote_id AS customer_remote_id,
  c.name AS customer_name,
  j.asset_id AS asset_local_id,
  a.remote_id AS asset_remote_id,
  a.name AS asset_name,
  a.tag AS asset_tag,
  j.service_id AS service_local_id,
  s.remote_id AS service_remote_id,
  s.name AS service_name,
  j.technician_id,
  NULL AS technician_name,
  j.status,
  j.due_date,
  j.performed_at,
  j.approved_at,
  j.created_at,
  j.updated_at,
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
      certificateName: row.certificate_name,
      customerId:
        row.customer_remote_id ?? stableLocalNumericId(row.customer_local_id),
      customerName: row.customer_name,
      assetId: row.asset_remote_id ?? stableLocalNumericId(row.asset_local_id),
      assetName: row.asset_name,
      assetTag: row.asset_tag,
      serviceId:
        row.service_remote_id ?? stableLocalNumericId(row.service_local_id),
      serviceName: row.service_name,
      technicianId: row.technician_id,
      technicianName: row.technician_name,
      status: row.status,
      dueDate: row.due_date,
      performedAt: row.performed_at,
      approvedAt: row.approved_at,
      // The due date is a calendar day: overdue once that day is over in the
      // laboratory, not when its instant has passed on the UTC clock.
      isOverdue: row.due_date
        ? isCalendarDatePast(new Date(row.due_date))
        : false,
      // Whole laboratory days to the due day (negative once it is past).
      daysUntilDue: row.due_date ? labDaysUntil(new Date(row.due_date)) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
