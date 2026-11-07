// ERP integrations as data.
import {
  INTEGRATION_STATUSES,
  INTEGRATION_SYNC_ITEM_STATUSES,
  INTEGRATION_SYNC_STATUSES,
} from "@calibra-facil/shared";
import { defineStateMachine } from "../state-machine";

// organization_integration.status: whether the integration may run.
//   create          routes/integrations.ts (connect, OAuth callback): ACTIVE
//   reconnect       the OAuth reconnect: any status back to ACTIVE
//   recover         a token refresh or a validation that succeeds again
//   require_action  a refresh/validation/export that needs the lab (expired
//                     credentials): ACTION_REQUIRED, from any status
//   disable         the toggle off and the disconnect
//   enable          the toggle on (never from ACTION_REQUIRED: reconnect first)
export const INTEGRATION_MACHINE = defineStateMachine({
  name: "integration",
  states: INTEGRATION_STATUSES,
  commands: [
    "create",
    "reconnect",
    "recover",
    "require_action",
    "disable",
    "enable",
  ],
  transitions: [
    { from: null, command: "create", to: "ACTIVE" },
    { from: "ACTIVE", command: "reconnect", to: "ACTIVE" },
    { from: "DISABLED", command: "reconnect", to: "ACTIVE" },
    { from: "ACTION_REQUIRED", command: "reconnect", to: "ACTIVE" },
    { from: "ACTION_REQUIRED", command: "recover", to: "ACTIVE" },
    { from: "ACTIVE", command: "require_action", to: "ACTION_REQUIRED" },
    { from: "DISABLED", command: "require_action", to: "ACTION_REQUIRED" },
    {
      from: "ACTION_REQUIRED",
      command: "require_action",
      to: "ACTION_REQUIRED",
    },
    { from: "ACTIVE", command: "disable", to: "DISABLED" },
    { from: "ACTION_REQUIRED", command: "disable", to: "DISABLED" },
    { from: "DISABLED", command: "disable", to: "DISABLED" },
    { from: "DISABLED", command: "enable", to: "ACTIVE" },
  ],
});

// integration_sync_run.status: one sync of one target.
//   create  apps/api/src/modules/integrations/sync-run.ts and
//             packages/jobs-core/src/integrations/runs.ts: PENDING
//   start   the API runner and the worker (process-sync.ts); a redelivered
//             message restarts a run left RUNNING by a crash, and never revives
//             a finished one
//   finish  COMPLETED, PARTIAL or FAILED from the item counts
//   fail    a blocked or crashed run, before or while running
export const INTEGRATION_SYNC_RUN_MACHINE = defineStateMachine({
  name: "integration sync run",
  states: INTEGRATION_SYNC_STATUSES,
  commands: ["create", "start", "finish", "fail"],
  transitions: [
    { from: null, command: "create", to: "PENDING" },
    { from: "PENDING", command: "start", to: "RUNNING" },
    { from: "RUNNING", command: "start", to: "RUNNING" },
    { from: "RUNNING", command: "finish", to: "COMPLETED" },
    { from: "RUNNING", command: "finish", to: "PARTIAL" },
    { from: "RUNNING", command: "finish", to: "FAILED" },
    { from: "PENDING", command: "fail", to: "FAILED" },
    { from: "RUNNING", command: "fail", to: "FAILED" },
  ],
});

// integration_sync_item.status: one entity pushed by a run (sync-run.ts).
//   create   the push starts: RUNNING
//   succeed  the remote accepted it
//   fail     FAILED, or DEAD_LETTER once the entity failed often enough
export const INTEGRATION_SYNC_ITEM_MACHINE = defineStateMachine({
  name: "integration sync item",
  states: INTEGRATION_SYNC_ITEM_STATUSES,
  commands: ["create", "succeed", "fail"],
  transitions: [
    { from: null, command: "create", to: "RUNNING" },
    { from: "RUNNING", command: "succeed", to: "SUCCEEDED" },
    { from: "RUNNING", command: "fail", to: "FAILED" },
    { from: "RUNNING", command: "fail", to: "DEAD_LETTER" },
  ],
});
