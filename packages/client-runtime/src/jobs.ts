export type JobsListStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "SUPERSEDED";

export type JobsListData = {
  data: Array<{
    id: number;
    jobId: string;
    customerName: string | null;
    assetName: string | null;
    serviceName: string | null;
    technicianName: string | null;
    status: JobsListStatus;
    dueDate: string | null;
    isOverdue: boolean | null;
    createdAt: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type LocalCertificateDraft = {
  id: string;
  jobId: string;
  localPath: string | null;
  status: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  contentType: string;
  fileUrl: string;
  draftKind: "local_certificate_draft";
  published: false;
};

export type JobExecutionPayload = {
  selectedStandardIds?: number[];
  data: Record<string, unknown>;
  results?: Record<string, unknown> | null;
  environment?: {
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
  };
  calibrationLocation?: {
    type: "customer_site" | "lab" | "other";
    addressText: string;
    notes?: string | null;
  };
  calibrationPhases?: {
    blocks: Record<
      string,
      {
        mode:
          | "before_and_after"
          | "before_only"
          | "after_only"
          | "not_performed";
        reason?: string | null;
      }
    >;
  };
  performedAt?: string;
  backdateReason?: string;
};

export type ReferenceStandardsResponse<TStandard = unknown> = {
  data: TStandard[];
};

export type EffectiveEnvironmentalLimitsResponse<TLimits = unknown> = {
  limits: TLimits | null;
  source: string | null;
};
