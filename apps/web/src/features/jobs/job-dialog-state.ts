import { useReducer, type SetStateAction } from 'react'

// The job page's action dialogs as ONE state: which dialog is open and the
// fields that belong to it. It replaces four independent `open` flags and five
// field states that could disagree: two dialogs open at once, a scope-violation
// block (and its override text) surviving a "Cancelar" so the dialog reopened
// offering "Aprovar sem selo" without the server having refused anything, or a
// reason typed for one job carried into the next dialog. Opening a dialog
// starts it fresh; closing it forgets everything.

export type JobDialogKind = 'approve' | 'reject' | 'cancel' | 'assign'

export type JobDialogState =
  | { kind: 'closed' }
  | {
      kind: 'approve'
      envJustification: string
      // The server answered SCOPE_VIOLATION: the dialog offers the documented
      // override (issue without the accreditation seal).
      scopeViolationBlocked: boolean
      scopeOverrideJustification: string
    }
  | { kind: 'reject'; reason: string }
  | { kind: 'cancel'; reason: string }
  | { kind: 'assign'; technicianId: string }

export type JobDialogTextField =
  | 'envJustification'
  | 'scopeOverrideJustification'
  | 'rejectReason'
  | 'cancelReason'
  | 'technicianId'

export type JobDialogAction =
  | { type: 'open'; dialog: JobDialogKind }
  | { type: 'close' }
  | { type: 'set_text'; field: JobDialogTextField; value: string }
  | { type: 'scope_blocked'; blocked: boolean }

export const CLOSED_JOB_DIALOG: JobDialogState = { kind: 'closed' }

function freshDialog(kind: JobDialogKind): JobDialogState {
  switch (kind) {
    case 'approve':
      return {
        kind,
        envJustification: '',
        scopeViolationBlocked: false,
        scopeOverrideJustification: '',
      }
    case 'reject':
      return { kind, reason: '' }
    case 'cancel':
      return { kind, reason: '' }
    case 'assign':
      return { kind, technicianId: '' }
  }
}

export function jobDialogReducer(
  state: JobDialogState,
  action: JobDialogAction,
): JobDialogState {
  switch (action.type) {
    case 'open':
      return state.kind === action.dialog ? state : freshDialog(action.dialog)
    case 'close':
      return CLOSED_JOB_DIALOG
    case 'scope_blocked':
      return state.kind === 'approve'
        ? {
            ...state,
            scopeViolationBlocked: action.blocked,
            scopeOverrideJustification: action.blocked
              ? state.scopeOverrideJustification
              : '',
          }
        : state
    case 'set_text': {
      const { field, value } = action
      if (state.kind === 'approve' && field === 'envJustification') {
        return { ...state, envJustification: value }
      }
      if (
        state.kind === 'approve' &&
        field === 'scopeOverrideJustification' &&
        state.scopeViolationBlocked
      ) {
        return { ...state, scopeOverrideJustification: value }
      }
      if (state.kind === 'reject' && field === 'rejectReason') {
        return { ...state, reason: value }
      }
      if (state.kind === 'cancel' && field === 'cancelReason') {
        return { ...state, reason: value }
      }
      if (state.kind === 'assign' && field === 'technicianId') {
        return { ...state, technicianId: value }
      }
      // A field of a dialog that is not open: nothing to keep.
      return state
    }
  }
}

function isUpdater<T extends string | boolean>(
  value: SetStateAction<T>,
): value is (previous: T) => T {
  return typeof value === 'function'
}

function resolve<T extends string | boolean>(
  value: SetStateAction<T>,
  current: T,
): T {
  return isUpdater(value) ? value(current) : value
}

/**
 * The reducer with the value/setter pairs the dialog components take, so they
 * stay plain controlled components.
 */
export function useJobDialogs() {
  const [state, dispatch] = useReducer(jobDialogReducer, CLOSED_JOB_DIALOG)

  const openSetter =
    (dialog: JobDialogKind) => (value: SetStateAction<boolean>) => {
      const open = resolve(value, state.kind === dialog)
      dispatch(open ? { type: 'open', dialog } : { type: 'close' })
    }
  const textSetter =
    (field: JobDialogTextField, current: string) =>
    (value: SetStateAction<string>) => {
      dispatch({ type: 'set_text', field, value: resolve(value, current) })
    }

  const envJustification =
    state.kind === 'approve' ? state.envJustification : ''
  const scopeViolationBlocked =
    state.kind === 'approve' && state.scopeViolationBlocked
  const scopeOverrideJustification =
    state.kind === 'approve' ? state.scopeOverrideJustification : ''
  const rejectReason = state.kind === 'reject' ? state.reason : ''
  const cancelReason = state.kind === 'cancel' ? state.reason : ''
  const selectedTechnician = state.kind === 'assign' ? state.technicianId : ''

  return {
    state,
    dispatch,
    approveDialogOpen: state.kind === 'approve',
    setApproveDialogOpen: openSetter('approve'),
    rejectDialogOpen: state.kind === 'reject',
    setRejectDialogOpen: openSetter('reject'),
    cancelDialogOpen: state.kind === 'cancel',
    setCancelDialogOpen: openSetter('cancel'),
    assignDialogOpen: state.kind === 'assign',
    setAssignDialogOpen: openSetter('assign'),
    envJustification,
    setEnvJustification: textSetter('envJustification', envJustification),
    scopeViolationBlocked,
    setScopeViolationBlocked: (value: SetStateAction<boolean>) =>
      dispatch({
        type: 'scope_blocked',
        blocked: resolve(value, scopeViolationBlocked),
      }),
    scopeOverrideJustification,
    setScopeOverrideJustification: textSetter(
      'scopeOverrideJustification',
      scopeOverrideJustification,
    ),
    rejectReason,
    setRejectReason: textSetter('rejectReason', rejectReason),
    cancelReason,
    setCancelReason: textSetter('cancelReason', cancelReason),
    selectedTechnician,
    setSelectedTechnician: textSetter('technicianId', selectedTechnician),
  }
}
