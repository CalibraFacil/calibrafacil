import { JOB_STATUS } from '@calibra-facil/schemas'
import { toRecord } from '@calibra-facil/shared/record'
import { FINANCIAL_STATUS, type FinancialStatus } from '@calibra-facil/shared'
import {
  type ApprovedJobRecordData,
  type JobStatus,
} from '@/features/jobs/detail-model'
import { isNullableRecord } from './record-guards'

export function isApprovedJobRecordData(
  value: unknown,
): value is ApprovedJobRecordData {
  const job = toRecord(value)
  const methodSnapshot = toRecord(job.methodSnapshot)

  return (
    typeof job.id === 'number' &&
    typeof job.jobId === 'string' &&
    typeof job.status === 'string' &&
    isNullableRecord(job.data) &&
    isNullableRecord(job.results) &&
    typeof methodSnapshot.methodId === 'number' &&
    typeof methodSnapshot.methodName === 'string' &&
    typeof methodSnapshot.methodVersion === 'number' &&
    Array.isArray(methodSnapshot.dataFields) &&
    Array.isArray(methodSnapshot.formulas) &&
    Array.isArray(methodSnapshot.validations) &&
    typeof job.createdAt === 'string'
  )
}

/** An unknown status throws: showing it as DRAFT would offer DRAFT's actions. */
export function toJobStatus(value: unknown): JobStatus {
  return JOB_STATUS.require(value)
}

/**
 * The API leaves `financialStatus` out when no financial context was loaded for
 * the job: that is "not billed". A value that is present and unknown throws.
 */
export function toFinancialStatus(value: unknown): FinancialStatus {
  if (value === undefined || value === null) return 'UNBILLED'
  return FINANCIAL_STATUS.require(value)
}
