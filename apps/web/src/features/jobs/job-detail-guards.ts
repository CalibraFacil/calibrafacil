import { type FinancialStatus } from '@calibra-facil/shared'
import {
  type ApprovedJobRecordData,
  type JobStatus,
} from '@/features/jobs/detail-model'
import { isNullableRecord, toRecord } from './record-guards'

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

export function toJobStatus(value: unknown): JobStatus {
  switch (value) {
    case 'DRAFT':
    case 'IN_PROGRESS':
    case 'REVIEW':
    case 'APPROVED':
    case 'REJECTED':
    case 'CANCELED':
    case 'GENERATING_PDF':
    case 'RENDER_FAILED':
    case 'SUPERSEDED':
      return value
    default:
      return 'DRAFT'
  }
}

export function toFinancialStatus(value: unknown): FinancialStatus {
  switch (value) {
    case 'DRAFT':
    case 'ISSUED':
    case 'PAID':
    case 'OVERDUE':
    case 'VOID':
    case 'UNBILLED':
      return value
    default:
      return 'UNBILLED'
  }
}
