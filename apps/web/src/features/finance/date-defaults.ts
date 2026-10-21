import { dateInputToNoonIso, todayDateInputValue } from '@/lib/date-only'

/** Defaults and payload dates for the finance forms that ask for a plain day. */

/** A new contract starts today, by the laboratory's calendar. */
export function defaultContractEffectiveFrom(now: Date = new Date()) {
  return todayDateInputValue(now)
}

/** A payment is received today unless the operator says otherwise. */
export function defaultReceivedAt(now: Date = new Date()) {
  return todayDateInputValue(now)
}

/**
 * The received day as an instant at local noon (null while the day is empty). `new Date("2026-05-20")` is
 * UTC midnight, which the receipts ledger then lists as the 19th in Brazil.
 */
export function receivedAtPayload(receivedAt: string): string | null {
  return dateInputToNoonIso(receivedAt)
}
