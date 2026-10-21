import { describe, expect, it } from 'vitest'

import type { AssignableTrainingRecord } from './types'
import {
  canCancelCompetenceStatus,
  canRenewCompetenceStatus,
  createCompetenceEvaluationPayload,
  createTrainingRecordPayload,
  filterAssignableTrainingRecords,
  formatCompetenceDate,
  getCompetenceWorkflowStepIndex,
  getTodayDateInputValue,
  isTerminalInactiveStatus,
  isTrainingType,
  isWorkflowStepCompleted,
  isWorkflowStepCurrent,
  toggleTrainingSelection,
  TRAINING_STATUS_LABELS,
  TRAINING_TYPE_LABELS,
} from './detail-model'

describe('personnel detail model', () => {
  it('formats competence dates and date input values', () => {
    expect(formatCompetenceDate(null)).toBe('-')
    expect(formatCompetenceDate('2026-05-20T12:00:00.000Z')).toBe('20/05/2026')
    expect(getTodayDateInputValue(new Date('2026-05-20T12:00:00.000Z'))).toBe(
      '2026-05-20',
    )
  })

  it('keeps workflow status rules in the feature layer', () => {
    expect(getCompetenceWorkflowStepIndex('IN_TRAINING')).toBe(2)
    expect(isWorkflowStepCompleted('PENDING_EVALUATION', 1)).toBe(true)
    expect(isWorkflowStepCurrent('ACTIVE', 'ACTIVE')).toBe(true)
    expect(isTerminalInactiveStatus('CANCELLED')).toBe(true)
    expect(isTerminalInactiveStatus('ACTIVE')).toBe(false)
    expect(canCancelCompetenceStatus('PENDING_EVALUATION')).toBe(true)
    expect(canCancelCompetenceStatus('ACTIVE')).toBe(false)
    expect(canRenewCompetenceStatus('EXPIRED')).toBe(true)
    expect(canRenewCompetenceStatus('REQUESTED')).toBe(false)
  })

  it('filters and toggles assignable training records', () => {
    const records: AssignableTrainingRecord[] = [
      trainingRecord({ id: 1, competenceId: null }),
      trainingRecord({ id: 2, competenceId: 42 }),
      trainingRecord({ id: 3, competenceId: 99 }),
    ]

    expect(
      filterAssignableTrainingRecords(records, '42').map((item) => item.id),
    ).toEqual([1, 2])
    expect(toggleTrainingSelection([1], 2, true)).toEqual([1, 2])
    expect(toggleTrainingSelection([1, 2], 2, true)).toEqual([1, 2])
    expect(toggleTrainingSelection([1, 2], 1, false)).toEqual([2])
  })

  it('builds training and evaluation payloads', () => {
    expect(isTrainingType('internal')).toBe(true)
    expect(isTrainingType('invalid')).toBe(false)
    expect(TRAINING_TYPE_LABELS.ojt).toBe('Em Serviço')
    expect(TRAINING_STATUS_LABELS.completed).toBe('Concluído')
    expect(
      createTrainingRecordPayload({
        userId: 'user-1',
        title: '  Treinamento  ',
        type: 'internal',
        provider: '  SENAI  ',
        description: '  Conteudo  ',
        startDate: '2026-05-20',
        endDate: '',
      }),
    ).toEqual({
      userId: 'user-1',
      title: 'Treinamento',
      type: 'internal',
      provider: 'SENAI',
      description: 'Conteudo',
      // A date field names a day in the user's own time zone.
      startDate: new Date(2026, 4, 20).toISOString(),
      endDate: undefined,
    })

    expect(
      createCompetenceEvaluationPayload({
        passed: true,
        notes: '',
        expiresAt: '2027-05-20',
        now: new Date('2026-05-20T10:00:00.000Z'),
      }),
    ).toEqual({
      passed: true,
      notes: undefined,
      qualifiedAt: '2026-05-20T10:00:00.000Z',
      expiresAt: new Date(2027, 4, 20).toISOString(),
    })
    expect(
      createCompetenceEvaluationPayload({
        passed: false,
        notes: 'Reavaliar',
        expiresAt: '2027-05-20',
      }),
    ).toEqual({
      passed: false,
      notes: 'Reavaliar',
      qualifiedAt: undefined,
      expiresAt: undefined,
    })
  })

  it('shows the day typed into a date field back on that same day', () => {
    const training = createTrainingRecordPayload({
      userId: 'user-1',
      title: 'Treinamento',
      type: 'internal',
      provider: '',
      description: '',
      startDate: '2026-05-20',
      endDate: '2026-05-22',
    })
    const evaluation = createCompetenceEvaluationPayload({
      passed: true,
      notes: '',
      expiresAt: '2027-05-20',
    })

    expect(formatCompetenceDate(training.startDate)).toBe('20/05/2026')
    expect(formatCompetenceDate(training.endDate)).toBe('22/05/2026')
    expect(formatCompetenceDate(evaluation.expiresAt)).toBe('20/05/2027')
  })
})

function trainingRecord(
  overrides: Partial<AssignableTrainingRecord>,
): AssignableTrainingRecord {
  return {
    id: 1,
    userId: 'user-1',
    competenceId: null,
    title: 'Treinamento',
    type: 'internal',
    status: 'planned',
    provider: null,
    startDate: '2026-05-20T00:00:00.000Z',
    endDate: null,
    hoursCompleted: null,
    ...overrides,
  }
}
