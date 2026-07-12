export type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

export type AssetCertificate = {
  id: number;
  jobId: string;
  certificateName: string | null;
  status: string;
  performedAt: string | null;
  approvedAt: string | null;
  certificateUrl: string | null;
  verificationToken: string;
  serviceName: string;
  labName: string;
};

export type AssetDetail = {
  id: number;
  /** Opaque identifier used in portal URLs (never the serial id). */
  publicId: string;
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
  status: AssetStatus;
  specifications: Record<string, unknown> | null;
  lastCalibrationDate: string | null;
  nextCalibrationDate: string | null;
  // Track 1 — customer-owned calibration interval (periodicity). The customer sets it
  // here for EVERY regime (§7.8.4.3 + ILAC-G24); the lab never attributes it.
  calibrationIntervalMonths: number | null;
  intervalSetBy: "customer_confirmed" | "engine_applied" | null;
  // Track 2 — legal-metrology regime + the regulation-fixed VERIFICATION periodicity
  // (independent of Track 1; lab-recorded, read-only for the customer).
  metrologyRegime: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
  regulatedInterval: {
    kind:
      | "fixed_months"
      | "max_months_from_install"
      | "per_technology"
      | "not_nationally_fixed";
    regulationReference: string;
    operationalizedByDelegate: boolean;
  } | null;
  nextLegalVerificationDate: string | null;
  inLab: boolean;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
  certificates: Array<AssetCertificate>;
  /** Total approved certificates; `certificates` holds only the 5 newest. */
  certificateCount: number;
};

export type IntervalInsight = {
  classification: "INSUFFICIENT_DATA" | "STABLE" | "DRIFTING";
  reliability: number | null;
  coverage: number;
  recommendation: {
    action: "extend" | "keep" | "shorten";
    method: string;
    proposedIntervalMonths: number;
    reliabilityBound: number | null;
  } | null;
  series: Array<{
    approvedAt: string;
    conformity: "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";
    minMargin: number | null;
  }>;
  engineVersion: string;
  fingerprint: string;
};
