export const migration0003ServiceOrderWorkflowDrafts = {
  id: 3,
  name: "service_order_workflow_drafts",
  sql: `
CREATE TABLE IF NOT EXISTS service_order_quotes (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  service_order_id TEXT NOT NULL,
  quote_number TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  subtotal_services_cents INTEGER NOT NULL DEFAULT 0,
  subtotal_parts_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  freight_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  payment_terms TEXT,
  delivery_estimate TEXT,
  warranty_terms TEXT,
  client_message TEXT,
  internal_notes TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_order_quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  remote_id INTEGER,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  unit_cost_cents INTEGER,
  unit_price_cents INTEGER NOT NULL,
  total_price_cents INTEGER NOT NULL,
  taxable INTEGER NOT NULL,
  warranty_covered INTEGER NOT NULL,
  warranty_until TEXT,
  warranty_terms TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_order_executions (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  service_order_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  started_by_user_id TEXT,
  finished_at TEXT,
  finished_by_user_id TEXT,
  service_performed TEXT,
  parts_used_summary TEXT,
  technical_notes TEXT,
  calibration_required_after_repair INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_order_execution_items (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  remote_id INTEGER,
  quote_item_id TEXT,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL,
  total_price_cents INTEGER NOT NULL,
  technician_id TEXT,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_order_delivery_documents (
  id TEXT PRIMARY KEY,
  remote_id INTEGER,
  service_order_id TEXT NOT NULL,
  document_number TEXT NOT NULL,
  version INTEGER NOT NULL,
  issued_at TEXT,
  issued_by_user_id TEXT,
  technician_signature_data_json TEXT,
  client_signature_data_json TEXT,
  created_at TEXT NOT NULL,
  sync_state TEXT NOT NULL
);
`,
} as const;
