import { describe, expect, it } from 'vitest'
import {
  CLOSED_JOB_DIALOG,
  jobDialogReducer,
  type JobDialogAction,
  type JobDialogState,
} from './job-dialog-state'

function run(actions: JobDialogAction[]): JobDialogState {
  return actions.reduce(jobDialogReducer, CLOSED_JOB_DIALOG)
}

describe('jobDialogReducer', () => {
  it('a scope block and its override do not survive closing the approve dialog', () => {
    const state = run([
      { type: 'open', dialog: 'approve' },
      { type: 'set_text', field: 'envJustification', value: 'umidade alta' },
      { type: 'scope_blocked', blocked: true },
      { type: 'set_text', field: 'scopeOverrideJustification', value: 'ok' },
      { type: 'close' },
      { type: 'open', dialog: 'approve' },
    ])
    expect(state).toEqual({
      kind: 'approve',
      envJustification: '',
      scopeViolationBlocked: false,
      scopeOverrideJustification: '',
    })
  })

  it('only one dialog is open; switching starts the other fresh', () => {
    const state = run([
      { type: 'open', dialog: 'reject' },
      { type: 'set_text', field: 'rejectReason', value: 'leituras faltando' },
      { type: 'open', dialog: 'cancel' },
    ])
    expect(state).toEqual({ kind: 'cancel', reason: '' })
  })

  it('a field of a closed dialog, or an override without a block, is ignored', () => {
    expect(
      run([{ type: 'set_text', field: 'cancelReason', value: 'x' }]),
    ).toEqual(CLOSED_JOB_DIALOG)
    expect(
      run([
        { type: 'open', dialog: 'approve' },
        { type: 'set_text', field: 'scopeOverrideJustification', value: 'x' },
      ]),
    ).toMatchObject({ scopeOverrideJustification: '' })
  })
})
