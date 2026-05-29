import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/permission";
import { financeAccessRouter } from "./access";
import { financeOverviewRouter } from "./overview";
import { financeContractsRouter } from "./contracts";
import { financeDocumentsRouter } from "./documents";
import { financeInstallmentsRouter, financeReceiptsRouter } from "./receipts";
import { financeErpRouter } from "./erp";
import { financeBillingReadinessRouter } from "./billing-readiness";
import { financeTimelineRouter } from "./timeline";
import {
  financeCertificateReleaseRouter,
  settingsCertificateReleasePolicyRouter,
} from "./certificate-release";
import { financeAutomaticSendRouter } from "./automatic-send";
import { financeOperationsToCashRouter } from "./operations-to-cash";
import { financeRevenueLeakageRouter } from "./revenue-leakage";
import { financeCashForecastRouter } from "./cash-forecast";
import { financeMarginDashboardsRouter } from "./margin-dashboards";

export const financeRouter = new Hono<{ Variables: AuthVariables }>()
  .route("/access", financeAccessRouter)
  .route("/overview", financeOverviewRouter)
  .route("/contracts", financeContractsRouter)
  .route("/documents", financeDocumentsRouter)
  .route("/installments", financeInstallmentsRouter)
  .route("/receipts", financeReceiptsRouter)
  .route("/billing-readiness", financeBillingReadinessRouter)
  .route("/certificate-releases", financeCertificateReleaseRouter)
  .route(
    "/certificate-release-policies",
    settingsCertificateReleasePolicyRouter,
  )
  .route("/automatic-send-rules", financeAutomaticSendRouter)
  .route("/operations-to-cash", financeOperationsToCashRouter)
  .route("/revenue-leakage", financeRevenueLeakageRouter)
  .route("/cash-forecast", financeCashForecastRouter)
  .route("/margin-dashboards", financeMarginDashboardsRouter)
  .route("/", financeTimelineRouter)
  .route("/erp", financeErpRouter);
