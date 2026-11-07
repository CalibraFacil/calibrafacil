/** Query keys of the desktop sync surfaces. See `assets/keys.ts`. */
export const syncKeys = {
  /** The desktop shell's sync status snapshot. */
  status: ['desktop-sync-status'] as const,
  openConflicts: ['desktop-sync-conflicts', 'open'] as const,
  blockedEvents: ['desktop-sync-blocked-events'] as const,
  deadEvents: ['desktop-sync-dead-events'] as const,
}
