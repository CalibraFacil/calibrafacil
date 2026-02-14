# Tenant Auth and Role Flows

This document explains how identity, organizations, and roles work after the
portal ownership hardening (3A + 3B).

## 1) Core model

- One person = one `user` record in Better Auth.
- Role is **not global**. Role is per membership (`member.role`) per organization.
- A user can have different roles in different orgs at the same time.

Example:

- Same user email can be:
  - `technician` in LAB org `A`
  - `owner` in LAB org `B`
  - `client_user` in CLIENT org `C`

This is valid and expected.

## 2) Organization types

- `LAB`: internal operations org (dashboard/web).
- `CLIENT`: customer portal org (portal app access).

Business ownership between LAB and CLIENT is modeled by
`customer.labOrganizationId` and `customer.authOrganizationId`.

## 3) What changed with 3B

- CLIENT orgs are created by a dedicated service account user id
  (`PORTAL_SERVICE_USER_ID`).
- Human LAB users are no longer required to be members/owners of CLIENT orgs to
  manage portal access.
- Portal user management uses business ownership (`customer.labOrganizationId`)
  and not leaked Better Auth owner memberships.

## 4) Why this matters

Before:

- Lab user creates CLIENT org and becomes `owner` in that CLIENT org.
- That internal owner could appear in customer portal users and be targeted by
  remove actions.

Now:

- Service account is technical owner of CLIENT org.
- Customer portal users list and management are restricted to external portal
  roles.

## 5) External vs internal roles

- External portal roles (visible/manageable in customer portal users):
  - `client_user`
- Internal roles (LAB side):
  - `owner`, `admin`, `technician`, `member`

If a role is internal, it is not shown or removable in customer portal user
management.

## 6) Cross-org identity scenarios

### Scenario A: Technician in one lab, owner in another lab

- Works naturally because role is per org membership.
- Permission checks use the active org membership for the current app/session.

### Scenario B: Same user is lab technician and also client user somewhere else

- Also valid.
- In web/lab routes, LAB auth + LAB org type checks apply.
- In portal routes, portal auth + CLIENT access role checks apply.

### Scenario C: Same user belongs to many CLIENT orgs

- Valid.
- Portal org list returns only CLIENT orgs where user has external access role.

## 7) Reconciliation and migration behavior

- A reconciliation operation can enforce CLIENT org boundary rules:
  - service account exists as owner
  - leaked internal memberships are removed from CLIENT orgs
- This is intentionally treated as a one-off migration step and is not exposed
  as a permanent public API route.

## 8) Operational guidance

- Create a dedicated service user (recommended email pattern:
  `portal@calibrafacil.com` or `portal-service@calibrafacil.com`).
- Set `PORTAL_SERVICE_USER_ID` to that user `id` in API environment.
- Keep this service user out of normal LAB memberships.
- Do not use a personal founder/admin identity long term for
  `PORTAL_SERVICE_USER_ID`.

## 9) Known caveats and guardrails

- Better Auth organization operations are sensitive to session headers and actor
  context. 3B avoids coupling CLIENT ownership to logged-in LAB users.
- Tenant safety depends on always scoping customer operations by
  `customer.labOrganizationId`.
- If `PORTAL_SERVICE_USER_ID` is missing/invalid, CLIENT org provisioning should
  fail fast.

## 10) Mental model to remember

- Identity answers: "who is this person?"
- Membership answers: "what can they do in this org?"
- Customer ownership answers: "which LAB controls this CLIENT?"

Those three are intentionally separate.
