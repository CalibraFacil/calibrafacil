import type { MethodInputField } from '@/components/method-runtime/types'
import {
  type CalibrationPhase,
  type CalibrationPhaseMode,
  type CalibrationPhaseSnapshot,
} from './types'

export const DEFAULT_PHASE_MODE: CalibrationPhaseMode = 'before_and_after'

export function phaseBlockKey(field: MethodInputField) {
  return field.phaseBlockKey?.trim() || null
}

export function phaseBlockLabel(field: MethodInputField) {
  return field.phaseBlockLabel?.trim() || field.label
}

export function collectPhaseBlocks(fields: MethodInputField[]) {
  const blocks: Array<{ key: string; label: string }> = []
  const seen = new Set<string>()
  for (const field of fields) {
    const key = phaseBlockKey(field)
    if (!key || seen.has(key)) continue
    seen.add(key)
    blocks.push({ key, label: phaseBlockLabel(field) })
  }
  return blocks
}

export function defaultCalibrationPhases(
  fields: MethodInputField[],
  existing: CalibrationPhaseSnapshot | null | undefined,
): CalibrationPhaseSnapshot {
  const blocks: CalibrationPhaseSnapshot['blocks'] = {}
  for (const block of collectPhaseBlocks(fields)) {
    blocks[block.key] = {
      mode: existing?.blocks?.[block.key]?.mode ?? DEFAULT_PHASE_MODE,
      reason: existing?.blocks?.[block.key]?.reason ?? null,
    }
  }
  return {
    blocks,
    recordedAt: existing?.recordedAt,
    recordedBy: existing?.recordedBy,
  }
}

export function isPhaseActive(
  metadata: Record<string, unknown> | undefined,
  phases: CalibrationPhaseSnapshot,
) {
  const block = metadata?.phaseBlock
  const phase = metadata?.phase
  if (
    typeof block === 'string' &&
    phases.blocks[block]?.mode === 'not_performed'
  ) {
    return false
  }
  if (typeof block !== 'string' || (phase !== 'before' && phase !== 'after')) {
    return true
  }
  return isBlockPhaseActive(phases.blocks[block]?.mode, phase)
}

export function isBlockPhaseActive(
  mode: CalibrationPhaseMode | undefined,
  phase: CalibrationPhase,
) {
  const effectiveMode = mode ?? DEFAULT_PHASE_MODE
  if (effectiveMode === 'before_and_after') return true
  if (effectiveMode === 'before_only') return phase === 'before'
  if (effectiveMode === 'after_only') return phase === 'after'
  if (effectiveMode === 'not_performed') return false
  return true
}
