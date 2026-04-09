import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/permission";
import { financeAccessRouter } from "./access";
import { financeOverviewRouter } from "./overview";
import { financeContractsRouter } from "./contracts";
import { financeDocumentsRouter } from "./documents";
import { financeInstallmentsRouter, financeReceiptsRouter } from "./receipts";
import { financeErpRouter } from "./erp";

export const financeRouter = new Hono<{ Variables: AuthVariables }>()
  .route("/access", financeAccessRouter)
  .route("/overview", financeOverviewRouter)
  .route("/contracts", financeContractsRouter)
  .route("/documents", financeDocumentsRouter)
  .route("/installments", financeInstallmentsRouter)
  .route("/receipts", financeReceiptsRouter)
  .route("/erp", financeErpRouter);
