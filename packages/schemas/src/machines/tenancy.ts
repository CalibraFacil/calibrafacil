// Tenancy and messaging records as data.
import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";
import { defineStateMachine, type Transition } from "../state-machine";

function everyMove<S extends string, C extends string>(
  states: readonly S[],
  command: C,
): Transition<S, C>[] {
  return states.flatMap((from) =>
    states.filter((to) => to !== from).map((to) => ({ from, command, to })),
  );
}

// organization.status: a laboratory's tenancy.
//   create   sign-up / the operator CLI: ACTIVE
//   suspend  the soft delete (apps/api/src/lib/records-retention.ts, decision
//              Q16); a CHECK keeps a deleted lab SUSPENDED
// There is no reactivation in the product; an operator's audited repair is the
// way back. `OFFBOARDING` was declared once and never written: not a state.
const ORGANIZATION_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const ORGANIZATION_MACHINE = defineStateMachine({
  name: "organization",
  states: ORGANIZATION_STATUSES,
  commands: ["create", "suspend"],
  transitions: [
    { from: null, command: "create", to: "ACTIVE" },
    { from: "ACTIVE", command: "suspend", to: "SUSPENDED" },
    { from: "SUSPENDED", command: "suspend", to: "SUSPENDED" },
  ],
});

// organization_unit.status: a laboratory's unit (site).
//   create   apps/api/src/lib/units.ts (the default unit), routes/units.ts POST
//   archive / reactivate   routes/units.ts PATCH (never the default unit)
export const ORGANIZATION_UNIT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type OrganizationUnitStatus =
  (typeof ORGANIZATION_UNIT_STATUSES)[number];

export const ORGANIZATION_UNIT_MACHINE = defineStateMachine({
  name: "organization unit",
  states: ORGANIZATION_UNIT_STATUSES,
  commands: ["create", "archive", "reactivate"],
  transitions: [
    { from: null, command: "create", to: "ACTIVE" },
    { from: "ACTIVE", command: "archive", to: "ARCHIVED" },
    { from: "ARCHIVED", command: "reactivate", to: "ACTIVE" },
  ],
});

// invitation.status: a membership invitation. Better-Auth writes accept,
// reject and cancel; the portal service account (apps/api/src/lib/
// portal-service-account.ts) creates, cancels and marks expired ones. Expiry is
// also read at use time (`expiresAt`). Not guarded in Postgres: the library
// owns most writes.
const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "canceled",
  "expired",
] as const;

export const INVITATION_STATUS = defineStatusVocabulary(INVITATION_STATUSES, {
  pending: { label: "Pendente", tone: "info" },
  accepted: { label: "Aceito", tone: "ok" },
  rejected: { label: "Rejeitado", tone: "critical" },
  canceled: { label: "Cancelado", tone: "neutral" },
  expired: { label: "Expirado", tone: "critical" },
});

// organization_email_domain.status: the lab's sending domain, as the provider
// (Resend) reports it, plus `failed` when the provider no longer knows it.
//   create         apps/api/src/lib/email-domain-lifecycle.ts (provider status)
//   sync_provider  routes/email-domains.ts verify and the health cron
//                    (packages/jobs-core email-domain-health.ts): any to any
// Sending does not read this column (it reads verifiedAt / isActive / keyStatus).
const EMAIL_DOMAIN_STATUSES = [
  "pending",
  "verified",
  "failed",
  "not_started",
  "partially_verified",
  "partially_failed",
] as const;
export type OrganizationEmailDomainStatus =
  (typeof EMAIL_DOMAIN_STATUSES)[number];

export const EMAIL_DOMAIN_MACHINE = defineStateMachine({
  name: "email domain",
  states: EMAIL_DOMAIN_STATUSES,
  commands: ["create", "sync_provider"],
  transitions: [
    ...EMAIL_DOMAIN_STATUSES.map((to) => ({
      from: null,
      command: "create" as const,
      to,
    })),
    ...everyMove(EMAIL_DOMAIN_STATUSES, "sync_provider"),
  ],
});

// organization_email_domain.key_status: whether the lab's provider API key works.
//   create        ok
//   key_failure   packages/lab-email-domain (a send the provider refused for the
//                   key: invalid or rate_limited), the health cron, verify
//   key_ok        a successful health check or verify
export const EMAIL_DOMAIN_KEY_STATUSES = [
  "ok",
  "invalid",
  "rate_limited",
] as const;
export type OrganizationEmailDomainKeyStatus =
  (typeof EMAIL_DOMAIN_KEY_STATUSES)[number];

export const EMAIL_DOMAIN_KEY_MACHINE = defineStateMachine({
  name: "email domain key",
  states: EMAIL_DOMAIN_KEY_STATUSES,
  commands: ["create", "key_failure", "key_ok"],
  transitions: [
    { from: null, command: "create", to: "ok" },
    { from: "ok", command: "key_failure", to: "invalid" },
    { from: "ok", command: "key_failure", to: "rate_limited" },
    { from: "rate_limited", command: "key_failure", to: "invalid" },
    { from: "invalid", command: "key_failure", to: "rate_limited" },
    { from: "invalid", command: "key_ok", to: "ok" },
    { from: "rate_limited", command: "key_ok", to: "ok" },
  ],
});

// notification.status: an in-app notification.
//   create   packages/notifications service.ts
//   read     routes/notifications.ts, routes/portal-notifications.ts (CAS on UNREAD)
//   archive  routes/notifications.ts (read or not)
export const NOTIFICATION_STATUSES = ["UNREAD", "READ", "ARCHIVED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_MACHINE = defineStateMachine({
  name: "notification",
  states: NOTIFICATION_STATUSES,
  commands: ["create", "read", "archive"],
  transitions: [
    { from: null, command: "create", to: "UNREAD" },
    { from: "UNREAD", command: "read", to: "READ" },
    { from: "UNREAD", command: "archive", to: "ARCHIVED" },
    { from: "READ", command: "archive", to: "ARCHIVED" },
    { from: "ARCHIVED", command: "archive", to: "ARCHIVED" },
  ],
});
