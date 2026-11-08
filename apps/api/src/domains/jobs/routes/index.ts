// Mount entry of the "jobs" domain: the routers server/route-mounts mounts.
// Extend it by adding the name another module needs.
export { certificateNumberingRouter } from "./certificate-numbering";
export { jobsRouter } from "./jobs";
export { ootAckRouter } from "./oot-ack";
