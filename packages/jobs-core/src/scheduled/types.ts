export interface ScheduledEnv {
  DATABASE_URL: string;
  /** The table owner: the system path that lists the laboratories (see `Env`). */
  DATABASE_OWNER_URL?: string;
  DATABASE_RLS_MODE?: "shadow" | "enforced";
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
}

// Types for database rows
export interface AssetDueRow {
  id: number;
  name: string;
  tag: string;
  customer_id: number;
  customer_name: string;
  organization_id: string;
  next_calibration_date: Date;
  days_until_due: number;
}

export interface AssetLegalVerificationDueRow {
  id: number;
  name: string;
  tag: string;
  customer_id: number;
  customer_name: string;
  organization_id: string;
  next_legal_verification_date: Date;
  days_until_due: number;
}

export interface StandardExpiringRow {
  id: number;
  name: string;
  serial_number: string;
  organization_id: string;
  next_calibration_date: Date;
  days_until_expiry: number;
}

export interface StandardExpiredRow {
  id: number;
  name: string;
  serial_number: string;
  organization_id: string;
  next_calibration_date: Date;
  days_expired: number;
}

export interface OverdueJobRow {
  id: number;
  job_id: string;
  organization_id: string;
  technician_id: string | null;
  created_by: string;
  due_date: Date;
  days_overdue: number;
}

export interface CompetenceExpiringRow {
  id: number;
  user_id: string;
  user_name: string;
  scope_description: string;
  organization_id: string;
  expires_at: Date;
  days_until_expiry: number;
}

export interface CompetenceExpiredRow {
  id: number;
  user_id: string;
  user_name: string;
  scope_description: string;
  organization_id: string;
  expires_at: Date;
  days_expired: number;
}

export interface VisitDueRow {
  id: number;
  organization_id: string;
  scheduled_at: Date;
  days_until_visit: number;
}

export interface SigningCertificateExpiringRow {
  id: number;
  organization_id: string;
  unit_id: number;
  valid_until: Date;
  // Lead windows (lead_time_days) already alerted for this certificate. Drives
  // idempotency-per-window in the pure decider.
  alerted_lead_days: number[];
}

export interface PtPlanDueRow {
  id: number;
  scope_part: string;
  organization_id: string;
  next_due_at: Date;
}

export interface AccreditationExpiringRow {
  organization_id: string;
  valid_until: Date;
  alerted_lead_days: number[];
}

export interface AccreditedScopeLineExpiringRow {
  id: number;
  organization_id: string;
  valid_until: Date;
  alerted_lead_days: number[];
}
