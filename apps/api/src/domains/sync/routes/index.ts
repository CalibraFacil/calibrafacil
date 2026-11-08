import { createRouter } from "../../../server/router";
import { type SyncRouterEnv } from "./env";
import { bootstrapRoutes } from "./bootstrap";
import { pushRoutes } from "./push";
import { pullRoutes } from "./pull";
import { conflictRoutes } from "./conflicts";
import { attachmentRoutes } from "./attachments";

export const syncRouter = createRouter<SyncRouterEnv>();

syncRouter
  .route("/", bootstrapRoutes)
  .route("/", pushRoutes)
  .route("/", pullRoutes)
  .route("/", conflictRoutes)
  .route("/", attachmentRoutes);

// Names the router's specs (and nothing else) import from here; they live in
// domains/sync.
export {
  DESKTOP_SERVICE_ORDER_NULLABLE_KEYS,
  DesktopCreateAssetSchema,
  stripDesktopNullEntries,
} from "../desktop-schemas";
export {
  detectStaleDesktopBase,
  resolveDesktopPerformedAt,
} from "../desktop-event-support";
