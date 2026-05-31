export type ReportPeriod = '7d' | '30d' | '90d' | 'month'

export type ReportUnitOption = {
  id: number
  name: string
  slug: string
}

export type ReportsQueryInput = {
  organizationId: string | null | undefined
  period: ReportPeriod
  unitIds: string | undefined
}

export type ExecutiveOverviewResponse = {
  period: ReportPeriod
  label: string
  range: {
    startDate: string
    endDate: string
  }
  availableUnits: ReportUnitOption[]
  selectedUnits: ReportUnitOption[]
  scopeSummary: {
    label: string
    description: string
    unitsIncluded: number
    isAllUnits: boolean
  }
  metrics: {
    pendingCalibrations: number
    approvedInPeriod: number
    rejectedInPeriod: number
    approvalRate: number
    overdueJobs: number
    expiringStandards: number
    unitsIncluded: number
    atRiskUnitsCount: number
  }
  highlights: {
    highestVolumeUnit: {
      unitId: number
      unitName: string
      jobsCreatedInPeriod: number
    } | null
    bestApprovalUnit: {
      unitId: number
      unitName: string
      approvalRate: number
      approvedInPeriod: number
    } | null
    attentionUnit: {
      unitId: number
      unitName: string
      healthStatus: 'healthy' | 'attention' | 'critical'
      healthReason: string
      overdueNow: number
      rejectedInPeriod: number
      expiringStandardsSoon: number
    } | null
  }
}

export type TrendResponse = {
  period: ReportPeriod
  label: string
  availableUnits: ReportUnitOption[]
  selectedUnits: ReportUnitOption[]
  data: Array<{
    date: string
    approved: number
    rejected: number
  }>
}

export type ComparisonResponse = {
  period: ReportPeriod
  label: string
  availableUnits: ReportUnitOption[]
  selectedUnits: ReportUnitOption[]
  rows: Array<{
    unitId: number
    unitName: string
    unitSlug: string
    jobsCreatedInPeriod: number
    approvedInPeriod: number
    rejectedInPeriod: number
    pendingNow: number
    overdueNow: number
    expiringStandardsSoon: number
    approvalRate: number
    healthStatus: 'healthy' | 'attention' | 'critical'
    healthReason: string
  }>
}
