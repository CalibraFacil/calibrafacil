// Mount entry of the "public-api" domain: the routers server/route-mounts mounts.
// Extend it by adding the name another module needs.
export { publicApiRouter } from "./public-api";
export { publicApiV2DocsRouter, publicApiV2Router } from "./public-api-v2";
