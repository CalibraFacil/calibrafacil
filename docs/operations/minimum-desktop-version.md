# Minimum desktop version

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

The desktop app pushes its offline work to `POST /api/sync/push` with the protocol it speaks
(`protocolVersion`) and its own version (`desktopVersion`); its pull and bootstrap state the protocol
too. The cloud has a built-in floor, `SYNC_DESKTOP_VERSION_FLOOR` (`packages/contracts/src/sync-protocol.ts`),
currently **0.3.0**: the first release that reports its own version, speaks protocol 3 (the
commit-ordered pull and the paged bootstrap), stamps the calibration record on its execution events
and no longer writes the sync operations retired in Q69 (customer create/edit/compliance, instrument edit,
job drafts, non-conformances, quote, delivery and execution-notes documents, certificate drafts and PDFs). `SYNC_MIN_DESKTOP_VERSION`
(`MAJOR.MINOR.PATCH`, for example `1.4.0`) can only raise the minimum above the floor; unset (the
default) the floor is the minimum, and a value below it changes nothing.

A desktop below the minimum, or one that reports no version (a build from before versioning), is
answered `426` with `{ "code": "DESKTOP_UPDATE_REQUIRED", "minimumVersion", "desktopVersion",
"message" }` on push. A pull or a bootstrap that does not state protocol 3 (protocols 1 and 2 are gone)
is answered the same way, with `desktopVersion: null`. Nothing in the request is applied, claimed or
refused for good: the desktop leaves every queued event exactly as it is (not failed, not backing off,
not dead-lettered), shows an "update required" notice in Portuguese and keeps the changes until the
person updates the app, after which they are sent normally.

Setting `SYNC_MIN_DESKTOP_VERSION` also **ends the legacy exemption of the calibration record rule.** A
job submit from a build that predates the rule (its event carries no `executionPayloadVersion` stamp)
is, until then, applied without requiring the calibration location and the reasons for phase blocks
not performed, so that upgrading did not dead-letter the outbox; its audit row says
`calibrationRecordCheck: "legacy_exempt"`. With a minimum configured an unstamped submit is held to
the rule like any other and refused with `CALIBRATION_RECORD_INCOMPLETE` (a permanent refusal: it waits
in the desktop's refused list for a person).

A desktop at or above the floor whose outbox still holds one of those operations (it was upgraded from 0.2.x or
earlier before it ever synced) sends them: the cloud refuses each for good as `UNSUPPORTED_SYNC_OPERATION`, and the desktop
shows it in its refused list with a pt-BR label, where a person discards it. Nothing else in the push is held back by it.

Raising the minimum: ship the desktop build that carries the change, wait until the laboratories have
updated and drained their queues, then set the variable to that build's version. The value is checked
when the API starts: anything that is not a version stops it with a message naming
`SYNC_MIN_DESKTOP_VERSION`, because a minimum that cannot be read would silently keep the exemption
open.
