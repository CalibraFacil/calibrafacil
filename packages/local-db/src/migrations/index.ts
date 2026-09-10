import { migration0001InitialOperationalSubset } from "./0001_initial_operational_subset";
import { migration0002ServiceOrderIntake } from "./0002_service_order_intake";
import { migration0003ServiceOrderWorkflowDrafts } from "./0003_service_order_workflow_drafts";
import { migration0004AssetEditFields } from "./0004_asset_edit_fields";
import { migration0005SyncConflictEventId } from "./0005_sync_conflict_event_id";
import { migration0006CalibrationLocationSnapshot } from "./0006_calibration_location_snapshot";
import { migration0007CalibrationPhaseSnapshot } from "./0007_calibration_phase_snapshot";
import { migration0008PrinterProfiles } from "./0008_printer_profiles";
import { migration0009AssetSubjectToLegalMetrology } from "./0009_asset_subject_to_legal_metrology";
import { migration0010MassCompositionProfiles } from "./0010_mass_composition_profiles";
import { migration0011AssetLegalMetrologyRegime } from "./0011_asset_legal_metrology_regime";
import { migration0012ServiceOrderItemMaterial } from "./0012_service_order_item_material";
import { migration0013OfficialSealingMarkTerminology } from "./0013_official_sealing_mark_terminology";
import { migration0014SyncBaseVersionAnchor } from "./0014_sync_base_version_anchor";
import { migration0015NonConformances } from "./0015_non_conformances";
import { migration0016CalibrationJobScopeCompliance } from "./0016_calibration_job_scope_compliance";
import { migration0017ServiceOrderPublicId } from "./0017_service_order_public_id";
import { migration0018CalibrationJobMethodDeviations } from "./0018_calibration_job_method_deviations";

import { migration0019LocalDatabaseOwner } from "./0019_local_database_owner";

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
  migration0006CalibrationLocationSnapshot,
  migration0007CalibrationPhaseSnapshot,
  migration0008PrinterProfiles,
  migration0009AssetSubjectToLegalMetrology,
  migration0010MassCompositionProfiles,
  migration0011AssetLegalMetrologyRegime,
  migration0012ServiceOrderItemMaterial,
  migration0013OfficialSealingMarkTerminology,
  migration0014SyncBaseVersionAnchor,
  migration0015NonConformances,
  migration0016CalibrationJobScopeCompliance,
  migration0017ServiceOrderPublicId,
  migration0018CalibrationJobMethodDeviations,
  migration0019LocalDatabaseOwner,
];

export const currentLocalDbSchemaVersion =
  localDbMigrations[localDbMigrations.length - 1]?.id ?? 0;
