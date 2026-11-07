// Inventory classifications as data: asset.status, reference_standard.status
// and mass_composition_profile.status.
import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";
import { defineStateMachine, type Transition } from "../state-machine";

function everyPair<S extends string, C extends string>(
  states: readonly S[],
  command: C,
): Transition<S, C>[] {
  const rows: Transition<S, C>[] = [];
  for (const from of states) {
    for (const to of states) {
      if (from !== to) rows.push({ from, command, to });
    }
  }
  return rows;
}

function createdIn<S extends string>(
  states: readonly S[],
): Transition<S, "create">[] {
  return states.map((to) => ({ from: null, command: "create", to }));
}

// asset.status: the customer instrument's condition, a classification the lab
// edits freely. Every status may be created and set from every other:
//   create      routes/assets.ts POST, public-api-v2/assets-create.ts, the
//                 desktop asset create (sync apply-job-draft-and-asset-create.ts)
//   set_status  routes/assets.ts PUT, public-api-v2/assets-update.ts, the
//                 desktop asset update (sync apply-asset-update.ts)
// SCRAPPED is reversible by design today (audit decision Q60: asset statuses
// stay free classifications).
export const ASSET_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "MAINTENANCE",
  "SCRAPPED",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS = defineStatusVocabulary(ASSET_STATUSES, {
  ACTIVE: { label: "Ativo", tone: "ok" },
  INACTIVE: { label: "Inativo", tone: "neutral" },
  MAINTENANCE: { label: "Em manutenção", tone: "warning" },
  SCRAPPED: { label: "Descartado", tone: "critical" },
});

export const ASSET_MACHINE = defineStateMachine({
  name: "asset",
  states: ASSET_STATUSES,
  commands: ["create", "set_status"],
  transitions: [
    ...createdIn(ASSET_STATUSES),
    ...everyPair(ASSET_STATUSES, "set_status"),
  ],
});

// reference_standard.status: whether a standard may be used in a measurement
// (judgeExecutionStandards refuses any status but ACTIVE).
//   create      routes/standards.ts POST (any status)
//   set_status  routes/standards.ts PUT /:id (the status picker, the "flag out
//                 of tolerance" and "send for calibration" actions of the list);
//                 never back to ACTIVE from OUT_OF_TOLERANCE/SENT_FOR_CALIBRATION
//   renew       routes/standards.ts POST /:id/renew-certificate: a new
//                 certificate brings an out-of-tolerance or sent standard back
//   retire      routes/standards.ts DELETE /:id (soft delete)
export const REFERENCE_STANDARD_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "OUT_OF_TOLERANCE",
  "SENT_FOR_CALIBRATION",
] as const;
export type ReferenceStandardStatus =
  (typeof REFERENCE_STANDARD_STATUSES)[number];

export const REFERENCE_STANDARD_STATUS = defineStatusVocabulary(
  REFERENCE_STANDARD_STATUSES,
  {
    ACTIVE: { label: "Ativo", tone: "ok" },
    INACTIVE: { label: "Inativo", tone: "neutral" },
    OUT_OF_TOLERANCE: { label: "Fora de tolerância", tone: "critical" },
    SENT_FOR_CALIBRATION: { label: "Em calibração", tone: "warning" },
  },
);

export const REFERENCE_STANDARD_MACHINE = defineStateMachine({
  name: "reference standard",
  states: REFERENCE_STANDARD_STATUSES,
  commands: ["create", "set_status", "renew", "retire"],
  transitions: [
    ...createdIn(REFERENCE_STANDARD_STATUSES),
    // Out of tolerance or away for calibration, a standard comes back to use
    // only through `renew` (a new certificate, a reason, its audit entry; ISO/IEC
    // 17025 §6.4.9), never by picking ACTIVE (decision Q60).
    ...everyPair(REFERENCE_STANDARD_STATUSES, "set_status").filter(
      (row) =>
        !(
          row.to === "ACTIVE" &&
          (row.from === "OUT_OF_TOLERANCE" ||
            row.from === "SENT_FOR_CALIBRATION")
        ),
    ),
    { from: "OUT_OF_TOLERANCE", command: "renew", to: "ACTIVE" },
    { from: "SENT_FOR_CALIBRATION", command: "renew", to: "ACTIVE" },
    { from: "ACTIVE", command: "retire", to: "INACTIVE" },
    { from: "INACTIVE", command: "retire", to: "INACTIVE" },
    { from: "OUT_OF_TOLERANCE", command: "retire", to: "INACTIVE" },
    { from: "SENT_FOR_CALIBRATION", command: "retire", to: "INACTIVE" },
  ],
});

// mass_composition_profile.status: INACTIVE exactly when soft-deleted
// (deletedAt set). Saving a profile for the same class and nominal reactivates
// the deleted row.
//   create      routes/standards.ts PUT /mass-profiles (new row)
//   reactivate  the same, on a deleted row
//   retire      routes/standards.ts DELETE /mass-profiles/:id
const MASS_PROFILE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type MassProfileStatus = (typeof MASS_PROFILE_STATUSES)[number];

export const MASS_PROFILE_STATUS = defineStatusVocabulary(
  MASS_PROFILE_STATUSES,
  {
    ACTIVE: { label: "Ativo", tone: "ok" },
    INACTIVE: { label: "Inativo", tone: "neutral" },
  },
);

export const MASS_PROFILE_MACHINE = defineStateMachine({
  name: "mass composition profile",
  states: MASS_PROFILE_STATUSES,
  commands: ["create", "reactivate", "retire"],
  transitions: [
    { from: null, command: "create", to: "ACTIVE" },
    { from: "INACTIVE", command: "reactivate", to: "ACTIVE" },
    { from: "ACTIVE", command: "reactivate", to: "ACTIVE" },
    { from: "ACTIVE", command: "retire", to: "INACTIVE" },
  ],
});
