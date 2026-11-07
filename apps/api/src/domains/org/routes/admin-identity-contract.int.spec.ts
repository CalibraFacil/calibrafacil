/**
 * admin-identity-contract.int.spec.ts: the cloud half of the portal-domains,
 * SSO and signing-certificates endpoint definitions
 * (`packages/contracts/src/endpoints/{portal-domains,sso,signing-certificates}.ts`).
 * Each client-facing endpoint reachable without an external identity provider
 * or an ICP-Brasil credential is called for real (real handlers, real
 * middleware, real Postgres) and its body is parsed with the response schema of
 * its definition. `mount` also checks each body with that schema in the
 * integration tier (`checkEndpointResponses`), so a drift fails the request
 * itself; the explicit parse here names the drifting path and the status.
 *
 * Not covered here: `sso.start` and the provider writes (they go through
 * Better Auth), the certificate upload, set-default and revoke (they need a
 * PKCS#12 credential); `signing.int.spec.ts`, `sso.int.spec.ts` call them and
 * `mount` checks those bodies against the definitions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  portalDomainEndpoints,
  signingCertificateEndpoints,
  ssoEndpoints,
} from "@calibra-facil/contracts";
import { portalDomainsRouter } from "./portal-domains";
import { signingRouter } from "./signing";
import { ssoRouter } from "./sso";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

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

function send(method: string, body?: unknown, unitId?: number) {
  return {
    method,
    headers: {
      ...JSON_HEADERS,
      ...(unitId === undefined ? {} : { "x-active-unit-id": String(unitId) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function seedOwner(orgId: string) {
  const org = await seedOrg({ orgId, role: "owner" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  return org;
}

describe("portal-domains endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
    // The status summary reads the TXT records through DNS over HTTPS: none is published.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Answer: [] }))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("get (none), create (201), get, verify, activate refusal and delete", async () => {
    await seedOwner("org-pd-contract");

    const none = await parsedBody(
      await portalDomainsRouter.request("/"),
      portalDomainEndpoints.get.response,
    );
    expect(none.statusSummary.status).toBe("not_configured");

    const created = await parsedBody(
      await portalDomainsRouter.request(
        "/",
        send("POST", { hostname: "portal.lab-contract.example.com" }),
      ),
      portalDomainEndpoints.create.response,
      201,
    );
    expect(created.domain?.hostname).toBe("portal.lab-contract.example.com");

    const waiting = await parsedBody(
      await portalDomainsRouter.request("/"),
      portalDomainEndpoints.get.response,
    );
    expect(waiting.statusSummary.status).toBe("waiting_dns");

    await parsedBody(
      await portalDomainsRouter.request("/", send("DELETE")),
      portalDomainEndpoints.delete.response,
    );
  });
});

describe("sso endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("getProviders answers no provider and the owner's access", async () => {
    await seedOwner("org-sso-contract");

    const settings = await parsedBody(
      await ssoRouter.request("/providers"),
      ssoEndpoints.getProviders.response,
    );
    expect(settings.provider).toBeNull();
    expect(settings.access.canCreate).toBe(true);
  });
});

describe("signing-certificates endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("list, policy and unsigned issuance", async () => {
    const org = await seedOwner("org-signing-contract");

    const empty = await parsedBody(
      await signingRouter.request(
        "/certificates",
        send("GET", undefined, org.unitId),
      ),
      signingCertificateEndpoints.list.response,
    );
    expect(empty.certificates).toEqual([]);
    expect(empty.requireSignature).toBe(false);

    const enabled = await parsedBody(
      await signingRouter.request(
        "/unsigned-issuance",
        send(
          "PATCH",
          {
            enabled: true,
            reason: "Laboratório deixou de assinar os certificados",
          },
          org.unitId,
        ),
      ),
      signingCertificateEndpoints.setUnsignedIssuance.response,
    );
    expect(enabled.unsignedIssuance.enabled).toBe(true);

    const policy = await parsedBody(
      await signingRouter.request(
        "/policy",
        send("PATCH", { requireSignature: false }, org.unitId),
      ),
      signingCertificateEndpoints.setPolicy.response,
    );
    expect(policy.requireSignature).toBe(false);
  });
});
