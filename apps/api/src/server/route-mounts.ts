import type { Hono } from "hono";
import { apiKeysRouter } from "../routes/api-keys";
import { assetTypesRouter } from "../routes/asset-types";
import { assetsRouter } from "../routes/assets";
import { backofficeRouter } from "../routes/backoffice";
import { billingRouter } from "../routes/billing";
import { calibrationRequestsRouter } from "../routes/calibration-requests";
import { visitJobsRouter, visitsRouter } from "../routes/visits";
import { authorizedSignatoriesRouter } from "../routes/authorized-signatories";
import { capaRouter } from "../routes/capa";
import { proficiencyTestsRouter } from "../routes/proficiency-tests";
import { spcRouter } from "../routes/spc";
import { certificateNumberingRouter } from "../routes/certificate-numbering";
import { certificateTemplatesRouter } from "../routes/certificate-templates";
import { competencesRouter } from "../routes/competences";
import { customerGroupsRouter } from "../routes/customer-groups";
import { customerSuccessRouter } from "../routes/customer-success";
import { customersRouter } from "../routes/customers";
import { dashboardRouter } from "../routes/dashboard";
import { environmentalLimitsRouter } from "../routes/environmental-limits";
import { financeRouter } from "../routes/finance";
import { integrationsRouter } from "../routes/integrations";
import { internalCustomerSuccessRouter } from "../routes/internal-customer-success";
import { invitationsRouter } from "../routes/invitations";
import { labSetupRouter } from "../routes/lab-setup";
import { legalMetrologyRegulationsRouter } from "../routes/legal-metrology-regulations";
import { runApiHealthCheck } from "../lib/health";
import { jobsRouter } from "../routes/jobs";
import { methodsRouter } from "../routes/methods";
import { notificationsRouter } from "../routes/notifications";
import { nonConformancesRouter } from "../routes/non-conformances";
import { ootAckRouter } from "../routes/oot-ack";
import { organizationMediaRouter } from "../routes/organization-media";
import { portalDomainsRouter } from "../routes/portal-domains";
import { portalNotificationsRouter } from "../routes/portal-notifications";
import { portalRequestsRouter } from "../routes/portal-requests";
import { portalVisitsRouter } from "../routes/portal-visits";
import { portalRouter } from "../routes/portal";
import { profileMediaRouter } from "../routes/profile-media";
import { publicApiRouter } from "../routes/public-api";
import {
  publicApiV2DocsRouter,
  publicApiV2Router,
} from "../routes/public-api-v2";
import { publicCommercialCheckoutRouter } from "../routes/public-commercial-checkout";
import { publicLeadsRouter } from "../routes/public-leads";
import { reportsRouter } from "../routes/reports";
import {
  portalServiceOrdersRouter,
  publicServiceOrderAccessRouter,
  serviceOrdersRouter,
} from "../routes/service-orders";
import { materialsRouter } from "../routes/materials";
import { servicesRouter } from "../routes/services";
import { sessionsRouter } from "../routes/sessions";
import { signaturesRouter } from "../routes/signatures";
import { signingRouter } from "../routes/signing";
import { ssoRouter } from "../routes/sso";
import { standardsRouter } from "../routes/standards";
import { syncRouter } from "../routes/sync";
import { trainingRecordsRouter } from "../routes/training-records";
import { unitsRouter } from "../routes/units";
import { magicLinkRouter } from "../routes/magic-link";
import { verifyRouter } from "../routes/verify";
import { webhooksRouter } from "../routes/webhooks";
import type { Env } from "./env";

export function mountApiRoutes(
  app: Hono<{ Bindings: Env }>,
): Hono<{ Bindings: Env }> {
  return (
    app
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
      // Readiness probe: checks Postgres, R2 and the job-queue
      // backlog; 503 when a dependency is down. `GET /api` above stays the
      // static liveness response.
      .get("/api/health", async (c) => {
        const report = await runApiHealthCheck(c.env);
        return c.json(report, report.status === "ok" ? 200 : 503);
      })
      .route("/api/customers", customersRouter)
      .route("/api/customer-groups", customerGroupsRouter)
      .route("/api/invitations", invitationsRouter)
      .route("/api/lab-setup", labSetupRouter)
      .route("/api/portal", portalRouter)
      .route("/api/portal/notifications", portalNotificationsRouter)
      .route("/api/portal/requests", portalRequestsRouter)
      .route("/api/portal/visits", portalVisitsRouter)
      .route("/api/portal/service-orders", portalServiceOrdersRouter)
      .route("/api/assets", assetsRouter)
      .route("/api/asset-types", assetTypesRouter)
      .route(
        "/api/legal-metrology-regulations",
        legalMetrologyRegulationsRouter,
      )
      .route("/api/methods", methodsRouter)
      .route("/api/services", servicesRouter)
      .route("/api/materials", materialsRouter)
      .route("/api/standards", standardsRouter)
      .route("/api/jobs", jobsRouter)
      .route("/api/service-orders", serviceOrdersRouter)
      .route("/api/calibration-requests", calibrationRequestsRouter)
      .route("/api/visits", visitsRouter)
      .route("/api/visits", visitJobsRouter)
      .route("/api/verify", verifyRouter)
      .route("/api/magic-link", magicLinkRouter)
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
      .route("/api/proficiency-tests", proficiencyTestsRouter)
      .route("/api/spc", spcRouter)
      .route("/api/environmental-limits", environmentalLimitsRouter)
      .route("/api/authorized-signatories", authorizedSignatoriesRouter)
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
      .route("/api/public/leads", publicLeadsRouter)
      .route("/api/public/oot-ack", ootAckRouter)
      .route("/api/public/service-order-access", publicServiceOrderAccessRouter)
      .route("/api/public/v1", publicApiRouter)
      .route("/api/public/v2", publicApiV2DocsRouter)
      .route("/api/public/v2", publicApiV2Router)
  );
}
