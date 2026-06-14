import { formatCalibrationValue } from "@calibra-facil/shared";

import type { SignalTone } from "@/components/instrument-panel";

/**
 * Customer-facing presentation helpers for a portal calibration certificate.
 *
 * The conformance verdict itself (points within tolerance + expanded
 * uncertainty) is computed server-side from the frozen `results` jsonb — see
 * `apps/api/src/lib/portal-certificate-verdict.ts`. These helpers turn that
 * verdict and the raw scalar results into the tones, labels and value rows the
 * detail page renders.
 */

export type CertificateConformity = "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";

export type CertificateVerdict = {
  conformity: CertificateConformity;
  pointsTotal: number;
  pointsWithin: number;
  expandedUncertainty: string | null;
};

export type MethodFormula = {
  outputKey: string;
  label?: string | null;
  unit?: string | null;
};

export type MethodSnapshotLike = {
  name?: string;
  version?: string;
  formulas?: MethodFormula[] | null;
} | null;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Tonal hint for the "próxima calibração" tile based on time-to-due. */
export function describeDueDate(
  dueDate: string | null,
  now: number = Date.now(),
): { tone: SignalTone; hint: string } | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.round((due.getTime() - now) / MS_PER_DAY);
  if (days < 0) return { tone: "critical", hint: "vencido" };
  if (days <= 30) return { tone: "warning", hint: `vence em ${days} d` };
  if (days <= 90) return { tone: "info", hint: `em ${days} d` };
  return { tone: "neutral", hint: "vigente" };
}

export type ConformitySummary = {
  tone: SignalTone;
  label: string;
  /** "3/4 pontos", or undefined when the method declares no tolerance. */
  pointsHint?: string;
};

/** Headline conformance tone + label for the hero tile and results banner. */
export function summarizeConformity(
  verdict: CertificateVerdict | null | undefined,
): ConformitySummary {
  const conformity = verdict?.conformity ?? "UNKNOWN";
  const tone: SignalTone =
    conformity === "CONFORMING"
      ? "ok"
      : conformity === "NON_CONFORMING"
        ? "warning"
        : "neutral";
  const label =
    conformity === "CONFORMING"
      ? "Conforme"
      : conformity === "NON_CONFORMING"
        ? "Não conforme"
        : "Aprovado";
  const pointsHint =
    verdict && verdict.pointsTotal > 0
      ? `${verdict.pointsWithin}/${verdict.pointsTotal} pontos`
      : undefined;
  return { tone, label, pointsHint };
}

/**
 * The customer-facing scalar results, drawn from the frozen method formulas +
 * stored values. Per-point arrays (margins, point uncertainties) and the
 * headline metrics already shown as tiles are filtered out, leaving the scalar
 * outcomes a customer actually reads (e.g. "Erro máximo", "Tendência").
 */
export function buildScalarResults(
  methodSnapshot: MethodSnapshotLike,
  results: Record<string, unknown> | null | undefined,
): Array<{ key: string; label: string; value: string }> {
  const formulas = methodSnapshot?.formulas ?? [];
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string; value: string }> = [];
  for (const formula of formulas) {
    const key = formula.outputKey;
    if (!key || seen.has(key)) continue;
    if (/^(margem|incerteza)_/.test(key)) continue;
    const value = results?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    seen.add(key);
    const formatted = formatCalibrationValue(value);
    out.push({
      key,
      label: formula.label || key,
      value: formula.unit ? `${formatted} ${formula.unit}` : formatted,
    });
  }
  return out;
}
