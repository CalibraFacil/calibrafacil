import { describe, expect, it } from 'vitest'

import {
  buildSyncConflictFieldDiffs,
  getSyncConflictEditTarget,
} from './sync-conflict-actions'

describe('getSyncConflictEditTarget', () => {
  it.each([
    [
      'customer',
      'customer:local-1',
      { kind: 'customer', id: 'customer:local-1' },
    ],
    ['asset', 'asset:local-1', { kind: 'asset', id: 'asset:local-1' }],
    [
      'calibration_job',
      'job:local-1',
      { kind: 'calibration_job', id: 'job:local-1' },
    ],
    [
      'service_order',
      'service-order:local-1',
      { kind: 'service_order', id: 'service-order:local-1' },
    ],
  ])('maps %s conflicts to an edit target', (entityType, entityId, target) => {
    expect(getSyncConflictEditTarget({ entityType, entityId })).toEqual(target)
  })

  it('returns null when the entity is not editable from the conflict screen', () => {
    expect(
      getSyncConflictEditTarget({
        entityType: 'attachment',
        entityId: 'attachment:local-1',
      }),
    ).toBeNull()
  })
})

describe('buildSyncConflictFieldDiffs', () => {
  it('builds customer field diffs without exposing raw JSON by default', () => {
    expect(
      buildSyncConflictFieldDiffs({
        entityType: 'customer',
        entityId: 'customer:local-1',
        localPayload: {
          operation: 'update_customer',
          name: 'Laboratório Exemplo',
          email: 'lab@exemplo.test',
        },
        remotePayload: {
          operation: 'update_customer',
          name: 'Laboratório Exemplo Ltda',
          email: 'lab@exemplo.test',
        },
      }),
    ).toEqual([
      {
        key: 'operation',
        label: 'Operação',
        localValue: 'update_customer',
        remoteValue: 'update_customer',
        state: 'same',
      },
      {
        key: 'name',
        label: 'Nome',
        localValue: 'Laboratório Exemplo',
        remoteValue: 'Laboratório Exemplo Ltda',
        state: 'changed',
      },
      {
        key: 'email',
        label: 'Email',
        localValue: 'lab@exemplo.test',
        remoteValue: 'lab@exemplo.test',
        state: 'same',
      },
    ])
  })

  it('reads calibration job fields from nested command payloads', () => {
    expect(
      buildSyncConflictFieldDiffs({
        entityType: 'calibration_job',
        entityId: 'job:local-1',
        localPayload: {
          status: 'REVIEW',
          data: {
            methodName: 'Pesagem',
            readings: [{ point: 1 }, { point: 2 }],
          },
        },
        remotePayload: {
          status: 'APPROVED',
          data: {
            methodName: 'Pesagem',
          },
        },
      }),
    ).toEqual([
      {
        key: 'status',
        label: 'Status',
        localValue: 'REVIEW',
        remoteValue: 'APPROVED',
        state: 'changed',
      },
      {
        key: 'methodName',
        label: 'Método',
        localValue: 'Pesagem',
        remoteValue: 'Pesagem',
        state: 'same',
      },
      {
        key: 'readings',
        label: 'Leituras',
        localValue: '2 items',
        remoteValue: '—',
        state: 'local_only',
      },
    ])
  })

  it('builds attachment diffs even though attachments are not directly editable', () => {
    expect(
      buildSyncConflictFieldDiffs({
        entityType: 'attachment',
        entityId: 'attachment:local-1',
        localPayload: {
          fileName: 'evidence.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
        },
        remotePayload: {
          status: 'missing_remote_dependency',
        },
      }),
    ).toEqual([
      {
        key: 'fileName',
        label: 'Arquivo',
        localValue: 'evidence.pdf',
        remoteValue: '—',
        state: 'local_only',
      },
      {
        key: 'contentType',
        label: 'Tipo',
        localValue: 'application/pdf',
        remoteValue: '—',
        state: 'local_only',
      },
      {
        key: 'sizeBytes',
        label: 'Tamanho',
        localValue: '2048',
        remoteValue: '—',
        state: 'local_only',
      },
      {
        key: 'status',
        label: 'Status',
        localValue: '—',
        remoteValue: 'missing_remote_dependency',
        state: 'remote_only',
      },
    ])
  })

  it('falls back to generic top-level fields for unknown conflict entities', () => {
    expect(
      buildSyncConflictFieldDiffs({
        entityType: 'method',
        entityId: 'method:local-1',
        localPayload: {
          status: 'draft',
          customField: 'local',
        },
        remotePayload: {
          status: 'published',
          customField: 'cloud',
        },
      }),
    ).toEqual([
      {
        key: 'status',
        label: 'Status',
        localValue: 'draft',
        remoteValue: 'published',
        state: 'changed',
      },
      {
        key: 'customField',
        label: 'Custom Field',
        localValue: 'local',
        remoteValue: 'cloud',
        state: 'changed',
      },
    ])
  })
})
