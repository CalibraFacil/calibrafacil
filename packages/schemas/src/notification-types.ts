/**
 * Every notification the product sends, with the policy that does not depend on the recipient:
 * whether a portal (customer) user can receive and configure it, and whether e-mail starts on.
 * The database column, the API filters, the preference defaults and both apps read this module.
 */
export const NOTIFICATION_TYPES = [
  "JOB_SUBMITTED_FOR_REVIEW",
  "JOB_APPROVED",
  "JOB_REJECTED",
  "JOB_ASSIGNED",
  "CERTIFICATE_READY",
  "CERTIFICATE_AMENDED", // ISO 17025 Clause 7.8.8 - Certificate amendment notification
  "AUDIT_PACK_READY", // Portal audit pack (bulk certificate + fleet-status export) ready for download
  "ASSET_DUE_FOR_RECALIBRATION",
  "ASSET_DUE_FOR_LEGAL_VERIFICATION", // Legal-metrology TRACK 2 — regulation-fixed verification periodicity (Inmetro/RBMLQ-I), independent of recalibration
  "STANDARD_EXPIRING",
  "STANDARD_EXPIRED", // ISO 17025 Clause 6.4.6 - Standard expired, jobs blocked
  "SIGNING_CERTIFICATE_EXPIRING", // ICP-Brasil A1 signing certificate nearing validUntil (emission is BLOCKED once it lapses)
  "SIGNING_CERTIFICATE_LAPSED", // A certificate was NOT issued because the unit's signing certificate expired/was revoked/is missing
  "AUDIT_CHAIN_BROKEN", // The daily verifier found a break in the audit-trail hash chain (possible tampering)
  "ACCREDITATION_EXPIRING", // Cgcre/RBC accreditation vigência nearing validUntil (seal stops rendering once expired)
  "ACCREDITED_SCOPE_LINE_EXPIRING", // A scope line's vigência nearing validUntil (points stop matching once expired)
  "JOB_OVERDUE",
  "NC_CREATED", // ISO 17025 Clause 8.7 - New non-conformance registered
  "NC_ESCALATED_TO_CAPA", // ISO 17025 Clause 8.7 - NC escalated to CAPA
  "OOT_NOTIFICATION_ACKNOWLEDGED", // ISO 17025 Clause 7.10 - Customer acknowledged an out-of-tolerance notification
  "COMPETENCE_EXPIRING", // ISO 17025 Clause 6.2.3 - Competence expiring soon
  "COMPETENCE_EXPIRED", // ISO 17025 Clause 6.2.3 - Competence expired, blocks assignment
  "COMPETENCE_REQUESTED", // ISO 17025 Clause 6.2.3 - New qualification request
  "COMPETENCE_APPROVED", // ISO 17025 Clause 6.2.3 - Qualification approved
  "PT_PLAN_DUE", // ISO 17025 Clause 7.7.2 - Proficiency-test participation due for a scope part
  "ASSET_FOUND_OUT_OF_TOLERANCE", // ISO 9001 7.1.5.2 - Customer's instrument reproved as-found; impact assessment required
  "CALIBRATION_REQUEST_SUBMITTED",
  "CALIBRATION_REQUEST_UNDER_REVIEW",
  "CALIBRATION_REQUEST_APPROVED",
  "CALIBRATION_REQUEST_REJECTED",
  "CALIBRATION_REQUEST_CONVERTED",
  "VISIT_SCHEDULED", // On-site visit proposed/assigned to a technician
  "VISIT_CONFIRMED", // On-site visit confirmed (date + technician) for the customer
  "VISIT_RESCHEDULED", // On-site visit date changed
  "VISIT_CANCELLED", // On-site visit cancelled
  "VISIT_REMINDER", // On-site visit coming up soon (scheduled reminder)
  "VISIT_CUSTOMER_CONFIRMED", // Lab-bound: portal customer confirmed attendance for a visit
  "VISIT_RESCHEDULE_REQUESTED", // Lab-bound: portal customer asked to reschedule a visit
  "VISIT_RESCHEDULE_DECLINED", // Customer-bound: lab declined the customer's reschedule request
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return NOTIFICATION_TYPES.some((type) => type === value);
}

/**
 * Customer-facing types: the only ones the portal notification center lists and whose channel
 * preferences a portal user may edit. Lab-internal types (jobs, standards, competence...) must
 * never be listed or toggled from a portal session.
 */
export const PORTAL_NOTIFICATION_TYPES = [
  "CERTIFICATE_READY",
  "CERTIFICATE_AMENDED",
  "AUDIT_PACK_READY",
  "CALIBRATION_REQUEST_UNDER_REVIEW",
  "CALIBRATION_REQUEST_APPROVED",
  "CALIBRATION_REQUEST_REJECTED",
  "CALIBRATION_REQUEST_CONVERTED",
  "VISIT_CONFIRMED",
  "VISIT_RESCHEDULED",
  "VISIT_CANCELLED",
  "VISIT_REMINDER",
  "VISIT_RESCHEDULE_DECLINED",
  "ASSET_FOUND_OUT_OF_TOLERANCE",
] as const satisfies readonly NotificationType[];

export type PortalNotificationType = (typeof PORTAL_NOTIFICATION_TYPES)[number];

/** Types that start with e-mail off (in-app only) until the user turns it on. */
const EMAIL_OFF_BY_DEFAULT: readonly NotificationType[] = [
  "JOB_ASSIGNED",
  "VISIT_SCHEDULED",
  "VISIT_CUSTOMER_CONFIRMED",
];

export type NotificationChannels = { inApp: boolean; email: boolean };

/** The channels of a user who has not saved preferences yet. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Partial<
  Record<NotificationType, NotificationChannels>
> = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [
    type,
    { inApp: true, email: !EMAIL_OFF_BY_DEFAULT.includes(type) },
  ]),
);
