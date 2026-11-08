// Public entry of the "reports" domain: the only module other domains, cron and cli import.
// Extend it by adding the name another module needs.
export { resolvePeriodRange } from "./report-period";
export {
  buildReportScopeSummary,
  getHealthReason,
  getHealthStatus,
  getPeriodLabel,
  parseRequestedUnitIds,
} from "./report-support";
export {
  readConsolidatedUnitCounts,
  sumCounts,
  type ConsolidatedCutoffs,
} from "./consolidated-counts";
