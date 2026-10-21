import { afterEach, describe, expect, it } from 'vitest'

import type { DashboardStats } from '@/features/dashboard/queries'
import {
  buildHealthSignals,
  buildPipeline,
  buildTrendSeries,
  daysUntil,
  defaultQueueView,
  formatDueDate,
  formatShortDate,
  formatStandardDue,
  selectQueueJobs,
  sumTrend,
} from './dashboard-model'

const emptyStats: DashboardStats = {
  pendingCalibrations: 0,
  approvedThisMonth: 0,
  rejectedThisMonth: 0,
  approvalRate: 100,
  expiringStandards: 0,
  overdueJobs: 0,
  dueToday: 0,
  dueNextSevenDays: 0,
  statusBreakdown: [],
  reviewQueue: [],
  standardsWatchlist: [],
  calibrationTrend: [],
  recentJobs: [],
  openNonConformances: 0,
  nonConformancesAwaitingDisposition: 0,
  capasOpen: 0,
  capasOverdue: 0,
  pendingCalibrationRequests: 0,
  serviceOrdersInProgress: 0,
  competencesExpiring: 0,
  competencesPendingEvaluation: 0,
  ptPlanOverdue: 0,
  ptRoundsPending: 0,
  spcChartsWithSignals: 0,
  dueSoonJobs: [],
}

const job = (
  id: number,
  status: DashboardStats['recentJobs'][number]['status'],
) => ({
  id,
  jobId: `CAL-${id}`,
  customerName: null,
  assetName: null,
  serviceName: null,
  technicianName: null,
  status,
  dueDate: null,
  isOverdue: false,
  createdAt: '2026-09-01T00:00:00.000Z',
})

describe('buildPipeline', () => {
  it('always yields the four open stages, even with no data', () => {
    const { stages, open } = buildPipeline(undefined)
    expect(stages.map((stage) => stage.status)).toEqual([
      'DRAFT',
      'IN_PROGRESS',
      'REVIEW',
      'GENERATING_PDF',
    ])
    expect(open).toBe(0)
    expect(
      stages.every((stage) => stage.count === 0 && stage.share === 0),
    ).toBe(true)
  })

  it('computes each stage share of the open work and ignores closed statuses', () => {
    const { stages, open } = buildPipeline([
      { status: 'DRAFT', count: 3 },
      { status: 'REVIEW', count: 1 },
      { status: 'APPROVED', count: 40 },
    ])
    expect(open).toBe(4)
    expect(stages.find((stage) => stage.status === 'DRAFT')?.share).toBe(0.75)
    expect(stages.find((stage) => stage.status === 'REVIEW')?.share).toBe(0.25)
  })
})

describe('buildHealthSignals', () => {
  it('renders a healthy lab as six ok/neutral tiles instead of hiding them', () => {
    const signals = buildHealthSignals(emptyStats)
    expect(signals).toHaveLength(6)
    expect(signals.map((signal) => signal.tone)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'neutral',
    ])
  })

  it('escalates NC to critical only when a disposition is pending', () => {
    const open = buildHealthSignals({ ...emptyStats, openNonConformances: 2 })
    expect(open[0]).toMatchObject({ value: 2, tone: 'warning' })

    const awaiting = buildHealthSignals({
      ...emptyStats,
      openNonConformances: 2,
      nonConformancesAwaitingDisposition: 1,
    })
    expect(awaiting[0]).toMatchObject({
      tone: 'critical',
      hint: '1 sem disposição',
    })
  })

  it('folds PT plan and SPC signals into one validity-of-results tile', () => {
    const [, , , , validity] = buildHealthSignals({
      ...emptyStats,
      ptPlanOverdue: 1,
      spcChartsWithSignals: 2,
    })
    expect(validity).toMatchObject({
      key: 'validity',
      value: 3,
      tone: 'critical',
      hint: '2 cartas com sinal',
    })
  })
})

describe('work queue', () => {
  it('opens managers on the review queue when something awaits them', () => {
    const stats = { ...emptyStats, reviewQueue: [job(1, 'REVIEW')] }
    expect(defaultQueueView(stats, true)).toBe('review')
    expect(defaultQueueView(stats, false)).toBe('due')
    expect(defaultQueueView(emptyStats, true)).toBe('due')
  })

  it('selects the list backing each view', () => {
    const stats = {
      ...emptyStats,
      dueSoonJobs: [job(1, 'DRAFT')],
      reviewQueue: [job(2, 'REVIEW')],
      recentJobs: [job(3, 'APPROVED')],
    }
    expect(selectQueueJobs(stats, 'due').map((item) => item.id)).toEqual([1])
    expect(selectQueueJobs(stats, 'review').map((item) => item.id)).toEqual([2])
    expect(selectQueueJobs(stats, 'recent').map((item) => item.id)).toEqual([3])
    expect(selectQueueJobs(undefined, 'due')).toEqual([])
  })
})

