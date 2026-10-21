/**
 * Display model for the asset detail screen.
 *
 * The headline fact about a calibrated instrument is whether its calibration is
 * still valid — so we derive a single calibration "verdict" (valid / due soon /
 * overdue / unscheduled / retired) that drives the instrument-panel hero. Keep
 * this logic here (tested) rather than in JSX, per the schema-first rule.
 */
import { formatCalendarDate } from '@calibra-facil/shared/format'

import type { SignalTone } from '@/components/instrument-panel'
import { dateOnlyDaysBetween } from '@/lib/date-only'

export type AssetCalibrationLevel =
  | 'valid'
  | 'due_soon'
  | 'overdue'
  | 'unscheduled'
  | 'retired'

/** Within this window the calibration is flagged as expiring soon. */
export const DUE_SOON_DAYS = 30

/** A calibration date is a calendar date (a Postgres date): show its day. */
export function formatDate(date: string | Date | null | undefined): string {
  return formatCalendarDate(date)
}

export type AssetCalibrationStatus = {
  level: AssetCalibrationLevel
  tone: SignalTone
  label: string
  description: string
  /** Whole days until next calibration; negative when overdue, null otherwise. */
  daysUntilNext: number | null
}

/** Minimal shape needed to derive calibration validity (accepts string or Date). */
export type AssetCalibrationInput = {
  status: string
  nextCalibrationDate?: string | Date | null
}

export function buildAssetCalibrationStatus(
  asset: AssetCalibrationInput,
  now: Date = new Date(),
): AssetCalibrationStatus {
  if (asset.status === 'SCRAPPED') {
    return {
      level: 'retired',
      tone: 'neutral',
      label: 'Instrumento descartado',
      description: 'Fora do controle de calibração do laboratório.',
      daysUntilNext: null,
    }
  }

  const next = asset.nextCalibrationDate
    ? new Date(asset.nextCalibrationDate)
    : null

  if (!next || Number.isNaN(next.getTime())) {
    return {
      level: 'unscheduled',
      tone: 'neutral',
      label: 'Sem calibração programada',
      description: 'Defina a próxima calibração para acompanhar a validade.',
      daysUntilNext: null,
    }
  }

  // Whole laboratory days to the day the next calibration NAMES (read in the
  // browser's zone, its UTC-midnight value would be the evening before).
  const daysUntilNext = dateOnlyDaysBetween(now, next)

  if (daysUntilNext < 0) {
    const overdue = Math.abs(daysUntilNext)
    return {
      level: 'overdue',
      tone: 'critical',
      label: 'Calibração vencida',
      description: `Vencida há ${overdue} ${
        overdue === 1 ? 'dia' : 'dias'
      }. Recalibração necessária antes do uso.`,
      daysUntilNext,
    }
  }

  if (daysUntilNext <= DUE_SOON_DAYS) {
    return {
      level: 'due_soon',
      tone: 'warning',
      label: 'Vence em breve',
      description:
        daysUntilNext === 0
          ? 'Vence hoje. Agende a recalibração.'
          : `Faltam ${daysUntilNext} ${
              daysUntilNext === 1 ? 'dia' : 'dias'
            } para o vencimento.`,
      daysUntilNext,
    }
  }

  return {
    level: 'valid',
    tone: 'ok',
    label: 'Calibração válida',
    description: `Faltam ${daysUntilNext} dias até a próxima calibração.`,
    daysUntilNext,
  }
}
