// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearExecutionDraft,
  EXECUTION_DRAFT_VERSION,
  executionDraftKey,
  hashExecutionValues,
  isExecutionFormDirty,
  readExecutionDraft,
  resolveExecutionDraftOffer,
  writeExecutionDraft,
  type ExecutionDraftScope,
  type ExecutionFormValues,
} from './execution-draft'

function values(overrides: Partial<ExecutionFormValues> = {}) {
  return {
    formData: { load: 10, readings: [{ indication: 9.99 }] },
    selectedStandardIds: [1, 2],
    environment: { temperature: 21.5, humidity: null, pressure: null },
    calibrationLocation: { type: 'lab', addressText: 'Rua Laboratorio' },
    calibrationPhases: { blocks: {} },
    performedAt: '2026-05-20',
    backdateReason: '',
    methodDeviations: '',
    ...overrides,
  } satisfies ExecutionFormValues
}

const scope = {
  organizationId: 'org-1',
  userId: 'user-1',
  jobId: '7',
} satisfies ExecutionDraftScope

describe('execution draft model', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  describe('REQ-P07-1 dirty detection', () => {
    it('REQ-P07-1: equal values are clean even when they are different objects', () => {
      expect(isExecutionFormDirty(values(), values())).toBe(false)
    })

    it('REQ-P07-1: a changed reading nested in a table makes the form dirty', () => {
      expect(
        isExecutionFormDirty(
          values({
            formData: { load: 10, readings: [{ indication: 10.01 }] },
          }),
          values(),
        ),
      ).toBe(true)
    })

    it('REQ-P07-1: a typed value reverted to the saved one is clean again', () => {
      const baseline = values()
      const edited = values({ methodDeviations: 'x' })
      expect(isExecutionFormDirty(edited, baseline)).toBe(true)
      expect(
        isExecutionFormDirty(values({ methodDeviations: '' }), baseline),
      ).toBe(false)
    })

    it('REQ-P07-1: typed text equal to the saved number is not an edit, but different text is', () => {
      const baseline = values({ formData: { load: 10 } })
      expect(
        isExecutionFormDirty(values({ formData: { load: '10' } }), baseline),
      ).toBe(false)
      expect(
        isExecutionFormDirty(values({ formData: { load: '10.0' } }), baseline),
      ).toBe(true)
      expect(
        isExecutionFormDirty(values({ formData: { load: '10.' } }), baseline),
      ).toBe(true)
      expect(
        isExecutionFormDirty(values({ formData: { load: '' } }), baseline),
      ).toBe(true)
    })

    it('REQ-P07-1: key order and undefined-valued keys do not count as changes', () => {
      expect(
        isExecutionFormDirty(
          values({ formData: { b: 2, a: 1, ghost: undefined } }),
          values({ formData: { a: 1, b: 2 } }),
        ),
      ).toBe(false)
    })

    it('REQ-P07-1: changes to any section (standards, environment, phases, date) are dirty', () => {
      const baseline = values()
      expect(
        isExecutionFormDirty(values({ selectedStandardIds: [1] }), baseline),
      ).toBe(true)
      expect(
        isExecutionFormDirty(
          values({
            environment: { temperature: 22, humidity: null, pressure: null },
          }),
          baseline,
        ),
      ).toBe(true)
      expect(
        isExecutionFormDirty(
          values({
            calibrationPhases: {
              blocks: { a: { mode: 'not_performed', reason: 'x' } },
            },
          }),
          baseline,
        ),
      ).toBe(true)
      expect(
        isExecutionFormDirty(values({ performedAt: '2026-05-21' }), baseline),
      ).toBe(true)
    })
  })

  describe('REQ-P07-3 draft storage', () => {
    it('REQ-P07-3: the key is versioned and scoped by organization, job and user', () => {
      expect(executionDraftKey(scope)).toBe(
        `calibra:execution-draft:v${EXECUTION_DRAFT_VERSION}:org-1:7:user-1`,
      )
      const keys = new Set([
        executionDraftKey(scope),
        executionDraftKey({ ...scope, organizationId: 'org-2' }),
        executionDraftKey({ ...scope, userId: 'user-2' }),
        executionDraftKey({ ...scope, jobId: '8' }),
      ])
      expect(keys.size).toBe(4)
    })

    it('REQ-P07-3: ids containing the separator cannot collide across scopes', () => {
      expect(
        executionDraftKey({ organizationId: 'a:b', userId: 'c', jobId: '1' }),
      ).not.toBe(
        executionDraftKey({ organizationId: 'a', userId: 'c', jobId: 'b:1' }),
      )
    })

    it('REQ-P07-3: a written draft reads back with its values', () => {
      expect(
        writeExecutionDraft({
          scope,
          values: values(),
          baseUpdatedAt: '2026-05-20T10:00:00.000Z',
          now: 1_000,
        }),
      ).toBe(true)

      expect(readExecutionDraft(scope)).toEqual({
        version: EXECUTION_DRAFT_VERSION,
        organizationId: 'org-1',
        userId: 'user-1',
        jobId: '7',
        savedAt: 1_000,
        baseUpdatedAt: '2026-05-20T10:00:00.000Z',
        values: values(),
      })
    })

    it('REQ-P07-3: stores only the form values, nothing else from the job', () => {
      writeExecutionDraft({
        scope,
        values: values(),
        baseUpdatedAt: null,
        now: 1,
      })
      const raw = window.localStorage.getItem(executionDraftKey(scope))
      expect(raw).not.toBeNull()
      // oxlint-disable-next-line unicorn/no-array-sort -- fresh array; no toSorted in the lib target
      expect(Object.keys(JSON.parse(raw ?? '{}')).sort()).toEqual([
        'baseUpdatedAt',
        'jobId',
        'organizationId',
        'savedAt',
        'userId',
        'values',
        'version',
      ])
      expect(window.localStorage).toHaveLength(1)
    })

    it('REQ-P07-3: another org or user never reads this draft', () => {
      writeExecutionDraft({
        scope,
        values: values(),
        baseUpdatedAt: null,
        now: 1,
      })
      expect(
        readExecutionDraft({ ...scope, organizationId: 'org-2' }),
      ).toBeNull()
      expect(readExecutionDraft({ ...scope, userId: 'user-2' })).toBeNull()
      expect(readExecutionDraft({ ...scope, jobId: '8' })).toBeNull()
    })

    it('REQ-P07-3: a payload planted under the key for a different scope is rejected', () => {
      writeExecutionDraft({
        scope: { ...scope, organizationId: 'org-2' },
        values: values(),
        baseUpdatedAt: null,
        now: 1,
      })
      const foreign = window.localStorage.getItem(
        executionDraftKey({ ...scope, organizationId: 'org-2' }),
      )
      window.localStorage.setItem(executionDraftKey(scope), foreign ?? '')
      expect(readExecutionDraft(scope)).toBeNull()
    })

    it('REQ-P07-3: drafts written under an old schema version are ignored', () => {
      const oldKey = `calibra:execution-draft:v0:org-1:7:user-1`
      window.localStorage.setItem(
        oldKey,
        JSON.stringify({ version: 0, values: values() }),
      )
      expect(readExecutionDraft(scope)).toBeNull()

      // Same key, but the payload claims another version.
      window.localStorage.setItem(
        executionDraftKey(scope),
        JSON.stringify({
          version: EXECUTION_DRAFT_VERSION + 1,
          organizationId: 'org-1',
          userId: 'user-1',
          jobId: '7',
          savedAt: 1,
          baseUpdatedAt: null,
          values: values(),
        }),
      )
      expect(readExecutionDraft(scope)).toBeNull()
    })

    it('REQ-P07-3: corrupt or malformed payloads are ignored instead of throwing', () => {
      window.localStorage.setItem(executionDraftKey(scope), '{not json')
      expect(readExecutionDraft(scope)).toBeNull()
      window.localStorage.setItem(
        executionDraftKey(scope),
        JSON.stringify({ version: EXECUTION_DRAFT_VERSION, values: 3 }),
      )
      expect(readExecutionDraft(scope)).toBeNull()
    })

    it('REQ-P07-3: clearing removes only this scope', () => {
      writeExecutionDraft({
        scope,
        values: values(),
        baseUpdatedAt: null,
        now: 1,
      })
      writeExecutionDraft({
        scope: { ...scope, jobId: '8' },
        values: values(),
        baseUpdatedAt: null,
        now: 1,
      })
      clearExecutionDraft(scope)
      expect(readExecutionDraft(scope)).toBeNull()
      expect(readExecutionDraft({ ...scope, jobId: '8' })).not.toBeNull()
    })

    it('REQ-P07-3: a failing storage never throws', () => {
      const broken = {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('quota')
        },
        removeItem: () => {
          throw new Error('denied')
        },
      }
      expect(
        writeExecutionDraft({
          scope,
          values: values(),
          baseUpdatedAt: null,
          now: 1,
          storage: broken,
        }),
      ).toBe(false)
      expect(readExecutionDraft(scope, broken)).toBeNull()
      expect(() => clearExecutionDraft(scope, broken)).not.toThrow()
    })
  })

  describe('REQ-P07-3 restore offer', () => {
    const serverUpdatedAt = '2026-05-20T10:00:00.000Z'
    const serverMs = Date.parse(serverUpdatedAt)

    it('REQ-P07-3: offers a draft saved after the server data and different from it', () => {
      const draft = values({ methodDeviations: 'typed' })
      writeExecutionDraft({
        scope,
        values: draft,
        baseUpdatedAt: serverUpdatedAt,
        now: serverMs + 60_000,
      })
      expect(
        resolveExecutionDraftOffer({
          scope,
          baseline: values(),
          serverUpdatedAt,
        }),
      ).toEqual(draft)
    })

    it('REQ-P07-3: does not offer a draft older than the server data', () => {
      writeExecutionDraft({
        scope,
        values: values({ methodDeviations: 'typed' }),
        baseUpdatedAt: '2026-05-19T10:00:00.000Z',
        now: serverMs - 60_000,
      })
      expect(
        resolveExecutionDraftOffer({
          scope,
          baseline: values(),
          serverUpdatedAt,
        }),
      ).toBeNull()
    })

    it('REQ-P07-3: does not offer a draft identical to the server data', () => {
      writeExecutionDraft({
        scope,
        values: values(),
        baseUpdatedAt: serverUpdatedAt,
        now: serverMs + 60_000,
      })
      expect(
        resolveExecutionDraftOffer({
          scope,
          baseline: values(),
          serverUpdatedAt,
        }),
      ).toBeNull()
    })

    it('REQ-P07-3: a draft built on the current server version is offered even if the client clock lags', () => {
      const draft = values({ methodDeviations: 'typed' })
      writeExecutionDraft({
        scope,
        values: draft,
        baseUpdatedAt: serverUpdatedAt,
        now: serverMs - 5 * 60_000,
      })
      expect(
        resolveExecutionDraftOffer({
          scope,
          baseline: values(),
          serverUpdatedAt,
        }),
      ).toEqual(draft)
    })

    it('REQ-P07-3: offers nothing when there is no draft for this scope', () => {
      expect(
        resolveExecutionDraftOffer({
          scope,
          baseline: values(),
          serverUpdatedAt,
        }),
      ).toBeNull()
    })
  })

  it('REQ-P07-3: the content hash is stable across key order and changes with values', () => {
    expect(hashExecutionValues(values({ formData: { a: 1, b: 2 } }))).toBe(
      hashExecutionValues(values({ formData: { b: 2, a: 1 } })),
    )
    expect(hashExecutionValues(values())).not.toBe(
      hashExecutionValues(values({ methodDeviations: 'x' })),
    )
  })
})
