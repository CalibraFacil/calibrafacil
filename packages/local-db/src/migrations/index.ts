import { migration0001InitialOperationalSubset } from "./0001_initial_operational_subset";
import { migration0002ServiceOrderIntake } from "./0002_service_order_intake";
import { migration0003ServiceOrderWorkflowDrafts } from "./0003_service_order_workflow_drafts";
import { migration0004AssetEditFields } from "./0004_asset_edit_fields";
import { migration0005SyncConflictEventId } from "./0005_sync_conflict_event_id";

export type LocalDbMigration = {
  id: number;
  name: string;
  sql: string;
};

export const localDbMigrations: LocalDbMigration[] = [
  migration0001InitialOperationalSubset,
  migration0002ServiceOrderIntake,
  migration0003ServiceOrderWorkflowDrafts,
  migration0004AssetEditFields,
  migration0005SyncConflictEventId,
];

export const currentLocalDbSchemaVersion =
  localDbMigrations[localDbMigrations.length - 1]?.id ?? 0;
