import { defineGroup, example, integer, text } from "../define";

/**
 * The desktop sync protocol (apps/api `/api/sync/*`). See DEPLOYMENT.md.
 *
 * The value is validated at start-up by the API runtime (`MAJOR.MINOR.PATCH`,
 * optionally `-prerelease`), because a minimum that cannot be read would
 * silently leave the legacy exemption of the calibration record rule open. A value
 * below the built-in floor (`SYNC_DESKTOP_VERSION_FLOOR`) changes nothing: the floor wins.
 */
export const syncGroup = defineGroup({
  name: "sync",
  title: "Desktop sync",
  intro: [
    "SYNC_MIN_DESKTOP_VERSION: raises the oldest desktop build the cloud accepts",
    "above its built-in floor (0.3.0, the first build that no longer writes the",
    "retired sync operations and speaks the commit-ordered pull). A desktop below",
    "the floor or this value is answered 'update required' (HTTP 426, its queued",
    "changes are kept). Unset (default) = the floor only. Setting it also holds an",
    "execution submit that does not carry the calibration record stamp to the",
    "calibration record rule like every other submit.",
    "",
    "SYNC_CHANGE_LOG_RETENTION_DAYS: how long the change log the desktop pull reads",
    "(protocol 3) is kept. A desktop that stayed offline longer is told to bootstrap",
    "again instead of pulling; the purge runs from the sync-change-log-purge cron.",
  ],
  vars: {
    minDesktopVersion: text({
      env: "SYNC_MIN_DESKTOP_VERSION",
      description:
        "Oldest desktop version allowed to sync (MAJOR.MINOR.PATCH), raising the built-in floor 0.3.0. Unset means the floor only; setting it also ends the legacy calibration-record exemption.",
      example: example.commented("1.4.0"),
    }),
    changeLogRetentionDays: integer({
      env: "SYNC_CHANGE_LOG_RETENTION_DAYS",
      description:
        "Days the desktop change log is kept (at least 7). A desktop offline for longer bootstraps again. An unusable value means the default.",
      min: 7,
      default: 90,
      tolerant: true,
      example: example.commented("90"),
    }),
  },
});

/** `MAJOR.MINOR.PATCH`, optional `-prerelease` and `+build` (a leading `v` is tolerated). */
export const SYNC_MIN_DESKTOP_VERSION_PATTERN =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
