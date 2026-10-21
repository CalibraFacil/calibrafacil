import { z } from 'zod'

import type {
  CalibrationLocationSnapshot,
  CalibrationPhaseSnapshot,
} from '@/features/jobs/execution'

/**
 * The calibration execution worksheet keeps every typed reading in component
 * state. This module is the pure half of protecting that work:
 *
 * - dirty detection (current values vs the last saved/loaded values), and
 * - a small, schema-versioned localStorage draft scoped to
 *   organization + job + user, so a crash, reload or accidental navigation does
 *   not cost the technician their readings.
 *
 * Nothing here touches React or the router.
 */

/** Bump when the stored shape changes; older drafts are then ignored. */
export const EXECUTION_DRAFT_VERSION = 1

/** A draft above this size is skipped rather than risking the storage quota. */
const MAX_DRAFT_CHARS = 512 * 1024

export type ExecutionFormValues = {
  formData: Record<string, unknown>
  selectedStandardIds: number[]
  environment: {
    temperature: number | null
    humidity: number | null
    pressure: number | null
  }
  calibrationLocation: CalibrationLocationSnapshot
  calibrationPhases: CalibrationPhaseSnapshot
  performedAt: string
  backdateReason: string
  methodDeviations: string
}

/** Who is typing, so a local draft can never leak across orgs or users. */
export type ExecutionDraftOwner = {
  organizationId: string
  userId: string
}

