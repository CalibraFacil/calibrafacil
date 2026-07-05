export type SyncConflictActionSource = {
  entityType: string
  entityId: string
}

export type SyncConflictDiffSource = SyncConflictActionSource & {
  localPayload: unknown
  remotePayload: unknown
}

export type SyncConflictEditTarget =
  | { kind: 'asset'; id: string }
  | { kind: 'calibration_job'; id: string }
  | { kind: 'customer'; id: string }
  | { kind: 'service_order'; id: string }

export type SyncConflictFieldDiff = {
  key: string
  label: string
  localValue: string
  remoteValue: string
  state: 'changed' | 'local_only' | 'remote_only' | 'same'
}

export function getSyncConflictEditTarget(
  conflict: SyncConflictActionSource & {
    localPayload?: unknown
    remotePayload?: unknown
  },
): SyncConflictEditTarget | null {
  if (!conflict.entityId) return null

  switch (conflict.entityType) {
    case 'asset':
      return { kind: 'asset', id: conflict.entityId }
    case 'calibration_job':
      return { kind: 'calibration_job', id: conflict.entityId }
    case 'customer':
      return { kind: 'customer', id: conflict.entityId }
    case 'service_order':
      return { kind: 'service_order', id: conflict.entityId }
    case 'service_order_execution': {
      // REL-01 slice 3 (REQ-REL-RES-003): execution notes are edited from the
      // OWNING service order's detail page, so route the edit target to that
      // service order. The conflict's own id is the execution id, so the owning
      // service order id is read from the conflict payload.
      const serviceOrderId =
        getServiceOrderIdFromPayload(conflict.localPayload) ??
        getServiceOrderIdFromPayload(conflict.remotePayload)
      if (!serviceOrderId) return null
      return { kind: 'service_order', id: serviceOrderId }
    }
    default:
      return null
  }
}

function getServiceOrderIdFromPayload(payload: unknown): string | null {
  const value = getPayloadValue(payload, [
    ['serviceOrderId'],
    ['data', 'serviceOrderId'],
    ['payload', 'serviceOrderId'],
  ])
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  return null
}

export function buildSyncConflictFieldDiffs(
  conflict: SyncConflictDiffSource,
): SyncConflictFieldDiff[] {
  const fields = getEntityConflictFields(conflict.entityType)
  const diffs = fields
    .map((field) => {
      const localValue = formatConflictValue(
        getPayloadValue(conflict.localPayload, field.paths),
      )
      const remoteValue = formatConflictValue(
        getPayloadValue(conflict.remotePayload, field.paths),
      )

      if (!localValue && !remoteValue) return null

      return {
        key: field.key,
        label: field.label,
        localValue: localValue ?? '—',
        remoteValue: remoteValue ?? '—',
        state: getDiffState(localValue, remoteValue),
      } satisfies SyncConflictFieldDiff
    })
    .filter((diff): diff is SyncConflictFieldDiff => diff !== null)

  if (diffs.length > 0) return diffs

  return buildGenericConflictFieldDiffs(
    conflict.localPayload,
    conflict.remotePayload,
  )
}

function buildGenericConflictFieldDiffs(
  localPayload: unknown,
  remotePayload: unknown,
): SyncConflictFieldDiff[] {
  const local = getRecord(localPayload)
  const remote = getRecord(remotePayload)
  if (!local && !remote) return []

  const keys = Array.from(
    new Set([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})]),
  )
    .filter((key) => !key.endsWith('Json'))
    .slice(0, 8)

  return keys.flatMap((key) => {
    const localValue = formatConflictValue(local?.[key])
    const remoteValue = formatConflictValue(remote?.[key])
    if (!localValue && !remoteValue) return []

    return [
      {
        key,
        label: fallbackFieldLabel(key),
        localValue: localValue ?? '—',
        remoteValue: remoteValue ?? '—',
        state: getDiffState(localValue, remoteValue),
      } satisfies SyncConflictFieldDiff,
    ]
  })
}

function getDiffState(
  localValue: string | null,
  remoteValue: string | null,
): SyncConflictFieldDiff['state'] {
  if (localValue && remoteValue && localValue === remoteValue) return 'same'
  if (localValue && remoteValue) return 'changed'
  if (localValue) return 'local_only'
  return 'remote_only'
}

function getPayloadValue(payload: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = getPathValue(payload, path)
    if (value != null) return value
  }

  return null
}

function getPathValue(payload: unknown, path: string[]) {
  let value = payload

  for (const segment of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    value = Object.fromEntries(Object.entries(value))[segment]
  }

  return value
}

function getRecord(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  return Object.fromEntries(Object.entries(payload))
}

function formatConflictValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  if (typeof value === 'object') {
    const record = Object.fromEntries(Object.entries(value))
    const displayValue =
      record.name ?? record.label ?? record.tag ?? record.status ?? record.id
    if (displayValue != null) return formatConflictValue(displayValue)
  }

  return null
}

type ConflictField = {
  key: string
  label: string
  paths: string[][]
}

function field(key: string, label: string, extraPaths: string[][] = []) {
  return {
    key,
    label,
    paths: [[key], ['data', key], ['payload', key], ...extraPaths],
  } satisfies ConflictField
}

function getEntityConflictFields(entityType: string): ConflictField[] {
  switch (entityType) {
    case 'customer':
      return [
        field('operation', 'Operação'),
        field('name', 'Nome'),
        field('taxId', 'CNPJ/CPF'),
        field('email', 'Email'),
        field('phone', 'Telefone'),
        field('status', 'Status'),
        field('updatedAt', 'Atualizado em'),
      ]
    case 'asset':
      return [
        field('operation', 'Operação'),
        field('tag', 'Tag'),
        field('name', 'Nome'),
        field('serialNumber', 'Número de série'),
        field('manufacturer', 'Fabricante'),
        field('model', 'Modelo'),
        field('status', 'Status'),
        field('updatedAt', 'Atualizado em'),
      ]
    case 'calibration_job':
      return [
        field('operation', 'Operação'),
        field('jobId', 'Calibração', [['id']]),
        field('status', 'Status'),
        field('methodName', 'Método'),
        field('readings', 'Leituras'),
        field('reason', 'Motivo'),
        field('updatedAt', 'Atualizado em'),
      ]
    case 'service_order':
      return [
        field('operation', 'Operação'),
        field('serviceOrderNumber', 'OS', [['number']]),
        field('quoteNumber', 'Orçamento'),
        field('documentNumber', 'Documento'),
        field('customerName', 'Cliente'),
        field('assetTag', 'Ativo'),
        field('status', 'Status'),
        field('updatedAt', 'Atualizado em'),
      ]
    case 'service_order_execution':
      return [
        field('operation', 'Operação'),
        field('servicePerformed', 'Serviço executado'),
        field('partsUsedSummary', 'Peças utilizadas'),
        field('technicalNotes', 'Notas técnicas'),
        field('calibrationRequiredAfterRepair', 'Requer calibração após reparo'),
        field('result', 'Resultado'),
        field('updatedAt', 'Atualizado em'),
      ]
    case 'attachment':
      return [
        field('fileName', 'Arquivo', [['name']]),
        field('entityType', 'Tipo vinculado'),
        field('entityId', 'Item vinculado'),
        field('contentType', 'Tipo'),
        field('sizeBytes', 'Tamanho'),
        field('status', 'Status'),
      ]
    default:
      return []
  }
}

function fallbackFieldLabel(value: string) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()

  if (!words) return value
  return words.charAt(0).toUpperCase() + words.slice(1)
}
