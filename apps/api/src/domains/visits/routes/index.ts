// Mount entry of the "visits" domain: the routers server/route-mounts mounts.
// Extend it by adding the name another module needs.
export { calibrationRequestsRouter } from "./calibration-requests";
export {
  visitJobsRouter,
  visitRescheduleRequestsRouter,
  visitsRouter,
} from "./visits";
