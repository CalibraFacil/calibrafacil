/**
 * finance-contract.int.spec.ts: the cloud half of the finance endpoint
 * definitions (`packages/contracts/src/endpoints/finance.ts`). The contract
 * lifecycle, the dashboards, the queues and the two settings lists are called
 * for real (real handlers, real middleware, real Postgres) and every body is
 * parsed with the response schema of its definition. `mount` also checks each
 * body with that schema in the integration tier (`checkEndpointResponses`); the
 * explicit parse names the status and the drifting path.
 *
 * The documents, receipts, ERP, readiness and certificate-release flows have
 * their own specs (`finance-lab-scope`, `certificate-release`, `automatic-send`,
 * `overview`), which run through the same check.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { financeEndpoints } from "@calibra-facil/contracts";
import { financeRouter } from "./index";
import { loginAs } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import {
  seedCustomer,
  seedOrg,
  seedService,
} from "../../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

function send(method: "POST" | "PUT", path: string, body?: unknown) {
  return financeRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("finance endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("walks a contract from draft to cancelled", async () => {
    const lab = await seedOrg({ orgId: "org-fin-contract", role: "admin" });
    const customerId = await seedCustomer({
      labOrganizationId: lab.orgId,
      name: "Cliente Contrato",
    });
    const serviceId = await seedService({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      name: "Calibração de balança",
    });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const created = await parsedBody(
      await send("POST", "/contracts", {
        customerId,
        title: "Contrato anual",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        serviceTerms: [{ serviceId, priceCents: 15000 }],
      }),
      financeEndpoints.createContract.response,
      201,
    );
    expect(created.data.status).toBe("DRAFT");
    const id = created.data.id;

    const list = await parsedBody(
      await financeRouter.request("/contracts"),
      financeEndpoints.listContracts.response,
    );
    expect(list.data.map((row) => row.title)).toEqual(["Contrato anual"]);
    const detail = await parsedBody(
      await financeRouter.request(`/contracts/${id}`),
      financeEndpoints.getContract.response,
    );
    expect(detail.data.serviceTerms).toHaveLength(1);

    const activated = await parsedBody(
      await send("POST", `/contracts/${id}/activate`),
      financeEndpoints.activateContract.response,
    );
    expect(activated.data.status).toBe("ACTIVE");
    const cancelled = await parsedBody(
      await send("POST", `/contracts/${id}/cancel`),
      financeEndpoints.cancelContract.response,
    );
    expect(cancelled.data.status).toBe("CANCELED");
  });

  it("answers the dashboards and queues of an empty laboratory", async () => {
    const lab = await seedOrg({ orgId: "org-fin-dash", role: "admin" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    await parsedBody(
      await financeRouter.request("/overview"),
      financeEndpoints.getOverview.response,
    );
    await parsedBody(
      await financeRouter.request("/documents"),
      financeEndpoints.listDocuments.response,
    );
    await parsedBody(
      await financeRouter.request("/documents/eligible-jobs"),
      financeEndpoints.listEligibleJobs.response,
    );
    await parsedBody(
      await financeRouter.request("/receipts"),
      financeEndpoints.listReceipts.response,
    );
    await parsedBody(
      await financeRouter.request("/erp/exports"),
      financeEndpoints.listErpExports.response,
    );
    const readiness = await parsedBody(
      await financeRouter.request("/billing-readiness"),
      financeEndpoints.listBillingReadiness.response,
    );
    expect(readiness.data).toEqual([]);
    await parsedBody(
      await financeRouter.request("/operations-to-cash?stage=INVOICED"),
      financeEndpoints.getOperationsToCash.response,
    );
    await parsedBody(
      await financeRouter.request("/revenue-leakage"),
      financeEndpoints.getRevenueLeakage.response,
    );
    await parsedBody(
      await financeRouter.request("/cash-forecast"),
      financeEndpoints.getCashForecast.response,
    );
    await parsedBody(
      await financeRouter.request("/margin-dashboards"),
      financeEndpoints.getMarginDashboards.response,
    );
  });

  it("creates, lists and updates the certificate-release policies and automatic-send rules", async () => {
    const lab = await seedOrg({ orgId: "org-fin-rules", role: "admin" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const policy = await parsedBody(
      await send("POST", "/certificate-release-policies", {
        mode: "release_after_invoice",
      }),
      financeEndpoints.createCertificateReleasePolicy.response,
    );
    expect(policy.data.scope).toBe("organization");
    const policies = await parsedBody(
      await financeRouter.request("/certificate-release-policies"),
      financeEndpoints.listCertificateReleasePolicies.response,
    );
    expect(policies.data.map((row) => row.id)).toEqual([policy.data.id]);
    await parsedBody(
      await send("PUT", `/certificate-release-policies/${policy.data.id}`, {
        mode: "manual_only",
      }),
      financeEndpoints.updateCertificateReleasePolicy.response,
    );

    const rule = await parsedBody(
      await send("POST", "/automatic-send-rules", {
        milestone: "certificate_approved",
      }),
      financeEndpoints.createAutomaticSendRule.response,
    );
    const rules = await parsedBody(
      await financeRouter.request("/automatic-send-rules"),
      financeEndpoints.listAutomaticSendRules.response,
    );
    expect(rules.data.map((row) => row.id)).toEqual([rule.data.id]);
    await parsedBody(
      await send("PUT", `/automatic-send-rules/${rule.data.id}`, {
        milestone: "manual_only",
      }),
      financeEndpoints.updateAutomaticSendRule.response,
    );
  });
});
