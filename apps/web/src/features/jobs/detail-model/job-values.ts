export function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * What a cloud command needs to know about this job before it may run.
 *
 * Jobs are always created in the cloud (`jobs.create` is cloud-only), so a job
 * present on the desktop always has a canonical identity — `synced` is never
 * false here. What *can* differ is the execution: `saveExecution` and
 * `submitExecution` are queued locally, so a job whose local row is still
 * `local` has readings the server has not seen.
 *
 * Approving in that state would record an approval against the server's older
 * snapshot — a separation-of-duties decision made on data the approver is not
 * actually looking at. So it blocks until the queue drains, rather than
 * racing.
 */
export function jobCloudCommandTarget(job: unknown): {
  synced: boolean
  hasPendingLocalChanges: boolean
} {
  const syncState = readJobSyncState(job)

  return {
    synced: true,
    hasPendingLocalChanges: syncState !== null && syncState !== 'synced',
  }
}

function readJobSyncState(job: unknown): string | null {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null

  const value: unknown = Reflect.get(job, 'syncState')
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function arrayValueAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined
}

export function numericValues(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => numericValues(item))
  }

  const parsed = numberFromUnknown(value)
  return parsed == null ? [] : [parsed]
}
