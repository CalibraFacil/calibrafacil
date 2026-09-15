# Mini-spec [HIGH RISK / CUT-LINE]: calibration approval state machine

Target: `packages/auth/src/access.ts` — `calibrationWorkflowPermissions`,
`canPerformCalibrationAction`, `getAllowedCalibrationActions`,
`CalibrationState`, `CalibrationAction`.
Test file: `packages/auth/src/access.spec.ts` (new — package has NO tests; add a
vitest config/script if missing, see notes).

## CUT-LINE — pair-don't-loop discipline

This encodes ISO/IEC 17025 separation-of-duties and "approved is immutable".
The expected matrix BELOW is the **oracle** (intended regulated behavior). Assert
the SPEC's values. **IF the production code disagrees with any value here, STOP and
escalate to a human — do NOT edit the test to match the code.** Do NOT modify
`access.ts`.

## Oracle: calibrationWorkflowPermissions (intended)

```
draft:     canEdit[operator,technician,admin,owner] canDelete[technician,admin,owner]
           canSubmit[operator,technician,admin,owner] canApprove[] canReject[]
submitted: canEdit[] canDelete[admin,owner] canSubmit[] canApprove[admin,owner] canReject[admin,owner]
in_review: canEdit[admin,owner] canDelete[] canSubmit[] canApprove[admin,owner] canReject[admin,owner]
approved:  canEdit[] canDelete[] canSubmit[] canApprove[] canReject[]
rejected:  canEdit[operator,technician,admin,owner] canDelete[technician,admin,owner]
           canSubmit[operator,technician,admin,owner] canApprove[] canReject[]
```

Roles never appearing in ANY list: `member`, `client_user`.

## Acceptance Criteria

- REQ-CAL-001: WHEN evaluating any action in state `approved`, `canPerformCalibrationAction`
  SHALL return `false` for EVERY role and EVERY action (approved is immutable — ISO 17025).
  [HIGH RISK]
- REQ-CAL-002: The system SHALL NOT permit `operator` or `technician` to `approve` or
  `reject` in ANY state (separation of duties): `canPerformCalibrationAction` SHALL return
  `false` for {operator,technician} × {approve,reject} × every CalibrationState. [HIGH RISK]
- REQ-CAL-003: The system SHALL NOT permit `member` or `client_user` to perform ANY
  calibration action in ANY state: `canPerformCalibrationAction` SHALL return `false` for
  {member,client_user} × every action × every state. [HIGH RISK]
- REQ-CAL-004: IF a calibration is `submitted`, THEN `canPerformCalibrationAction(role,
"submitted","edit")` SHALL return `false` for EVERY role (no edits after submission).
  [HIGH RISK]
- REQ-CAL-005: WHEN approving or rejecting in `submitted` or `in_review`,
  `canPerformCalibrationAction` SHALL return `true` ONLY for `admin` and `owner`, and
  `false` for all other roles. [HIGH RISK]
- REQ-CAL-006: WHEN in `draft`, `canPerformCalibrationAction(role,"draft","delete")` SHALL
  return `true` for {technician,admin,owner} and `false` for `operator` (operator may
  edit/submit a draft but not delete it). [HIGH RISK]
- REQ-CAL-007: WHEN in `draft` (and equally `rejected`), `canEdit` and `canSubmit` SHALL be
  permitted for {operator,technician,admin,owner} — i.e. a rejected calibration is revisable.
- REQ-CAL-008: The `canPerformCalibrationAction` switch SHALL map each action to its matching
  list (edit→canEdit, delete→canDelete, submit→canSubmit, approve→canApprove,
  reject→canReject) — verified by a case where two lists differ for the same state/role
  (e.g. draft: operator edit=true but delete=false). [HIGH RISK]
- REQ-CAL-009: WHEN `getAllowedCalibrationActions(role,"approved")` is called, it SHALL
  return an empty array for EVERY role. [HIGH RISK]
- REQ-CAL-010: WHEN `getAllowedCalibrationActions("owner","draft")` is called, it SHALL
  return exactly `["edit","delete","submit"]` (order as the function emits), and for
  `getAllowedCalibrationActions("admin","submitted")` exactly `["delete","approve","reject"]`.
- REQ-CAL-011: The `calibrationWorkflowPermissions` object SHALL equal the oracle matrix
  above, asserted directly (a deep-equality guard so any future edit to a single cell fails
  a test). [HIGH RISK]

## Notes for implementer

- If `packages/auth` has no vitest runner, add a minimal `vitest` devDep + `test`/`test:run`
  script + `vitest.config.ts` (mirror another package's). This is test tooling, NOT a
  production change. Report it explicitly.
- Drive REQ-CAL-001/002/003 with loops over all roles/states/actions (table-driven) so a
  single newly-permitted cell fails. This is the whole point of the spec.
