import { defineGroup, example, text } from "../define";

/**
 * The desktop sync protocol (apps/api `/api/sync/*`). See DEPLOYMENT.md.
 *
 * The value is validated at start-up by the API runtime (`MAJOR.MINOR.PATCH`,
 * optionally `-prerelease`), because a minimum that cannot be read would
 * silently leave the legacy exemption of the calibration record rule open.
 */
export const syncGroup = defineGroup({
  name: "sync",
  title: "Desktop sync",
  intro: [
    "SYNC_MIN_DESKTOP_VERSION: the oldest desktop build the cloud still accepts",
    "pushes from. Unset (default) = no minimum. Once set, an older desktop is",
    "answered 'update required' (HTTP 426, its queued changes are kept), and an",
    "execution submit that does not carry the calibration record stamp is held to",
    "the calibration record rule like every other submit.",
  ],
  vars: {
    minDesktopVersion: text({
      env: "SYNC_MIN_DESKTOP_VERSION",
      description:
        "Oldest desktop version allowed to push (MAJOR.MINOR.PATCH). Unset means no minimum; setting it also ends the legacy calibration-record exemption.",
      example: example.commented("1.4.0"),
    }),
  },
});

/** `MAJOR.MINOR.PATCH`, optional `-prerelease` and `+build` (a leading `v` is tolerated). */
export const SYNC_MIN_DESKTOP_VERSION_PATTERN =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
