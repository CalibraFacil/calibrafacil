import { describe, expect, it } from 'vitest'

import type { JobVerdict, JobVerdictLevel } from './detail-model'
import {
  buildVerdictTiles,
  VERDICT_EMBLEM_CLASS,
  VERDICT_PRESENTATION,
  VERDICT_TEXT_CLASS,
} from './verdict-presentation'

function verdict(overrides: Partial<JobVerdict> = {}): JobVerdict {
  return {
    level: 'conforme',
    pointsTotal: 0,
    pointsWithin: 0,
    pointsOutOfTolerance: 0,
    criteriaTotal: 0,
    criteriaPassed: 0,
    criteriaFailed: 0,
    criteriaWarning: 0,
    environment: 'unknown',
    standardsCount: 0,
    hasData: false,
    hasResults: false,
    expandedUncertainty: null,
    ...overrides,
  }
}

function tile(tiles: ReturnType<typeof buildVerdictTiles>, key: string) {
  const found = tiles.find((candidate) => candidate.key === key)
  if (!found) throw new Error(`no ${key} tile`)
  return found
}

describe('REQ-SPLIT-2 verdict presentation', () => {
  it('REQ-SPLIT-2 presents every verdict level with a label, description and tone class', () => {
    const levels: JobVerdictLevel[] = [
      'conforme',
      'nao_conforme',
      'atencao',
      'incompleto',
      'nao_avaliado',
    ]
    expect(Object.keys(VERDICT_PRESENTATION)).toHaveLength(levels.length)
    expect(Object.keys(VERDICT_PRESENTATION)).toEqual(
      expect.arrayContaining(levels),
    )
    for (const level of levels) {
      const presentation = VERDICT_PRESENTATION[level]
      expect(presentation.label).not.toBe('')
      expect(presentation.description).not.toBe('')
      expect(VERDICT_EMBLEM_CLASS[presentation.tone]).toBeTruthy()
      expect(VERDICT_TEXT_CLASS[presentation.tone]).toBeTruthy()
    }
    expect(VERDICT_PRESENTATION.nao_conforme.tone).toBe('critical')
    expect(VERDICT_PRESENTATION.conforme.tone).toBe('ok')
  })

  it('REQ-SPLIT-2 shows dashes and neutral tone for a job with no points or criteria', () => {
    const tiles = buildVerdictTiles(verdict())

    expect(tiles.map((t) => t.key)).toEqual([
      'points',
      'criteria',
      'environment',
      'traceability',
    ])
    expect(tile(tiles, 'points')).toMatchObject({
      value: '-',
      hint: 'sem pontos',
      tone: 'neutral',
    })
    expect(tile(tiles, 'criteria')).toMatchObject({
      value: '-',
      hint: 'nenhum',
      tone: 'neutral',
    })
    expect(tile(tiles, 'environment')).toMatchObject({
      value: '-',
      tone: 'neutral',
    })
    // No standards means no traceability chain: that is critical, not neutral.
    expect(tile(tiles, 'traceability')).toMatchObject({
      value: '0',
      tone: 'critical',
    })
  })

  it('REQ-SPLIT-2 flags points out of tolerance as critical and all-within as ok', () => {
    expect(
      tile(
        buildVerdictTiles(
          verdict({ pointsTotal: 5, pointsWithin: 3, pointsOutOfTolerance: 2 }),
        ),
        'points',
      ),
    ).toMatchObject({ value: '3/5', tone: 'critical' })
    expect(
      tile(
        buildVerdictTiles(verdict({ pointsTotal: 5, pointsWithin: 5 })),
        'points',
      ),
    ).toMatchObject({ value: '5/5', hint: 'pontos', tone: 'ok' })
  })

  it('REQ-SPLIT-2 ranks criteria tone failed over warning over ok', () => {
    const criteria = (overrides: Partial<JobVerdict>) =>
      tile(
        buildVerdictTiles(
          verdict({ criteriaTotal: 4, criteriaPassed: 2, ...overrides }),
        ),
        'criteria',
      )

    expect(criteria({ criteriaFailed: 1, criteriaWarning: 1 })).toMatchObject({
      value: '2/4',
      tone: 'critical',
    })
    expect(criteria({ criteriaWarning: 1 }).tone).toBe('warning')
    expect(criteria({}).tone).toBe('ok')
  })

  it('REQ-SPLIT-2 maps the environment verdict to Dentro/Fora/-', () => {
    const environment = (value: JobVerdict['environment']) =>
      tile(buildVerdictTiles(verdict({ environment: value })), 'environment')

    expect(environment('within')).toMatchObject({ value: 'Dentro', tone: 'ok' })
    expect(environment('out')).toMatchObject({ value: 'Fora', tone: 'warning' })
    expect(environment('unknown')).toMatchObject({
      value: '-',
      tone: 'neutral',
    })
  })

  it('REQ-SPLIT-2 counts the standards and only adds the uncertainty tile when U was computed', () => {
    const without = buildVerdictTiles(verdict({ standardsCount: 2 }))
    expect(tile(without, 'traceability')).toMatchObject({
      value: '2',
      tone: 'info',
    })
    expect(without.some((t) => t.key === 'uncertainty')).toBe(false)

    const withU = buildVerdictTiles(
      verdict({ standardsCount: 2, expandedUncertainty: '0,12 g' }),
    )
    expect(withU.at(-1)).toMatchObject({
      key: 'uncertainty',
      value: '0,12 g',
      hint: 'expandida',
      tone: 'neutral',
    })
  })
})
