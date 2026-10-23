import {
  compiledMethodSnapshotSchema,
  type CompiledMethodSnapshot,
} from '@calibra-facil/contracts'
import { type OfficialCompiledExecution } from './types'

/**
 * The compiled method frozen on a job, or null when the snapshot has none (or
 * a shape the worksheet cannot read: it then calculates from the plain
 * formulas/validations of the snapshot).
 */
export function readCompiledMethodSnapshot(
  value: unknown,
): CompiledMethodSnapshot | null {
  const parsed = compiledMethodSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value))
}

function toOfficialCompiledExecution(
  value: unknown,
): OfficialCompiledExecution | null {
  const record = toRecord(value)
  if (Object.keys(record).length === 0) {
    return null
  }

  return {
    methodFingerprint:
      typeof record.methodFingerprint === 'string'
        ? record.methodFingerprint
        : undefined,
    engineVersion:
      typeof record.engineVersion === 'string'
        ? record.engineVersion
        : undefined,
    engineOptionsFingerprint:
      typeof record.engineOptionsFingerprint === 'string'
        ? record.engineOptionsFingerprint
        : undefined,
    inputFingerprint:
      typeof record.inputFingerprint === 'string'
        ? record.inputFingerprint
        : undefined,
    calculationFingerprint:
      typeof record.calculationFingerprint === 'string'
        ? record.calculationFingerprint
        : undefined,
    resultFingerprint:
      typeof record.resultFingerprint === 'string'
        ? record.resultFingerprint
        : undefined,
    diagnostics: Array.isArray(record.diagnostics)
      ? record.diagnostics
      : undefined,
  }
}

export function getOfficialCompiledExecution(
  results: Record<string, unknown> | null,
): OfficialCompiledExecution | null {
  const value = results?.__compiledExecution
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return toOfficialCompiledExecution(value)
}
