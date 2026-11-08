// Public entry of the "sync" domain: the only module other domains, cron and cli import.
// Extend it by adding the name another module needs.
export { purgeSyncChangeLog } from "./sync-change-log-purge";
