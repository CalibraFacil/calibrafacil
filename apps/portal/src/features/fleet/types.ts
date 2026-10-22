/**
 * Client-facing DTOs for the fleet (equipment) feature, mirroring the
 * `/api/portal/assets` responses. The instrument list is the customer's
 * metrology-program cockpit: identity, calibration status (including
 * "in lab"), and the latest approved certificate per instrument.
 */

import type {
  PortalFleetAsset,
  PortalFleetAssetsResponse,
} from "@calibra-facil/contracts";

export type FleetAssetStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "MAINTENANCE"
  | "SCRAPPED";

export type FleetAsset = PortalFleetAsset;

/** Server-side sort fields accepted by `/api/portal/assets`. */
export const FLEET_SORT_FIELDS = [
  "tag",
  "name",
  "nextCalibrationDate",
  "lastCalibrationDate",
] as const;

export type FleetSortBy = (typeof FLEET_SORT_FIELDS)[number];

export function isFleetSortBy(value: unknown): value is FleetSortBy {
  return (
    typeof value === "string" &&
    FLEET_SORT_FIELDS.some((field) => field === value)
  );
}

export type FleetAssetsResponse = PortalFleetAssetsResponse;
