import { Hono } from "hono";
import { type SyncRouterEnv } from "./env";
import { bootstrapRoutes } from "./bootstrap";
import { pushRoutes } from "./push";
import { pullRoutes } from "./pull";
import { conflictRoutes } from "./conflicts";
import { attachmentRoutes } from "./attachments";

export const syncRouter = new Hono<SyncRouterEnv>();

syncRouter
  .route("/", bootstrapRoutes)
  .route("/", pushRoutes)
  .route("/", pullRoutes)
  .route("/", conflictRoutes)
  .route("/", attachmentRoutes);

// Names the router's specs (and nothing else) import from here; they live in
// modules/sync now.
export {
  DESKTOP_SERVICE_ORDER_NULLABLE_KEYS,
  DesktopCreateAssetSchema,
  DesktopUpdateAssetSchema,
  DesktopUpdateServiceOrderExecutionSchema,
  stripDesktopNullEntries,
} from "../../modules/sync/desktop-schemas";
export {
  detectStaleDesktopBase,
  resolveDesktopPerformedAt,
} from "../../modules/sync/desktop-event-support";
export { desktopCustomerSlug } from "../../modules/sync/desktop-customer-org";
