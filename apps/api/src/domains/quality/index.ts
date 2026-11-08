// Public entry of the "quality" domain: the only module other domains, cron and cli import.
// Extend it by adding the name another module needs.
export { createNonConformanceRecord } from "./non-conformances";
export {
  classifyJobScopeCompliance,
  isAdverseScopeCompliance,
} from "./scope-compliance";
export { checkApproverIsAuthorizedSignatory } from "./signatory";
