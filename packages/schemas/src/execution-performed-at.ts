/**
 * When a calibration was performed, and what it takes to enter a date other
 * than "now". One definition for every place that accepts the date: the cloud
 * `POST /jobs/:id/submit`, the desktop sync apply, the local server and the
 * execution form, so the desktop cannot record what the cloud would refuse.
 */

/** A performed date older than this many whole days needs a written reason. */
export const BACKDATE_REASON_THRESHOLD_DAYS = 7;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type ExecutionPerformedAtResolution =
  | {
      ok: true;
      performedAt: Date;
      /** Whole days between the performed date and `now`. */
      backdateDays: number;
      /** Trimmed reason; only set when the date is past the threshold. */
      backdateReason: string | null;
    }
  | { ok: false; code: "invalid" | "future"; message: string }
  | {
      ok: false;
      code: "reason_required";
      message: string;
      /** Whole days back, so a form can say how far back it is. */
      backdateDays: number;
    };

export function resolveExecutionPerformedAt(input: {
  performedAt?: string | null;
  backdateReason?: string | null;
  now?: Date;
}): ExecutionPerformedAtResolution {
  const now = input.now ?? new Date();
  const performedAt = input.performedAt ? new Date(input.performedAt) : now;

  if (Number.isNaN(performedAt.getTime())) {
    return {
      ok: false,
      code: "invalid",
      message: "Data de execução inválida",
    };
  }

  if (performedAt.getTime() > now.getTime()) {
    return {
      ok: false,
      code: "future",
      message: "A data de execução não pode estar no futuro",
    };
  }

  const backdateDays = Math.floor(
    (now.getTime() - performedAt.getTime()) / MS_PER_DAY,
  );
  if (backdateDays <= BACKDATE_REASON_THRESHOLD_DAYS) {
    return { ok: true, performedAt, backdateDays, backdateReason: null };
  }

  const backdateReason = input.backdateReason?.trim();
  if (!backdateReason) {
    return {
      ok: false,
      code: "reason_required",
      message: `Motivo obrigatório para lançamentos com mais de ${BACKDATE_REASON_THRESHOLD_DAYS} dias`,
      backdateDays,
    };
  }

  return { ok: true, performedAt, backdateDays, backdateReason };
}
