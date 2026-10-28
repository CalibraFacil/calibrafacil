# Minimum desktop version

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

The desktop app pushes its offline work to `POST /api/sync/push` with the protocol it speaks
(`protocolVersion`) and its own version (`desktopVersion`). `SYNC_MIN_DESKTOP_VERSION`
(`MAJOR.MINOR.PATCH`, for example `1.4.0`) is the oldest desktop build the cloud still takes pushes
from. Unset (the default) there is no minimum: every build, including those that predate
versioning, is accepted exactly as before.

Setting it does two things:

- **A desktop below the minimum, or one that reports no version (a build from before versioning), is
  answered `426` with `{ "code": "DESKTOP_UPDATE_REQUIRED", "minimumVersion", "desktopVersion",
"message" }`.** Nothing in the request is applied, claimed or refused for good: the desktop
  leaves every queued event exactly as it is (not failed, not backing off, not dead-lettered),
  shows an "update required" notice in Portuguese and keeps the changes until the person
  updates the app, after which they are sent normally.
- **The legacy exemption of the calibration record rule ends.** A job submit from a build that
  predates the rule (its event carries no `executionPayloadVersion` stamp) used to be applied
  without requiring the calibration location and the reasons for phase blocks not performed,
  so that upgrading did not dead-letter the outbox; its audit row says
  `calibrationRecordCheck: "legacy_exempt"`. With a minimum configured every desktop that gets
  through is new enough to stamp its events, so an unstamped submit is held to the rule like
  any other and refused with `CALIBRATION_RECORD_INCOMPLETE` (a permanent refusal: it
  waits in the desktop's refused list for a person).

Roll it out in this order: ship the desktop build that carries the version and the stamp,
wait until the laboratories have updated and drained their queues (the audit rows of
`submit` with `legacy_exempt` stop appearing), then set the minimum to that build's version. The
value is checked when the API starts: anything that is not a version stops it with a message
naming `SYNC_MIN_DESKTOP_VERSION`, because a minimum that cannot be read would silently keep
the exemption open.
