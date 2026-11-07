import type { Hono } from "hono";
import type { BlankEnv } from "hono/types";

import type { EndpointGroupPaths, PathParams } from "./endpoints";

type RpcScalar = string | number | boolean | null | undefined;
type RpcQuery = Record<string, RpcScalar | RpcScalar[]>;

type RpcInput<Path extends string> = keyof PathParams<Path> extends never
  ? {
      json?: unknown;
      query?: RpcQuery;
    }
  : {
      param: PathParams<Path>;
      json?: unknown;
      query?: RpcQuery;
    };

type JsonEndpoint<Path extends string> = {
  input: RpcInput<Path>;
  output: unknown;
  outputFormat: "json";
  status: 200;
};

type RpcRoute<Path extends string> = {
  $all: JsonEndpoint<Path>;
};

// Keep the browser-facing Hono contract server-free. Importing apps/api here
// pulls route handlers and runtime dependencies back across the package boundary.
type HandListedRoutePath =
  | "/api/onboarding/checklist"
  | "/api/organization/profile"
  | "/api/organization/soft-delete"
  | "/api/authorized-signatories"
  | "/api/authorized-signatories/:id"
  | "/api/authorized-signatories/:id/revoke"
  | "/api/environmental-limits/effective/:assetTypeId"
  | "/api/finance/access"
  | "/api/finance/automatic-send-rules"
  | "/api/finance/automatic-send-rules/:id"
  | "/api/finance/billing-readiness"
  | "/api/finance/billing-readiness/send"
  | "/api/finance/certificate-releases/:calibrationJobId"
  | "/api/finance/certificate-releases/:calibrationJobId/release-by-exception"
  | "/api/finance/certificate-release-policies"
  | "/api/finance/certificate-release-policies/:id"
  | "/api/finance/contracts"
  | "/api/finance/contracts/:id"
  | "/api/finance/contracts/:id/activate"
  | "/api/finance/contracts/:id/cancel"
  | "/api/finance/customers/:customerId/timeline"
  | "/api/finance/documents"
  | "/api/finance/documents/:id"
  | "/api/finance/documents/:id/issue"
  | "/api/finance/documents/:id/void"
  | "/api/finance/documents/eligible-jobs"
  | "/api/finance/erp/documents/:id/export"
  | "/api/finance/erp/exports"
  | "/api/finance/installments/:id/receive"
  | "/api/finance/cash-forecast"
  | "/api/finance/margin-dashboards"
  | "/api/finance/operations-to-cash"
  | "/api/finance/overview"
  | "/api/finance/revenue-leakage"
  | "/api/finance/receipts"
  | "/api/finance/service-orders/:serviceOrderId/status"
  | "/api/integrations"
  | "/api/integrations/drift"
  | "/api/integrations/drift/:linkId/acknowledge"
  | "/api/integrations/:id"
  | "/api/integrations/:id/conta-azul/catalog/accounts"
  | "/api/integrations/:id/conta-azul/catalog/:catalog"
  | "/api/integrations/:id/conta-azul/catalog/categories"
  | "/api/integrations/:id/conta-azul/catalog/cost-centers"
  | "/api/integrations/:id/conta-azul/config"
  | "/api/integrations/:id/conta-azul/disconnect"
  | "/api/integrations/:id/conta-azul/link-mdfe"
  | "/api/integrations/:id/conta-azul/poll"
  | "/api/integrations/:id/conta-azul/poll-drift"
  | "/api/integrations/:id/conta-azul/poll-fiscal"
  | "/api/integrations/:id/conta-azul/poll-payables"
  | "/api/integrations/:id/conta-azul/poll-protocols"
  | "/api/integrations/:id/conta-azul/refresh"
  | "/api/integrations/:id/conta-azul/schedule"
  | "/api/integrations/:id/events"
  | "/api/integrations/:id/overview"
  | "/api/integrations/:id/runs"
  | "/api/integrations/:id/runs/:runId/items"
  | "/api/integrations/:id/runs/:runId/retry"
  | "/api/integrations/:id/schedule"
  | "/api/integrations/:id/sync"
  | "/api/integrations/:id/sync/preview"
  | "/api/integrations/:id/toggle"
  | "/api/integrations/:id/validate"
  | "/api/integrations/conta-azul/app"
  | "/api/integrations/conta-azul/oauth/callback"
  | "/api/integrations/conta-azul/oauth/start"
  | "/api/lab-setup/:token"
  | "/api/lab-setup/:token/complete"
  | "/api/lab-setup/:token/request-magic-link"
  | "/api/lab-setup/:token/request-otp"
  | "/api/jobs/:id/label-commands"
  | "/api/portal/service-orders/:id/financial-summary"
  | "/api/public/service-order-access/:token"
  | "/api/public/service-order-access/:token/approve-quote"
  | "/api/public/service-order-access/:token/reject-quote"
  | "/api/public/service-order-access/redeem-code"
  | "/api/service-orders/pending-calibration"
  | "/api/sessions/revoke";

// The converted domains list their paths in their endpoint definitions
// (`endpoints/`); the hand list above shrinks as domains are converted and
// disappears with the last one.
type ApiRoutePath = HandListedRoutePath | EndpointGroupPaths;

type ApiRouteSchema = {
  [Path in ApiRoutePath]: RpcRoute<Path>;
};

export type AppType = Hono<BlankEnv, ApiRouteSchema, "/">;
