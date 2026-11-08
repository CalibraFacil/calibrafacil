/**
 * quality-contract.int.spec.ts: the cloud half of the non-conformances and CAPA
 * endpoint definitions
 * (`packages/contracts/src/endpoints/{non-conformances,capa}.ts`). The NC and
 * CAPA workflows are driven for real (real handlers, real middleware, real
 * Postgres) and every body is parsed with the response schema of its
 * definition. `mount` also checks each body with that schema in the integration
 * tier (`checkEndpointResponses`); the explicit parse names the status and the
 * drifting path.
 *
 * Not covered: `POST /:id/oot-ack` (it needs a sent 7.10 notification; the
 * acknowledgement flow has its own spec) and the e-mail side effects, which are
 * mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  capaEndpoints,
  nonConformanceEndpoints,
} from "@calibra-facil/contracts";
import { capaRouter } from "./capa";
import { nonConformancesRouter } from "./non-conformances";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { seedExtraMember } from "../../../../test/integration/tenant-refs";

vi.mock("../../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

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

function send(
  router: typeof capaRouter,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) {
  return router.request(path, {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("non-conformances endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("create, list, summary, get, disposition, resolve and audit log", async () => {
    const lab = await seedOrg({ orgId: "org-nc-contract", role: "admin" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const created = await parsedBody(
      await send(nonConformancesRouter, "POST", "/", {
        type: "work",
        description: "Leitura fora da faixa esperada",
        detectedAt: "2026-05-20T12:00:00.000Z",
      }),
      nonConformanceEndpoints.create.response,
      201,
    );
    const id = created.id;

    const list = await parsedBody(
      await nonConformancesRouter.request("/?page=1&limit=20"),
      nonConformanceEndpoints.list.response,
    );
    expect(list.data.map((row) => row.id)).toEqual([id]);
    const summary = await parsedBody(
      await nonConformancesRouter.request("/summary"),
      nonConformanceEndpoints.summary.response,
    );
    expect(summary.byType).toEqual([{ type: "work", count: 1 }]);

    await parsedBody(
      await send(nonConformancesRouter, "PUT", `/${id}/disposition`, {
        disposition: "rework",
      }),
      nonConformanceEndpoints.setDisposition.response,
    );
    await parsedBody(
      await send(nonConformancesRouter, "POST", `/${id}/resolve`, {
        correctionTaken: "Refeita a calibração com o padrão correto",
      }),
      nonConformanceEndpoints.resolve.response,
    );

    const detail = await parsedBody(
      await nonConformancesRouter.request(`/${id}`),
      nonConformanceEndpoints.get.response,
    );
    expect(detail.status).toBe("resolved");
    expect(detail.resolverName).toBe(`User ${lab.userId}`);
    const audit = await parsedBody(
      await nonConformancesRouter.request(`/${id}/audit-log`),
      nonConformanceEndpoints.auditLog.response,
    );
    expect(audit.data.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["create", "disposition", "resolve"]),
    );
  });

  it("escalates an NC to a CAPA and walks the CAPA to closed", async () => {
    const lab = await seedOrg({ orgId: "org-capa-contract", role: "admin" });
    const verifier = await seedExtraMember({
      orgId: lab.orgId,
      userId: "verifier-capa-contract",
      role: "admin",
    });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const nc = await parsedBody(
      await send(nonConformancesRouter, "POST", "/", {
        type: "equipment",
        description: "Padrão de trabalho com deriva acima do limite",
        detectedAt: "2026-05-20T12:00:00.000Z",
      }),
      nonConformanceEndpoints.create.response,
      201,
    );
    const escalated = await parsedBody(
      await send(nonConformancesRouter, "POST", `/${nc.id}/escalate-to-capa`, {
        rootCauseAnalysis: "Deriva do padrão de trabalho",
        actionPlan: "Recalibrar o padrão e revisar o intervalo",
        dueDate: "2027-01-31T00:00:00.000Z",
        responsibleId: lab.userId,
      }),
      nonConformanceEndpoints.escalateToCapa.response,
      201,
    );
    const capaId = escalated.data.capa.id;
    expect(escalated.data.nc.capaId).toBe(capaId);

    const linked = await parsedBody(
      await nonConformancesRouter.request(`/${nc.id}`),
      nonConformanceEndpoints.get.response,
    );
    expect(linked.capa?.id).toBe(capaId);

    const created = await parsedBody(
      await send(capaRouter, "POST", "/", {
        title: "Revisão do procedimento",
        description: "Revisar o procedimento de calibração de manômetros",
        source: "internal_audit",
        detectionDate: "2026-05-21T00:00:00.000Z",
        type: "corrective",
        severity: "minor",
        category: "procedure",
        actionPlan: "Reescrever o procedimento e treinar a equipe",
        responsibleId: lab.userId,
        dueDate: "2027-02-28T00:00:00.000Z",
      }),
      capaEndpoints.create.response,
      201,
    );
    const id = created.id;

    const list = await parsedBody(
      await capaRouter.request("/?page=1&limit=20"),
      capaEndpoints.list.response,
    );
    expect(list.data.map((row) => row.id).sort()).toEqual([capaId, id].sort());
    await parsedBody(
      await capaRouter.request("/summary"),
      capaEndpoints.summary.response,
    );
    await parsedBody(
      await send(capaRouter, "PUT", `/${id}`, { severity: "major" }),
      capaEndpoints.update.response,
    );
    await parsedBody(
      await send(capaRouter, "POST", `/${id}/implement`, {
        implementationEvidence: "Procedimento revisado e equipe treinada",
      }),
      capaEndpoints.implement.response,
    );

    // The implementer cannot verify: a second admin does.
    loginAs({ userId: verifier.userId, organizationId: lab.orgId });
    await parsedBody(
      await send(capaRouter, "POST", `/${id}/verify`, {
        effectivenessConfirmed: true,
        verificationNotes: "Auditoria mostrou o procedimento aplicado",
      }),
      capaEndpoints.verify.response,
    );
    const closed = await parsedBody(
      await send(capaRouter, "POST", `/${id}/close`, {}),
      capaEndpoints.close.response,
    );
    expect(closed.data.status).toBe("CLOSED");

    const detail = await parsedBody(
      await capaRouter.request(`/${id}`),
      capaEndpoints.get.response,
    );
    expect(detail.verifiedByName).toBe(`User ${verifier.userId}`);
    const audit = await parsedBody(
      await capaRouter.request(`/${id}/audit-log`),
      capaEndpoints.auditLog.response,
    );
    expect(audit.data.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["create", "implement", "verify", "close"]),
    );
  });

  it("saves and signs the impact assessment of an out-of-tolerance NC", async () => {
    const lab = await seedOrg({ orgId: "org-oot-contract", role: "admin" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const nc = await parsedBody(
      await send(nonConformancesRouter, "POST", "/", {
        type: "out_of_tolerance",
        description: "Instrumento encontrado fora da tolerância",
        detectedAt: "2026-05-20T12:00:00.000Z",
      }),
      nonConformanceEndpoints.create.response,
      201,
    );

    const none = await parsedBody(
      await nonConformancesRouter.request(`/${nc.id}/oot-impact-assessment`),
      nonConformanceEndpoints.getImpactAssessment.response,
    );
    expect(none.data).toBeNull();
    const notification = await parsedBody(
      await nonConformancesRouter.request(`/${nc.id}/oot-notification`),
      nonConformanceEndpoints.getOotNotification.response,
    );
    expect(notification.data).toBeNull();

    await parsedBody(
      await send(
        nonConformancesRouter,
        "PUT",
        `/${nc.id}/oot-impact-assessment`,
        {
          deviationSummary: "Desvio de 0,3% acima da tolerância do cliente",
          items: [{ description: "Certificado 123", disposition: "recheck" }],
          conclusion: "no_significant_impact",
        },
      ),
      nonConformanceEndpoints.saveImpactAssessment.response,
    );
    const signed = await parsedBody(
      await send(
        nonConformancesRouter,
        "POST",
        `/${nc.id}/oot-impact-assessment/sign`,
      ),
      nonConformanceEndpoints.signImpactAssessment.response,
    );
    expect(signed.data.signedBy).toBe(lab.userId);
  });
});
