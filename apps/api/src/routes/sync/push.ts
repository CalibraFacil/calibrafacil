import { Hono } from "hono";
import {
  LEGACY_SYNC_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  buildSyncProtocolUnsupportedResponse,
  buildSyncUpdateRequiredResponse,
  evaluateDesktopVersionGate,
  parseSyncCommand,
  syncEventSchema,
  syncPushRequestEnvelopeSchema,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { readSyncConfig } from "@calibra-facil/config";
import {
  buildDesktopSyncConflictId,
  buildSyncPushCursor,
} from "@calibra-facil/contracts";
import { domainErrorResponse, invalid } from "../../lib/domain-errors";
import {
  requireLabProtected,
  requireOrgType,
} from "../../middleware/permission";
import { applyDesktopEventAtomically } from "../../modules/sync/event-transaction";
import { type SyncRouterEnv, getMemberData } from "./env";
import {
  type PreparedDesktopEventSideEffects,
  type PushBatchState,
  noteAppliedJobVersion,
  rejectedEventId,
} from "../../modules/sync/desktop-event-support";
import {
  findAppliedDesktopSyncEvent,
  getClaimedSyncActorUserId,
  isDesktopSyncEventApplied,
  validateSyncActorScope,
} from "../../modules/sync/desktop-sync-support";
import { prepareDesktopEventSideEffects } from "../../modules/sync/side-effects";
import { applyDesktopSyncEvent } from "../../modules/sync/apply-event";
import {
  authorizeSyncOperation,
  memberForEventUnit,
} from "../../modules/sync/operation-permissions";

/** `entityType:entityId` of a raw event, or null when it names no aggregate. */
function aggregateKeyOf(rawEvent: unknown): string | null {
  if (rawEvent === null || typeof rawEvent !== "object") return null;
  const entityType = Reflect.get(rawEvent, "entityType");
  const entityId = Reflect.get(rawEvent, "entityId");
  return typeof entityType === "string" && typeof entityId === "string"
    ? `${entityType}\u0000${entityId}`
    : null;
}

export const pushRoutes = new Hono<SyncRouterEnv>().post(
  "/push",
  // Authentication, membership and the laboratory organization only: what each
  // member may send is decided per event (SYNC_OPERATION_PERMISSIONS), since
  // one batch carries operations that the online routes guard differently.
  ...requireLabProtected,
  requireOrgType("LAB"),
  async (c) => {
    const memberData = getMemberData(c);
    const session = c.get("session");
    // The header is validated here; each event is validated on its own below
    // so one malformed event is refused permanently instead of failing (and
    // endlessly retrying) the whole batch.
    const request = syncPushRequestEnvelopeSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!request.success) {
      // Not a push request at all (a client bug, never a server fault).
      return domainErrorResponse(
        c,
        invalid("invalid_request", "Requisição de sincronização inválida."),
      );
    }
    const body = request.data;

    // A push from a protocol newer than this cloud speaks cannot be read
    // safely; its events stay queued on the desktop until the cloud catches up.
    const protocolVersion =
      body.protocolVersion ?? LEGACY_SYNC_PROTOCOL_VERSION;
    if (protocolVersion > SYNC_PROTOCOL_VERSION) {
      return c.json(buildSyncProtocolUnsupportedResponse(protocolVersion), 400);
    }

    // Minimum desktop version (Q28). Answered before any event is looked at:
    // nothing is applied, claimed or dead-lettered, so the queue survives the
    // upgrade untouched.
    const minimumDesktopVersion = readSyncConfig().minDesktopVersion;
    const versionGate = evaluateDesktopVersionGate({
      minimumVersion: minimumDesktopVersion,
      desktopVersion: body.desktopVersion,
    });
    if (!versionGate.ok) {
      return c.json(buildSyncUpdateRequiredResponse(versionGate), 426);
    }

    const accepted: Array<{
      eventId: string;
      remoteEntityId?: number | string;
      remoteEntity?: unknown;
      remoteVersion: number;
      aggregateVersion?: number;
      cloudEventId: string;
    }> = [];
    const rejected: Array<{
      eventId: string;
      reason: string;
      code: string;
    }> = [];
    const conflicts: Array<{
      id: string;
      eventId: string;
      entityType: string;
      entityId: string;
      conflictType: string;
      status: string;
      localPayload: unknown;
      remotePayload: unknown;
    }> = [];

    const actorMembershipCache = new Map<string, boolean>();
    const batch: PushBatchState = { jobUpdatedAtMs: new Map() };
    // Per-aggregate head-of-line inside the batch (roadmap 2 E1): once an event of a record
    // was not applied (refused, in conflict, failed), the later events of the same record in
    // this push are not looked at. They were made on top of it (the desktop sends them in
    // the order they were written), and applying one without its predecessor is how an
    // older autosave would be skipped over and a newer one written onto the wrong base.
    const unappliedAggregates = new Map<string, string>();

    for (const [index, rawEvent] of body.events.entries()) {
      const aggregateKey = aggregateKeyOf(rawEvent);
      try {
        const envelope = syncEventSchema.safeParse(rawEvent);
        if (!envelope.success) {
          // Permanent: the same bytes will fail the same way every time.
          const parsed = parseSyncCommand(rawEvent);
          rejected.push({
            eventId: rejectedEventId(rawEvent, index),
            code: "INVALID_SYNC_COMMAND",
            reason: `Event ${index} of the batch: ${
              parsed.ok ? "Sync event is invalid." : parsed.reason
            }`,
          });
          continue;
        }
        const event = envelope.data;

        if (event.organizationId !== memberData.organizationId) {
          rejected.push({
            eventId: event.eventId,
            code: "ORGANIZATION_SCOPE_MISMATCH",
            reason:
              "Sync event organization does not match active organization.",
          });
          continue;
        }

        if (
          event.unitId !== null &&
          !memberData.accessibleUnitIds.includes(event.unitId)
        ) {
          rejected.push({
            eventId: event.eventId,
            code: "UNIT_SCOPE_MISMATCH",
            reason: "Sync event unit is not accessible to this member.",
          });
          continue;
        }

        const claimedActorUserId = getClaimedSyncActorUserId(event.actorUserId);
        const actorAllowed = await validateSyncActorScope(
          claimedActorUserId,
          memberData,
          session.user.id,
          actorMembershipCache,
        );
        if (!actorAllowed) {
          rejected.push({
            eventId: event.eventId,
            code: "ACTOR_SCOPE_MISMATCH",
            reason:
              "Sync event actor is not a member of the active organization.",
          });
          continue;
        }

        // The typed protocol: an operation this server does not know, or an
        // event that does not fit its operation's schema, can never be applied.
        const parsed = parseSyncCommand(event);
        if (!parsed.ok) {
          rejected.push({
            eventId: event.eventId,
            code:
              parsed.kind === "unsupported_operation"
                ? "UNSUPPORTED_SYNC_OPERATION"
                : "INVALID_SYNC_COMMAND",
            reason: parsed.reason,
          });
          continue;
        }
        const command = parsed.command;

        // The same right the online route of this operation asks for. Decided
        // before anything is prepared or applied: a denied event writes nothing
        // and is refused for good (the desktop dead-letters it).
        // The role is the one the member holds in the event's own unit.
        const permission = authorizeSyncOperation(
          memberForEventUnit(memberData, event),
          command.operation,
        );
        if (
          !permission.allowed &&
          // A retry of an event that was applied is acknowledged, not re-decided.
          !(await isDesktopSyncEventApplied(memberData.organizationId, event))
        ) {
          rejected.push({
            eventId: event.eventId,
            code: permission.code,
            reason: permission.reason,
          });
          continue;
        }

        // Checked after the event's own validation, so a refusal of its own (scope,
        // permission, a malformed command) keeps its precise reason.
        const precedingEventId =
          aggregateKey === null
            ? undefined
            : unappliedAggregates.get(aggregateKey);
        if (precedingEventId !== undefined) {
          rejected.push({
            eventId: event.eventId,
            code: "SYNC_PRECEDING_EVENT_NOT_APPLIED",
            reason: `An earlier change to the same record (${precedingEventId}) was not applied in this push, so this one was not either.`,
          });
          continue;
        }

        let prepared: PreparedDesktopEventSideEffects;
        try {
          prepared = await prepareDesktopEventSideEffects(command, memberData, {
            env: c.env,
            protocolVersion,
          });
        } catch (error) {
          console.error(
            "[Sync] Preparing a desktop sync event failed:",
            event.eventId,
            error,
          );
          rejected.push({
            eventId: event.eventId,
            code: "DESKTOP_SYNC_APPLY_FAILED",
            // The cause is in the server log above; not echoed to the device.
            reason: "Desktop sync event could not be prepared.",
          });
          continue;
        }

        if (prepared.refusal) {
          rejected.push({ eventId: event.eventId, ...prepared.refusal });
          continue;
        }

        const outcome = await applyDesktopEventAtomically({
          organizationId: memberData.organizationId,
          event,
          expectedVersion: event.expectedVersion,
          findLegacyApplied: (o) =>
            findAppliedDesktopSyncEvent(memberData.organizationId, event, o),
          apply: (o) =>
            applyDesktopSyncEvent({
              event: command,
              memberData,
              o,
              sessionUserId: session.user.id,
              deviceId: body.deviceId,
              clientBatchId: body.clientBatchId,
              minimumDesktopVersion,
              batch,
              prepared,
            }),
        });

        switch (outcome.state) {
          case "already_applied": {
            noteAppliedJobVersion(batch, command, outcome.remoteEntity);
            accepted.push({
              eventId: event.eventId,
              remoteEntityId: outcome.remoteEntityId,
              remoteEntity: outcome.remoteEntity,
              // A replay answers what the first application did: its recorded version.
              ...(outcome.aggregateVersion === undefined
                ? { remoteVersion: event.localVersion + 1 }
                : {
                    remoteVersion: outcome.aggregateVersion,
                    aggregateVersion: outcome.aggregateVersion,
                  }),
              cloudEventId: `cloud:${event.eventId}`,
            });
            break;
          }
          case "in_progress": {
            // Another push of this very op is applying it right now. Not
            // acknowledged (it may still fail) and not applied a second time:
            // the desktop keeps it queued and retries.
            rejected.push({
              eventId: event.eventId,
              code: "SYNC_EVENT_IN_PROGRESS",
              reason: "This sync event is being applied by another request.",
            });
            break;
          }
          case "failed": {
            // Rolled back whole; reported for this event only. Transient: the
            // cause (a write, an audit row, the commit) may not repeat.
            console.error(
              "[Sync] Desktop sync event failed and was rolled back:",
              event.eventId,
              outcome.message,
            );
            rejected.push({
              eventId: event.eventId,
              code: "DESKTOP_SYNC_APPLY_FAILED",
              reason: outcome.message,
            });
            break;
          }
          case "refused": {
            const result = outcome.result;
            if (result.conflict) {
              conflicts.push({
                id: buildDesktopSyncConflictId(event),
                eventId: event.eventId,
                entityType: event.entityType,
                entityId: event.entityId,
                conflictType: result.conflict.conflictType,
                status: "open",
                localPayload: event.payload,
                remotePayload: result.conflict.remotePayload ?? {},
              });
              break;
            }
            rejected.push({
              eventId: event.eventId,
              code: result.code,
              reason: result.reason,
            });
            break;
          }
          case "applied": {
            noteAppliedJobVersion(batch, command, outcome.result.remoteEntity);
            accepted.push({
              eventId: event.eventId,
              remoteEntityId: outcome.result.remoteEntityId,
              remoteEntity: outcome.result.remoteEntity,
              remoteVersion: outcome.aggregateVersion,
              aggregateVersion: outcome.aggregateVersion,
              cloudEventId: `cloud:${event.eventId}`,
            });
            break;
          }
        }
      } finally {
        const eventId = rejectedEventId(rawEvent, index);
        if (
          aggregateKey !== null &&
          !unappliedAggregates.has(aggregateKey) &&
          !accepted.some((item) => item.eventId === eventId)
        ) {
          unappliedAggregates.set(aggregateKey, eventId);
        }
      }
    }

    return c.json(
      syncPushResponseSchema.parse({
        accepted,
        rejected,
        conflicts,
        newCursor:
          accepted.length > 0 || conflicts.length > 0
            ? buildSyncPushCursor(
                body.clientBatchId,
                accepted.length,
                conflicts.length,
              )
            : (body.baseCursor ?? undefined),
      }),
    );
  },
);