describe('buildTrendSeries', () => {
  const today = new Date(2026, 8, 6) // 2026-09-06 local

  it('fills every day of the window so quiet days read as zero', () => {
    const series = buildTrendSeries(
      [{ date: '2026-09-05', approved: 2, rejected: 1 }],
      30,
      today,
    )
    expect(series).toHaveLength(30)
    expect(series[0]?.date).toBe('2026-08-08')
    expect(series.at(-1)).toEqual({
      date: '2026-09-06',
      approved: 0,
      rejected: 0,
    })
    expect(series.at(-2)).toEqual({
      date: '2026-09-05',
      approved: 2,
      rejected: 1,
    })
    expect(sumTrend(series)).toEqual({ approved: 2, rejected: 1 })
  })

  it('drops points outside the window', () => {
    const series = buildTrendSeries(
      [{ date: '2026-06-01', approved: 9, rejected: 0 }],
      30,
      today,
    )
    expect(sumTrend(series)).toEqual({ approved: 0, rejected: 0 })
  })
})

describe('date labels', () => {
  const today = new Date(2026, 8, 6)

  it('describes calibration deadlines relative to today', () => {
    expect(formatDueDate(null, false, today)).toBe('Sem prazo')
    expect(formatDueDate('2026-09-06T12:00:00', false, today)).toBe('Hoje')
    expect(formatDueDate('2026-09-07T12:00:00', false, today)).toBe('Amanhã')
    expect(formatDueDate('2026-09-10T12:00:00', false, today)).toBe('Em 4 dias')
    expect(formatDueDate('2026-09-04T12:00:00', false, today)).toBe(
      'Atrasada há 2 dias',
    )
    expect(formatDueDate('2026-09-06T12:00:00', true, today)).toBe(
      'Atrasada há 1 dia',
    )
  })

  it('describes standard expiry', () => {
    expect(formatStandardDue('2026-09-06T12:00:00', today)).toBe('Vence hoje')
    expect(formatStandardDue('2026-09-20T12:00:00', today)).toBe(
      'Vence em 14 dias',
    )
    expect(formatStandardDue('2026-09-01T12:00:00', today)).toBe('Vencido')
  })
})

describe('laboratory calendar day (REQ-DATE-004)', () => {
  // 23:30 in Sao Paulo on 2026-05-20 is 02:30Z on the 21st.
  const evening = new Date('2026-05-20T23:30:00-03:00')

  afterEach(() => {
    process.env.TZ = 'America/Sao_Paulo'
  })

  it('ends the trend window on the Sao Paulo day, whatever the browser zone', () => {
    process.env.TZ = 'UTC'
    const series = buildTrendSeries(
      [{ date: '2026-05-20', approved: 3, rejected: 0 }],
      30,
      evening,
    )
    expect(series.at(-1)).toEqual({
      date: '2026-05-20',
      approved: 3,
      rejected: 0,
    })
    expect(series[0]?.date).toBe('2026-04-21')
  })

  it('counts days until a deadline from the Sao Paulo day', () => {
    process.env.TZ = 'UTC'
    // Due at noon on the 21st in Sao Paulo: tomorrow, not today.
    expect(daysUntil('2026-05-21T12:00:00-03:00', evening)).toBe(1)
    expect(formatDueDate('2026-05-20T10:00:00-03:00', false, evening)).toBe(
      'Hoje',
    )
  })
})

describe('standard expiry dates (REQ-DATE-007)', () => {
  // Typed in a date field and stored at UTC midnight: 21:00 the evening before
  // in Sao Paulo.
  const expiry = '2026-05-21T00:00:00.000Z'

  it('shows the expiry on the day that was typed', () => {
    expect(formatShortDate(expiry)).toBe('21 de mai.')
    expect(formatShortDate(null)).toBe('—')
  })

  it('counts the days from the Sao Paulo day to the day that was typed', () => {
    // The standard expires on the 21st: still a day away on the evening of
    // the 20th, due today during the 21st, expired on the 22nd.
    expect(
      formatStandardDue(expiry, new Date('2026-05-20T23:30:00-03:00')),
    ).toBe('Vence amanhã')
    expect(
      formatStandardDue(expiry, new Date('2026-05-21T09:00:00-03:00')),
    ).toBe('Vence hoje')
    expect(
      formatStandardDue(expiry, new Date('2026-05-22T09:00:00-03:00')),
    ).toBe('Vencido')
  })
})
