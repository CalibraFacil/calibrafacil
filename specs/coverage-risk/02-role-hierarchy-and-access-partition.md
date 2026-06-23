# Mini-spec [HIGH RISK / CUT-LINE]: role hierarchy + portal/internal partition + backoffice access

Target: `packages/auth/src/access.ts` — `ROLE_HIERARCHY`, `getRoleLevel`,
`hasEqualOrHigherRole`, `INTERNAL_ROLES`, `PORTAL_ACCESS_ROLES`,
`isPortalAccessRole`/`isPortalVisibleMemberRole`/`isPortalManageableMemberRole`,
`parsePlatformRoles`, `hasPlatformRole`, `canAccessBackoffice`, `DEFAULT_ROLE`,
`DEFAULT_PLATFORM_ROLE`.
Test file: `packages/auth/src/access.spec.ts` (same file as spec 01, or a sibling
`access-roles.spec.ts`).

## CUT-LINE — pair-don't-loop discipline
Tenant/role partitioning + backoffice gate. Assert the SPEC's intended values; if code
disagrees, STOP and escalate. Do NOT modify `access.ts`.

## Oracle (intended)
- `ROLE_HIERARCHY` (low→high): `["client_user","member","operator","technician","admin","owner"]`
- `INTERNAL_ROLES`: `["member","operator","technician","admin","owner"]` (NO client_user)
- `PORTAL_ACCESS_ROLES`: `["client_user"]`
- `DEFAULT_ROLE`: `"member"`; `DEFAULT_PLATFORM_ROLE`: `"user"`
- platform roles: `user`, `platform_operator`, `platform_admin`

## Acceptance Criteria

- REQ-ROLE-001: `getRoleLevel` SHALL return each role's index in `ROLE_HIERARCHY`
  (client_user=0 … owner=5), asserted for every role.
- REQ-ROLE-002: WHEN comparing roles, `hasEqualOrHigherRole(a,b)` SHALL return `true` iff
  a's hierarchy level ≥ b's — verified with owner≥admin (true), operator≥admin (false),
  and equal roles (true). [HIGH RISK]
- REQ-ROLE-003: The system SHALL keep `client_user` OUT of `INTERNAL_ROLES` and as the ONLY
  member of `PORTAL_ACCESS_ROLES` (prevents leaking lab staff into portal screens, and
  portal clients into internal screens). Assert both lists' exact contents. [HIGH RISK]
- REQ-ROLE-004: `isPortalAccessRole` / `isPortalVisibleMemberRole` /
  `isPortalManageableMemberRole` SHALL return `true` for `"client_user"` and `false` for
  every internal role (owner/admin/technician/operator/member) and unknown strings.
  [HIGH RISK]
- REQ-ROLE-005: WHEN `parsePlatformRoles` receives null/undefined/empty/whitespace, it SHALL
  return `["user"]` (the default platform role).
- REQ-ROLE-006: WHEN `parsePlatformRoles` receives a comma list, it SHALL keep only tokens
  that are valid platform roles (trim each), drop unknown tokens, and fall back to `["user"]`
  if none remain valid. Assert e.g. `"platform_admin, bogus"` → `["platform_admin"]` and
  `"bogus"` → `["user"]`. [HIGH RISK]
- REQ-ROLE-007: `hasPlatformRole(raw, role)` SHALL be true iff `parsePlatformRoles(raw)`
  includes `role`.
- REQ-ROLE-008: `canAccessBackoffice` SHALL return `true` ONLY when the parsed platform roles
  include `platform_admin` OR `platform_operator`, and `false` for `user`-only,
  null/undefined, and unknown roles. [HIGH RISK]

## Notes
- Table-driven assertions over all 6 roles for REQ-ROLE-001/004.
- `canAccessBackoffice("user")` MUST be false — a default platform user is not backoffice.
