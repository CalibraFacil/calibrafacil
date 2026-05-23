import type { Hono } from "hono";
import { apiKeysRouter } from "../routes/api-keys";
import { assetTypesRouter } from "../routes/asset-types";
import { assetsRouter } from "../routes/assets";
import { backofficeRouter } from "../routes/backoffice";
import { billingRouter } from "../routes/billing";
import { calibrationRequestsRouter } from "../routes/calibration-requests";
import { capaRouter } from "../routes/capa";
import { certificateNumberingRouter } from "../routes/certificate-numbering";
import { certificateTemplatesRouter } from "../routes/certificate-templates";
import { competencesRouter } from "../routes/competences";
import { customerSuccessRouter } from "../routes/customer-success";
import { customersRouter } from "../routes/customers";
import { dashboardRouter } from "../routes/dashboard";
import { environmentalLimitsRouter } from "../routes/environmental-limits";
import { financeRouter } from "../routes/finance";
import { integrationsRouter } from "../routes/integrations";
import { internalCustomerSuccessRouter } from "../routes/internal-customer-success";
import { invitationsRouter } from "../routes/invitations";
import { labSetupRouter } from "../routes/lab-setup";
import { jobsRouter } from "../routes/jobs";
import { methodsRouter } from "../routes/methods";
import { notificationsRouter } from "../routes/notifications";
import { nonConformancesRouter } from "../routes/non-conformances";
import { organizationMediaRouter } from "../routes/organization-media";
import { portalDomainsRouter } from "../routes/portal-domains";
import { portalRequestsRouter } from "../routes/portal-requests";
import { portalRouter } from "../routes/portal";
import { profileMediaRouter } from "../routes/profile-media";
import { publicApiRouter } from "../routes/public-api";
import {
  publicApiV2DocsRouter,
  publicApiV2Router,
} from "../routes/public-api-v2";
import { publicCommercialCheckoutRouter } from "../routes/public-commercial-checkout";
import { reportsRouter } from "../routes/reports";
import {
  portalServiceOrdersRouter,
  publicServiceOrderAccessRouter,
  serviceOrdersRouter,
} from "../routes/service-orders";
import { servicesRouter } from "../routes/services";
import { sessionsRouter } from "../routes/sessions";
import { signaturesRouter } from "../routes/signatures";
import { signingRouter } from "../routes/signing";
import { ssoRouter } from "../routes/sso";
import { standardsRouter } from "../routes/standards";
import { syncRouter } from "../routes/sync";
import { trainingRecordsRouter } from "../routes/training-records";
import { unitsRouter } from "../routes/units";
import { verifyRouter } from "../routes/verify";
import { webhooksRouter } from "../routes/webhooks";
import type { Env } from "./env";

export function mountApiRoutes(app: Hono<{ Bindings: Env }>) {
  return app
    .get("/", (c) =>
      c.json({
        name: "CalibraFácil API",
        status: "ok",
      }),
    )
    .get("/api", (c) =>
      c.json({
        name: "CalibraFácil API",
        status: "ok",
      }),
    )
    .get("/hello", (c) => c.json({ message: "Hello!" }))
    .route("/api/customers", customersRouter)
    .route("/api/invitations", invitationsRouter)
    .route("/api/lab-setup", labSetupRouter)
    .route("/api/portal", portalRouter)
    .route("/api/portal/requests", portalRequestsRouter)
    .route("/api/portal/service-orders", portalServiceOrdersRouter)
    .route("/api/assets", assetsRouter)
    .route("/api/asset-types", assetTypesRouter)
    .route("/api/methods", methodsRouter)
    .route("/api/services", servicesRouter)
    .route("/api/standards", standardsRouter)
    .route("/api/jobs", jobsRouter)
    .route("/api/service-orders", serviceOrdersRouter)
    .route("/api/calibration-requests", calibrationRequestsRouter)
    .route("/api/verify", verifyRouter)
    .route("/api/dashboard", dashboardRouter)
    .route("/api/reports", reportsRouter)
    .route("/api/billing", billingRouter)
    .route("/api/finance", financeRouter)
    .route("/api/webhooks", webhooksRouter)
    .route("/api/notifications", notificationsRouter)
    .route("/api/signatures", signaturesRouter)
    .route("/api/signing", signingRouter)
    .route("/api/nc", nonConformancesRouter)
    .route("/api/capa", capaRouter)
    .route("/api/environmental-limits", environmentalLimitsRouter)
    .route("/api/competences", competencesRouter)
    .route("/api/training-records", trainingRecordsRouter)
    .route("/api/sessions", sessionsRouter)
    .route("/api/sso", ssoRouter)
    .route("/api/api-keys", apiKeysRouter)
    .route("/api/portal-domains", portalDomainsRouter)
    .route("/api/certificate-templates", certificateTemplatesRouter)
    .route("/api/certificate-numbering", certificateNumberingRouter)
    .route("/api/units", unitsRouter)
    .route("/api/integrations", integrationsRouter)
    .route("/api/sync", syncRouter)
    .route("/api/customer-success", customerSuccessRouter)
    .route("/api/backoffice", backofficeRouter)
    .route("/api/internal/customer-success", internalCustomerSuccessRouter)
    .route("/api/organization-media", organizationMediaRouter)
    .route("/api/profile-media", profileMediaRouter)
    .route("/api/public/commercial-checkout", publicCommercialCheckoutRouter)
    .route("/api/public/service-order-access", publicServiceOrderAccessRouter)
    .route("/api/public/v1", publicApiRouter)
    .route("/api/public/v2", publicApiV2DocsRouter)
    .route("/api/public/v2", publicApiV2Router);
}
