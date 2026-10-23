import { describe, expect, it } from 'vitest'

import * as detailModel from './index'

// REQ-SPLIT-2: detail-model.ts became this folder. Every runtime name its
// callers imported before the split must still come out of the index, and
// nothing else leaks. The type half is held by `check-types` on the importers.
const SURFACE = [
  'JOB_STATUS_LABELS',
  'JOB_STATUS_VARIANTS',
  'PHASE_DISPLAY_LABELS',
  'PRIORITY_REVIEW_FIELD_KEYS',
  'PRIORITY_REVIEW_FORMULA_KEYS',
  'REVIEW_ACTION_BUTTON_CLASS',
  'REVIEW_SURFACE_CLASS',
  'arrayValueAt',
  'buildAcceptanceItems',
  'buildAdjustmentSummaryRows',
  'buildApprovedJobRecordModel',
  'buildApprovedRecordTimelineContextItems',
  'buildJobReviewModel',
  'buildJobVerdictModel',
  'buildReviewAssetSpecDefinitions',
  'buildReviewEquipmentSpecItems',
  'buildReviewSupportContextItems',
  'buildScopeComplianceWarnings',
  'formatDate',
  'formatDateTime',
  'formatExpandedUncertainty',
  'formatReviewValue',
  'getApprovedReviewMeasurementFields',
  'getFinancialVariant',
  'jobCloudCommandTarget',
  'numberFromUnknown',
  'numericValues',
  'reviewColumnDisplayLabel',
]

describe('detail-model index', () => {
  it('REQ-SPLIT-2 re-exports exactly the original runtime surface', () => {
    expect(Object.keys(detailModel).sort()).toEqual([...SURFACE].sort())
  })
})
