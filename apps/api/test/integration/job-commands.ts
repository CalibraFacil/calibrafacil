import { withOrg } from "../../src/lib/org-context";
import {
  amendJob,
  type AmendJobCommand,
} from "../../src/domains/jobs/commands/amend-job";
import {
  cancelJob,
  type CancelJobCommand,
} from "../../src/domains/jobs/commands/cancel-job";

/**
 * The job lifecycle commands take the context of the caller's `withOrg`. These
 * open it as the command's own actor, for the specs that exercise one command
 * on its own.
 */
function actorOf(command: AmendJobCommand | CancelJobCommand) {
  return {
    userId: command.actor.userId,
    ipAddress: command.actor.ipAddress ?? null,
  };
}

export function cancelJobInOrg(command: CancelJobCommand) {
  return withOrg(command.organizationId, actorOf(command), (ctx) =>
    cancelJob(ctx, command),
  );
}

export function amendJobInOrg(command: AmendJobCommand) {
  return withOrg(command.organizationId, actorOf(command), (ctx) =>
    amendJob(ctx, command),
  );
}
