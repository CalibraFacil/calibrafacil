export type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

import type {
  PortalAssetDetail,
  PortalIntervalInsight,
} from "@calibra-facil/contracts";

/** The instrument detail the API sends (contract type). */
export type AssetDetail = PortalAssetDetail;
export type AssetCertificate = AssetDetail["certificates"][number];
/** Reliability-based interval analysis (ILAC-G24 / NCSL RP-1). */
export type IntervalInsight = PortalIntervalInsight;
