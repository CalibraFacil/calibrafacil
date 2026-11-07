import type { Hono } from "hono";
import {
  accreditedScopeRouter,
  authorizedSignatoriesRouter,
  capaRouter,
  proficiencyTestsRouter,
  spcRouter,
  competencesRouter,
  environmentalLimitsRouter,
  nonConformancesRouter,
  trainingRecordsRouter,
} from "../domains/quality/routes";
import {
  apiKeysRouter,
  onboardingRouter,
  invitationsRouter,
  labSetupRouter,
  organizationLifecycleRouter,
  organizationProfileRouter,
  organizationMediaRouter,
  emailDomainsRouter,
  portalDomainsRouter,
  profileMediaRouter,
  publicSignupRouter,
  sessionsRouter,
  signaturesRouter,
  signingRouter,
  ssoRouter,
  unitsRouter,
  magicLinkRouter,
} from "../domains/org/routes";
import {
  assetTypesRouter,
  assetsRouter,
  legalMetrologyRegulationsRouter,
} from "../domains/assets/routes";
import {
  calibrationRequestsRouter,
  visitJobsRouter,
  visitRescheduleRequestsRouter,
  visitsRouter,
} from "../domains/visits/routes";
import {
  certificateNumberingRouter,
  jobsRouter,
  ootAckRouter,
} from "../domains/jobs/routes";
import {
  customerGroupsRouter,
  customersRouter,
} from "../domains/customers/routes";
import { dashboardRouter, reportsRouter } from "../domains/reports/routes";
import { financeRouter } from "../routes/finance";
import { integrationsRouter } from "../routes/integrations";
import { runApiHealthCheck } from "../lib/health";
import { methodsRouter } from "../domains/methods/routes";
import {
  notificationsRouter,
  webhooksRouter,
} from "../domains/notifications/routes";
import {
  portalNotificationsRouter,
  portalRequestsRouter,
  portalVisitsRouter,
  portalRouter,
} from "../domains/portal/routes";
import {
  publicApiRouter,
  publicApiV2DocsRouter,
  publicApiV2Router,
} from "../domains/public-api/routes";
import {
  portalServiceOrdersRouter,
  publicServiceOrderAccessRouter,
  serviceOrdersRouter,
} from "../domains/service-orders/routes";
import { materialsRouter, servicesRouter } from "../domains/catalog/routes";
import { standardsRouter } from "../domains/standards/routes";
import { syncRouter } from "../domains/sync/routes";
import { verifyRouter } from "../domains/verify/routes";
import type { Env } from "./env";

import { readCronSuccesses, readHealthAlerts } from "../lib/health-alerts";
import {
  metricsAuthorized,
  readQueueForMetrics,
  renderMetrics,
} from "./observability";
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
        const report = await runApiHealthCheck({ ...c.env });
        if (report.status !== "ok") return c.json(report, 503);
        // Readiness holds; what needs an operator (a stale or failing cron,
        // dead letters) is reported here and does not take the API out of
        // service. /api/health/alerts is the 503 an uptime monitor watches.
        const alerts = await readHealthAlerts().catch(() => null);
        return c.json({
          ...report,
          status: alerts && !alerts.ok ? "degraded" : "ok",
          alerts,
        });
      })
      .get("/api/health/alerts", async (c) => {
        const alerts = await readHealthAlerts();
        return c.json(alerts, alerts.ok ? 200 : 503);
      })
      .get("/api/metrics", async (c) => {
        if (!metricsAuthorized(c)) return c.notFound();
        const [queue, crons] = await Promise.all([
          readQueueForMetrics(),
          readCronSuccesses(),
        ]);
        return c.text(renderMetrics({ queue, crons, now: new Date() }), 200, {
          "Content-Type": "text/plain; version=0.0.4",
        });
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
      .route("/api/visits", visitRescheduleRequestsRouter)
      .route("/api/verify", verifyRouter)
      .route("/api/magic-link", magicLinkRouter)
      .route("/api/dashboard", dashboardRouter)
      .route("/api/reports", reportsRouter)
      .route("/api/onboarding", onboardingRouter)
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
      .route("/api/accredited-scope", accreditedScopeRouter)
      .route("/api/authorized-signatories", authorizedSignatoriesRouter)
      .route("/api/competences", competencesRouter)
      .route("/api/training-records", trainingRecordsRouter)
      .route("/api/sessions", sessionsRouter)
      .route("/api/sso", ssoRouter)
      .route("/api/api-keys", apiKeysRouter)
      .route("/api/portal-domains", portalDomainsRouter)
      .route("/api/email-domains", emailDomainsRouter)
      .route("/api/certificate-numbering", certificateNumberingRouter)
      .route("/api/units", unitsRouter)
      .route("/api/integrations", integrationsRouter)
      .route("/api/sync", syncRouter)
      .route("/api/organization", organizationLifecycleRouter)
      .route("/api/organization", organizationProfileRouter)
      .route("/api/organization-media", organizationMediaRouter)
      .route("/api/profile-media", profileMediaRouter)
      .route("/api/public/signup", publicSignupRouter)
      .route("/api/public/oot-ack", ootAckRouter)
      .route("/api/public/service-order-access", publicServiceOrderAccessRouter)
      .route("/api/public/v1", publicApiRouter)
      .route("/api/public/v2", publicApiV2DocsRouter)
      .route("/api/public/v2", publicApiV2Router)
  );
}
