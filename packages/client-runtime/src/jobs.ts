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
  /**
   * ISO/IEC 17025 §7.8.2.1(n) — additions to, deviations from, or exclusions
   * from the method as executed. Omit to leave the stored value untouched
   * (the worksheet auto-saves); send null to clear it.
   */
  methodDeviations?: string | null;
};
