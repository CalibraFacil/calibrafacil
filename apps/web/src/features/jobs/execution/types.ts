import { type MeasurementUnit } from '@calibra-facil/shared/units'
import type {
  MethodFormula,
  MethodInputField,
  MethodValidation,
  MethodVariableBinding,
} from '@/components/method-runtime/types'

export interface ReferenceStandard {
  id: number
  name: string
  kind?: string
  type?: string | null
  model?: string | null
  serialNumber: string
  certificateNumber: string
  calibrationDate: string
  nextCalibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: string
  drift: number | null
  certifiedValues: Array<{
    nominal: string
    authentication?: string | null
    value: number
    uncertainty: number
    unit: string
    maxError?: number | null
    drift?: number | null
    buoyancy?: number | null
    coverageFactor?: number | null
    compositionProfile?: boolean
    profileKey?: string | null
    profileClass?: string | null
    profileQuantityAvailable?: number | null
  }> | null
  metrologyData?: {
    version: 1
    channels: Array<{
      key: string
      label: string
      quantity: string
      value?: number | null
      correction?: number | null
      uncertainty?: number | null
      unit: string
      coverageFactor?: number | null
      drift?: number | null
      notes?: string | null
      points?: Array<{
        reference?: number | null
        indication?: number | null
        meanReading?: number | null
        correction?: number | null
        uncertainty?: number | null
        unit: string
        coverageFactor?: number | null
        degreesOfFreedom?: number | null
        degreesOfFreedomOperator?: 'exact' | 'greater_than' | 'infinity'
        repeatability?: number | null
        metadata?: Record<string, unknown>
      }>
    }>
    massValues: Array<{
      nominal: string
      authentication?: string | null
      value: number
      uncertainty: number
      unit: string
      maxError?: number | null
      drift?: number | null
      buoyancy?: number | null
      coverageFactor?: number | null
    }>
    compositionProfiles: Array<unknown>
    notes?: string | null
  } | null
  status: string
  isExpired: boolean
  daysUntilExpiry: number
  certificateDocument?: ReferenceStandardCertificateDocument | null
}

export interface StandardSnapshotItem {
  id: number
  name: string
  type?: string | null
  kind?: string
  certificateNumber: string
  calibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  distribution: string
  drift: number | null
  certifiedValues: ReferenceStandard['certifiedValues']
  metrologyData?: ReferenceStandard['metrologyData']
  certificateDocument?: ReferenceStandardCertificateDocument | null
}

export interface ReferenceStandardCertificateDocument {
  documentId: number
  r2Key: string
  fileName: string
  fileSize: number
  sha256: string
  uploadedAt: string | Date
  certificateNumber: string
  calibrationDate: string | Date
  nextCalibrationDate: string | Date
}

export interface EnvironmentalSnapshotData {
  temperature: number | null
  humidity: number | null
  pressure: number | null
  recordedAt: string
  recordedBy: string
  limits: {
    temperature?: { min: number; max: number }
    humidity?: { min: number; max: number }
    pressure?: { min: number; max: number }
  } | null
  withinLimits: boolean
  outOfLimitsJustification: string | null
}

export type CalibrationLocationType = 'customer_site' | 'lab' | 'other'

export interface CalibrationLocationSnapshot {
  type: CalibrationLocationType
  addressText: string
  notes?: string | null
  recordedAt?: string
  recordedBy?: string
}

export type CalibrationPhaseMode =
  | 'before_and_after'
  | 'before_only'
  | 'after_only'
  | 'not_performed'

export type CalibrationPhase = 'before' | 'after'

export interface CalibrationPhaseSnapshot {
  blocks: Record<
    string,
    {
      mode: CalibrationPhaseMode
      reason?: string | null
    }
  >
  recordedAt?: string
  recordedBy?: string
}

export type CalibrationPhaseBlock = {
  key: string
  label: string
}

export type EnvironmentalFormData = {
  temperature: number | null
  humidity: number | null
  pressure: number | null
}

export interface AddressData {
  street?: string | null
  number?: string | null
  complement?: string | null
  neighbourhood?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
}

export interface AssetSnapshot {
  assetId: number
  assetTypeId: number
  assetTypeName: string
  assetTypeSlug: string
  baseMeasurementUnit?: MeasurementUnit | null
  name: string
  tag: string
  serialNumber: string
  manufacturer: string | null
  model: string | null
  specifications: Record<string, unknown> | null
  capturedAt: string
}

export interface EffectiveLimits {
  temperatureMin: number | null
  temperatureMax: number | null
  humidityMin: number | null
  humidityMax: number | null
  pressureMin: number | null
  pressureMax: number | null
}

export interface JobData {
  id: number
  jobId: string
  status: string
  /** ISO timestamp of the recorded calibration execution date, if set. */
  performedAt?: string | null
  /** ISO timestamp of the server's last write to the job. */
  updatedAt?: string | null
  customerName: string | null
  customerAddress?: AddressData | null
  labName?: string | null
  labStreet?: string | null
  labNumber?: string | null
  labComplement?: string | null
  labNeighbourhood?: string | null
  labCity?: string | null
  labState?: string | null
  labCep?: string | null
  assetName: string | null
  assetTag: string | null
  unitId?: number | null
  assetTypeId: number | null
  serviceName: string | null
  methodSnapshot: {
    methodId: number
    methodName: string
    methodVersion: number
    /** Opaque in the job contract; read it with `readCompiledMethodSnapshot`. */
    compiledMethod?: unknown
    methodFingerprint?: string | null
    engineVersion?: string | null
    engineOptionsFingerprint?: string | null
    normalizedMethodJson?: string | null
    publicationEvidence?: unknown
    dataFields: MethodInputField[]
    variableBindings?: MethodVariableBinding[]
    formulas: MethodFormula[]
    validations: MethodValidation[]
    uncertaintyParams: Array<unknown>
  }
  data: Record<string, unknown> | null
  results: Record<string, unknown> | null
  assetSnapshot?: AssetSnapshot | null
  standardsSnapshot?: StandardSnapshotItem[] | null
  environmentalSnapshot?: EnvironmentalSnapshotData | null
  calibrationLocationSnapshot?: CalibrationLocationSnapshot | null
  calibrationPhaseSnapshot?: CalibrationPhaseSnapshot | null
  /** ISO/IEC 17025 §7.8.2.1(n) — deviations from the method as executed. */
  methodDeviations?: string | null
}

export interface OfficialCompiledExecution {
  methodFingerprint?: string
  engineVersion?: string
  engineOptionsFingerprint?: string
  inputFingerprint?: string
  calculationFingerprint?: string
  resultFingerprint?: string
  diagnostics?: Array<unknown>
}
