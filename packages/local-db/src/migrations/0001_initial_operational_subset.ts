export const migration0001InitialOperationalSubset = {
  id: 1,
  name: 'initial_operational_subset',
  sql: `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_identity (
  device_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS tenant_snapshot (
  tenant_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  active_unit_id INTEGER,
  user_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  pulled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_snapshot (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  unit_id INTEGER,
  permissions_json TEXT NOT NULL,
  pulled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_types (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  measurement_family TEXT,
  specifications_schema_json TEXT,
  pulled_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  organization_id TEXT NOT NULL,
  unit_id INTEGER,
  name TEXT NOT NULL,
  tax_id TEXT,
  email TEXT,
  phone TEXT,
  address_json TEXT,
  compliance_json TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  organization_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  asset_type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  tag TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  base_measurement_unit TEXT,
  specifications_json TEXT,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  organization_id TEXT NOT NULL,
  asset_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  method_id TEXT,
  status TEXT NOT NULL,
  pulled_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS published_methods (
  id TEXT PRIMARY KEY,
  remote_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  asset_type_id TEXT,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  method_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  engine_options_fingerprint TEXT NOT NULL,
  normalized_method_json TEXT NOT NULL,
  compiled_method_json TEXT NOT NULL,
  publication_evidence_json TEXT,
  pulled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_standards (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  organization_id TEXT NOT NULL,
  unit_id INTEGER,
  name TEXT NOT NULL,
  serial_number TEXT,
  certificate_number TEXT,
  next_calibration_date TEXT,
  status TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  pulled_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environmental_limits (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  organization_id TEXT NOT NULL,
  unit_id INTEGER,
  name TEXT NOT NULL,
  limits_json TEXT NOT NULL,
  pulled_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calibration_jobs (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  job_id TEXT,
  certificate_name TEXT,
  organization_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  technician_id TEXT,
  method_snapshot_json TEXT NOT NULL,
  asset_snapshot_json TEXT NOT NULL,
  standards_snapshot_json TEXT,
  environmental_snapshot_json TEXT,
  data_json TEXT,
  results_json TEXT,
  status TEXT NOT NULL,
  due_date TEXT,
  performed_at TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  certificate_url TEXT,
  local_certificate_path TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certificate_drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  local_path TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  aggregate_kind TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  actor_user_id TEXT,
  device_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  causation_id TEXT,
  correlation_id TEXT,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  next_attempt_at TEXT
);

CREATE TABLE IF NOT EXISTS inbox_applied (
  cloud_event_id TEXT PRIMARY KEY,
  cloud_sequence INTEGER,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  scope TEXT PRIMARY KEY,
  cursor TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_payload_json TEXT NOT NULL,
  remote_payload_json TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  remote_key TEXT,
  upload_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
} as const
