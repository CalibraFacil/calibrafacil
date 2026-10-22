import { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";
import { type R2Env } from "../../lib/storage";
import { requireApiKeyAuth } from "../../middleware/api-key-auth";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
} from "../../middleware/permission";
import { buildPublicApiV2OpenApiDocument } from "../public-api-v2.openapi";
import { type PublicApiV2Env } from "./env";
import { customerRoutes } from "./customers";
import { assetReadRoutes } from "./assets-read";
import { assetCreateRoutes } from "./assets-create";
import { assetUpdateRoutes } from "./assets-update";
import { serviceRoutes } from "./services";
import { unitRoutes } from "./units";
import { reportRoutes } from "./reports";
import { certificateRoutes } from "./certificates";
import { requestReadRoutes } from "./requests-read";
import { requestWriteRoutes } from "./requests-write";
import { jobReadRoutes } from "./jobs-read";
import { jobWriteRoutes } from "./jobs-write";
import { jobDecisionRoutes } from "./jobs-decisions";
import { webhookRoutes } from "./webhooks";

export const publicApiV2Router = new Hono<PublicApiV2Env>();

const requirePublicApiDocsAccess = [
  ...requireLabProtected,
  requireOrgType("LAB"),
  requireRole(["admin", "owner"]),
] as const;

export const publicApiV2DocsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env & {
    PUBLIC_API_MASTER_KEY?: string;
    INTEGRATIONS_MASTER_KEY?: string;
  };
}>();

publicApiV2DocsRouter.get("/openapi", ...requirePublicApiDocsAccess, (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(buildPublicApiV2OpenApiDocument(origin));
});

publicApiV2DocsRouter.get(
  "/reference",
  ...requirePublicApiDocsAccess,
  Scalar({
    url: "/api/public/v2/openapi",
    pageTitle: "CalibraFácil Public API",
    theme: "bluePlanet",
    defaultHttpClient: {
      targetKey: "js",
      clientKey: "fetch",
    },
  }),
);

publicApiV2Router
  .use("*", requireApiKeyAuth)
  .route("/", customerRoutes)
  .route("/", assetReadRoutes)
  .route("/", assetCreateRoutes)
  .route("/", assetUpdateRoutes)
  .route("/", serviceRoutes)
  .route("/", unitRoutes)
  .route("/", reportRoutes)
  .route("/", certificateRoutes)
  .route("/", requestReadRoutes)
  .route("/", requestWriteRoutes)
  .route("/", jobReadRoutes)
  .route("/", jobWriteRoutes)
  .route("/", jobDecisionRoutes)
  .route("/", webhookRoutes);
