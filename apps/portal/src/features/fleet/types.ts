/**
 * Client-facing DTOs for the fleet (equipment) feature, mirroring the
 * `/api/portal/assets` responses. The instrument list is the customer's
 * metrology-program cockpit: identity, calibration status (including
 * "in lab"), and the latest approved certificate per instrument.
 */

export type FleetAssetStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "MAINTENANCE"
  | "SCRAPPED";

export type FleetLastCertificate = {
  id: number;
  jobId: string;
  approvedAt: string | null;
};

export type FleetAsset = {
  id: number;
  customerId: number;
  customerName: string;
  assetTypeId: number;
  assetTypeName: string;
  assetTypeSlug: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string;
  tag: string;
  status: FleetAssetStatus;
  specifications: Record<string, unknown> | null;
  lastCalibrationDate: string | null;
  nextCalibrationDate: string | null;
  /** True while the instrument has an open calibration job or service order. */
  inLab: boolean;
  lastCertificate: FleetLastCertificate | null;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export type FleetAssetsResponse = {
  data: Array<FleetAsset>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