export type ExecutionDraftScope = ExecutionDraftOwner & {
  jobId: string
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const phaseModeSchema = z.enum([
  'before_and_after',
  'before_only',
  'after_only',
  'not_performed',
])

const executionFormValuesSchema = z.object({
  formData: z.record(z.string(), z.unknown()),
  selectedStandardIds: z.array(z.number()),
  environment: z.object({
    temperature: z.number().nullable(),
    humidity: z.number().nullable(),
    pressure: z.number().nullable(),
  }),
  calibrationLocation: z.object({
    type: z.enum(['customer_site', 'lab', 'other']),
    addressText: z.string(),
    notes: z.string().nullish(),
    recordedAt: z.string().optional(),
    recordedBy: z.string().optional(),
  }),
  calibrationPhases: z.object({
    blocks: z.record(
      z.string(),
      z.object({
        mode: phaseModeSchema,
        reason: z.string().nullish(),
      }),
    ),
    recordedAt: z.string().optional(),
    recordedBy: z.string().optional(),
  }),
  performedAt: z.string(),
  backdateReason: z.string(),
  methodDeviations: z.string(),
})

const storedDraftSchema = z.object({
  version: z.literal(EXECUTION_DRAFT_VERSION),
  organizationId: z.string(),
  userId: z.string(),
  jobId: z.string(),
  savedAt: z.number(),
  /** The server's `updatedAt` of the job when the draft was started. */
  baseUpdatedAt: z.string().nullable(),
  values: executionFormValuesSchema,
})

export type StoredExecutionDraft = z.infer<typeof storedDraftSchema>

// ---------------------------------------------------------------------------
// Value comparison
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Own keys whose value is not `undefined`: `{a: 1, b: undefined}` equals `{a: 1}`. */
function definedKeys(value: Record<string, unknown>) {
  return Object.keys(value).filter((key) => value[key] !== undefined)
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true

  // A number field holds the typed text until blur parses it, so "10" typed
  // over a saved 10 is the same reading, not an edit. Only the exact canonical
  // text matches: "10.0" still differs from 10.
  if (typeof left === 'number' && typeof right === 'string') {
    return String(left) === right
  }
  if (typeof left === 'string' && typeof right === 'number') {
    return left === String(right)
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((item, index) => isDeepEqual(item, right[index]))
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = definedKeys(left)
    if (leftKeys.length !== definedKeys(right).length) return false
    return leftKeys.every(
      (key) => key in right && isDeepEqual(left[key], right[key]),
    )
  }

  return false
}

/** Stable JSON: sorted keys, `undefined` entries dropped. */
function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item ?? null)).join(',')}]`
  }
  if (isPlainObject(value)) {
    // definedKeys() returns a fresh array, so sorting in place is safe;
    // toSorted() is not in this project's TS lib target.
    // oxlint-disable-next-line unicorn/no-array-sort
    const keys = definedKeys(value).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** True when the current worksheet values differ (by value) from the baseline. */
export function isExecutionFormDirty(
  current: ExecutionFormValues,
  baseline: ExecutionFormValues,
) {
  return !isDeepEqual(current, baseline)
}

/** Cheap content fingerprint (djb2) used to re-arm the autosave debounce. */
export function hashExecutionValues(values: ExecutionFormValues) {
  const serialized = stableSerialize(values)
  let hash = 5381
  for (let index = 0; index < serialized.length; index += 1) {
    hash = ((hash << 5) + hash + serialized.charCodeAt(index)) | 0
  }
  return `${serialized.length}:${(hash >>> 0).toString(36)}`
}

// ---------------------------------------------------------------------------
// localStorage draft
// ---------------------------------------------------------------------------

export function executionDraftKey(scope: ExecutionDraftScope) {
  return [
    'calibra:execution-draft',
    `v${EXECUTION_DRAFT_VERSION}`,
    encodeURIComponent(scope.organizationId),
    encodeURIComponent(scope.jobId),
    encodeURIComponent(scope.userId),
  ].join(':')
}

function defaultStorage(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Access itself throws when storage is disabled.
    return null
  }
}

export function writeExecutionDraft({
  scope,
  values,
  baseUpdatedAt,
  now = Date.now(),
  storage = defaultStorage(),
}: {
  scope: ExecutionDraftScope
  values: ExecutionFormValues
  baseUpdatedAt: string | null
  now?: number
  storage?: DraftStorage | null
}) {
  if (!storage) return false

  const draft = {
    version: EXECUTION_DRAFT_VERSION,
    organizationId: scope.organizationId,
    userId: scope.userId,
    jobId: scope.jobId,
    savedAt: now,
    baseUpdatedAt,
    values,
  } satisfies StoredExecutionDraft

  try {
    const serialized = JSON.stringify(draft)
    if (serialized.length > MAX_DRAFT_CHARS) return false
    storage.setItem(executionDraftKey(scope), serialized)
    return true
  } catch {
    // Quota exceeded, private mode or storage disabled: the draft is a safety
    // net, never a reason to break typing.
    return false
  }
}

export function readExecutionDraft(
  scope: ExecutionDraftScope,
  storage: DraftStorage | null = defaultStorage(),
): StoredExecutionDraft | null {
  if (!storage) return null

  try {
    const raw = storage.getItem(executionDraftKey(scope))
    if (raw === null) return null

    const parsed = storedDraftSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null

    const draft = parsed.data
    // Defence in depth: the key already carries the scope, but a payload that
    // names a different org/user/job must never be applied.
    if (
      draft.organizationId !== scope.organizationId ||
      draft.userId !== scope.userId ||
      draft.jobId !== scope.jobId
    ) {
      return null
    }

    return draft
  } catch {
    return null
  }
}

export function clearExecutionDraft(
  scope: ExecutionDraftScope,
  storage: DraftStorage | null = defaultStorage(),
) {
  try {
    storage?.removeItem(executionDraftKey(scope))
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/**
 * The draft to offer the technician on opening the page, or null.
 *
 * Offered only when it differs from what the server saved AND it is newer than
 * that data: either it was written after the server's last update, or it was
 * started on top of exactly this server version (which keeps a client clock
 * that runs behind the server's from hiding a legitimate draft).
 */
export function resolveExecutionDraftOffer({
  scope,
  baseline,
  serverUpdatedAt,
  storage = defaultStorage(),
}: {
  scope: ExecutionDraftScope
  baseline: ExecutionFormValues
  serverUpdatedAt: string | null | undefined
  storage?: DraftStorage | null
}): ExecutionFormValues | null {
  const draft = readExecutionDraft(scope, storage)
  if (!draft) return null
  if (!isExecutionFormDirty(draft.values, baseline)) return null

  const serverMs = serverUpdatedAt ? Date.parse(serverUpdatedAt) : Number.NaN
  const serverTimeKnown = Number.isFinite(serverMs)
  const builtOnCurrentVersion =
    serverUpdatedAt != null && draft.baseUpdatedAt === serverUpdatedAt
  const newerThanServer = !serverTimeKnown || draft.savedAt > serverMs

  return builtOnCurrentVersion || newerThanServer ? draft.values : null
}
