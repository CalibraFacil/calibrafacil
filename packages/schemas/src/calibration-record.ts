/**
 * The calibration record a submit must carry: where the work was done, and a
 * written reason for every phase block that was not performed.
 *
 * One rule, called by every place that submits: the cloud's submit command
 * (the lab app, the public API and the desktop sync apply), the desktop's
 * local database and the local server. Taking `unknown` keeps it usable on the
 * cloud's typed snapshots and on the JSON the desktop reads back from SQLite
 * without a cast.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCalibrationLocationForSubmit(
  snapshot: unknown,
): string | null {
  if (!isRecord(snapshot)) return "Local da calibração é obrigatório";
  if (
    snapshot.type !== "customer_site" &&
    snapshot.type !== "lab" &&
    snapshot.type !== "other"
  ) {
    return "Tipo de local da calibração é inválido";
  }
  if (
    typeof snapshot.addressText !== "string" ||
    !snapshot.addressText.trim()
  ) {
    return "Endereço/local da calibração é obrigatório";
  }
  return null;
}

export function validateCalibrationPhasesForSubmit(
  snapshot: unknown,
): string | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.blocks)) return null;

  for (const [blockKey, block] of Object.entries(snapshot.blocks)) {
    if (!isRecord(block) || block.mode !== "not_performed") continue;
    if (typeof block.reason !== "string" || !block.reason.trim()) {
      return `Informe o motivo para não executar o bloco ${blockKey}`;
    }
  }
  return null;
}

/** The first thing wrong with the record a submit carries, or null. */
export function validateCalibrationRecordForSubmit(record: {
  location: unknown;
  phases: unknown;
}): string | null {
  return (
    validateCalibrationLocationForSubmit(record.location) ??
    validateCalibrationPhasesForSubmit(record.phases)
  );
}

/**
 * The version a desktop build stamps on every execution event it writes
 * (`executionPayloadVersion`) once its own submit enforces the rule above.
 *
 * It is how the cloud tells a legacy event from a new one. Builds before this
 * one wrote no version; they also always wrote `calibrationLocationSnapshot`
 * (null when nothing had been recorded), so neither the key's absence nor an
 * explicit null identifies them. A positive stamp does: it is only ever written
 * by a build that refused to submit without the record.
 *
 * The legacy exemption stays until P2-4's typed sync protocol enforces a minimum desktop version (Q28).
 */
export const DESKTOP_EXECUTION_PAYLOAD_VERSION = 2;

/**
 * Whether the cloud must hold a desktop submit event to the calibration record
 * rule. False for the events a build that predates it left in the outbox: those
 * are applied as before instead of being dead-lettered on upgrade.
 */
export function desktopEventCarriesCalibrationRecordRule(
  payload: Record<string, unknown>,
): boolean {
  const version = payload.executionPayloadVersion;
  return (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version >= DESKTOP_EXECUTION_PAYLOAD_VERSION
  );
}
