export type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

import type {
  PortalAssetDetail,
  PortalIntervalInsight,
} from "@calibra-facil/contracts";

/** The instrument detail the API sends (contract type). */
export type AssetDetail = PortalAssetDetail;
/** Reliability-based interval analysis (ILAC-G24 / NCSL RP-1). */
export type IntervalInsight = PortalIntervalInsight;
