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
  validateSyncActorScope,
} from "../../modules/sync/desktop-sync-support";
import { prepareDesktopEventSideEffects } from "../../modules/sync/side-effects";
import { applyDesktopSyncEvent } from "../../modules/sync/apply-event";
import { authorizeSyncOperation } from "../../modules/sync/operation-permissions";

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

    for (const [index, rawEvent] of body.events.entries()) {
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
          reason: "Sync event organization does not match active organization.",
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
      const permission = authorizeSyncOperation(memberData, command.operation);
      if (!permission.allowed) {
        rejected.push({
          eventId: event.eventId,
          code: permission.code,
          reason: permission.reason,
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
          reason:
            error instanceof Error
              ? error.message
              : "Desktop sync event could not be prepared.",
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
            remoteVersion: event.localVersion + 1,
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
            remoteVersion: event.localVersion + 1,
            cloudEventId: `cloud:${event.eventId}`,
          });
          break;
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
