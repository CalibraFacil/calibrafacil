/**
 * methods-contract.int.spec.ts: the cloud half of the methods endpoint
 * definitions (`packages/contracts/src/endpoints/methods.ts`). The reads and
 * writes `methods.int.spec.ts` and `methods-lifecycle.int.spec.ts` do not parse
 * against a definition are called for real (real handlers, real middleware,
 * real Postgres) and their bodies are parsed with the response schemas of the
 * definitions: the template catalog (served verbatim from the registry), the
 * audit log, create, the builder's compile (200 and 422) and the approval
 * request. `mount` also checks every body in the integration tier
 * (`checkEndpointResponses`), so the lifecycle specs cover the other steps.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { methodEndpoints } from "@calibra-facil/contracts";
import { methodsRouter } from "./methods";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

const DATA_FIELDS = [
  {
    key: "x",
    type: "number",
    label: "Leitura X",
    required: true,
    unit: "mm",
    defaultValue: 0,
  },
];

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
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

describe("methods endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("listMethodTemplates answers the whole curated catalog", async () => {
    const org = await seedOrg({ orgId: "org-methods-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const catalog = await parsedBody(
      await methodsRouter.request("/templates"),
      methodEndpoints.listMethodTemplates.response,
    );

    expect(catalog.length).toBeGreaterThan(0);
    for (const entry of catalog) {
      expect(entry.governance.reviewStatus).toBe("draft_pending_revalidation");
    }
  });

  it("create answers 201 with the stored draft, then audit lists it and the approval request answers the row", async () => {
    const org = await seedOrg({ orgId: "org-methods-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const headers = { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) };

    const created = await parsedBody(
      await methodsRouter.request("/", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Método de contrato",
          dataFields: DATA_FIELDS,
        }),
      }),
      methodEndpoints.create.response,
      201,
    );
    expect(created.status).toBe("DRAFT");

    const requested = await parsedBody(
      await methodsRouter.request(`/${created.id}/request-approval`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sampleData: { x: 1 } }),
      }),
      methodEndpoints.requestApproval.response,
    );
    expect(requested.status).toBe("PENDING_APPROVAL");

    const audit = await parsedBody(
      await methodsRouter.request(`/${created.id}/audit`, { headers }),
      methodEndpoints.audit.response,
    );
    expect(audit.data.length).toBeGreaterThan(0);
  });

  it("compileDraft answers 422 with the diagnostics (same body shape) for a draft that does not compile", async () => {
    const org = await seedOrg({ orgId: "org-methods-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const failed = await parsedBody(
      await methodsRouter.request("/compile", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          draft: {
            id: "contract_unknown_variable",
            version: 1,
            status: "draft",
            name: "Variável desconhecida",
            inputs: [
              {
                kind: "scalar",
                key: "a",
                label: "A",
                unit: "mm",
                required: true,
              },
            ],
            formulas: [
              {
                key: "erro",
                label: "Erro",
                expression: "a + variavel_inexistente",
                outputUnit: "mm",
                outputKind: "error",
                required: true,
              },
            ],
          },
        }),
      }),
      methodEndpoints.compileDraft.response,
      422,
    );
    expect(failed.ok).toBe(false);
    expect(failed.diagnostics.length).toBeGreaterThan(0);
  });
});
