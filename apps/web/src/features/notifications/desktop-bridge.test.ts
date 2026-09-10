import { describe, expect, it } from 'vitest'
import type { NotificationSummary } from '@calibra-facil/client-runtime'

import { toPublishedEntries } from './desktop-bridge'

function notification(
  id: number,
  overrides: Partial<NotificationSummary> = {},
): NotificationSummary {
  return {
    id,
    type: 'JOB_SUBMITTED_FOR_REVIEW',
    priority: 'NORMAL',
    status: 'UNREAD',
    title: `Job ${id}`,
    message: 'Aguardando revisão',
    actionUrl: `/dashboard/jobs/${id}`,
    createdAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  }
}

describe('toPublishedEntries', () => {
  it('publishes only what the host needs', () => {
    // Type, priority and createdAt are in-app presentation concerns; sending
    // them over IPC would widen the payload for nothing.
    expect(toPublishedEntries([notification(1)])).toEqual([
      {
        id: 1,
        title: 'Job 1',
        message: 'Aguardando revisão',
        status: 'UNREAD',
        actionUrl: '/dashboard/jobs/1',
      },
    ])
  })

  it('normalizes a missing action URL to null', () => {
    // `undefined` would be dropped by JSON serialization across IPC and the
    // host's schema expects the key to be absent or null, not missing-then-
    // present depending on the row.
    expect(
      toPublishedEntries([notification(2, { actionUrl: undefined })])[0]
        ?.actionUrl,
    ).toBeNull()
  })

  it('caps the payload the host receives', () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      notification(index + 1),
    )

    expect(toPublishedEntries(many)).toHaveLength(20)
  })

  it('keeps the newest entries when capping', () => {
    // The feed is newest-first, so the cap must take from the front.
    const many = Array.from({ length: 50 }, (_, index) =>
      notification(index + 1),
    )

    expect(toPublishedEntries(many)[0]?.id).toBe(1)
  })

  it('is safe on an empty feed', () => {
    expect(toPublishedEntries([])).toEqual([])
  })
})
