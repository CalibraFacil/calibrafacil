/**
 * methods-lifecycle.int.spec.ts [HIGH RISK].
 *
 * The method-definition handlers methods.int.spec.ts does not reach (ISO/IEC 17025
 * §7.2, §8.4): GET /:id/label, POST /from-template, POST /:id/return-to-draft,
 * POST /:id/archive, GET /:id/versions, GET /:id/audit. Success paths and the
 * cross-laboratory negatives, run as the owner here and as `calibra_app` by
 * `pnpm --filter @calibra-facil/api rls:shadow-report`.
 *
 *   REQ-18D-METH-1  label / versions / audit answer for the lab's own method.
 *   REQ-18D-METH-2  from-template creates a DRAFT with the adoption evidence in the
 *                   "create" audit row (the informed-adoption gate is unchanged).
 *   REQ-18D-METH-3  return-to-draft (PENDING_APPROVAL -> DRAFT, reason recorded) and
 *                   archive (PUBLISHED -> ARCHIVED) move the status and audit.
 *   REQ-18D-METH-4  Lab B's method id in lab A's session is a 404 on every handler
 *                   above and lab B's method keeps its status.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { calibrationMethod, methodAuditLog } from "@calibra-facil/db/schema";
import { listTemplates } from "@calibra-facil/method-templates";
import { methodsRouter } from "./methods";
import { loginAs, logout } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const JSON_HEADERS = { "content-type": "application/json" } as const;

type Status = "DRAFT" | "PENDING_APPROVAL" | "TECHNICAL_REVIEWED" | "PUBLISHED";

async function seedMethod(params: {
  orgId: string;
  createdBy: string;
  status: Status;
  name: string;
  version?: number;
}): Promise<number> {
  const [row] = await withStatusRepair((tx) =>
    tx
      .insert(calibrationMethod)
      .values({
        organizationId: params.orgId,
        name: params.name,
        description: "",
        version: params.version ?? 1,
        status: params.status,
        dataFields: [
          {
            key: "x",
            type: "number",
            label: "Leitura X",
            required: true,
            unit: "mm",
            defaultValue: 0,
          },
        ],
        formulas: [],
        validations: [],
        accreditedScope: false,
        createdBy: params.createdBy,
      })
      .returning({ id: calibrationMethod.id }),
  );
  if (!row) throw new Error("seedMethod: insert failed");
  return row.id;
}

async function methodStatus(id: number) {
  const [row] = await db
    .select({ status: calibrationMethod.status })
    .from(calibrationMethod)
    .where(eq(calibrationMethod.id, id));
  return row?.status;
}

async function twoLabs() {
  const a = await seedOrg({ orgId: "org-a", userId: "user-a", role: "admin" });
  const b = await seedOrg({ orgId: "org-b", userId: "user-b", role: "admin" });
  loginAs({ userId: a.userId, organizationId: a.orgId });
  return { a, b };
}

describe("methods router: lifecycle handlers (P2-18d)", () => {
  beforeEach(async () => {
    await truncateAll();
    logout();
  });

  it("REQ-18D-METH-1: label, versions and audit answer for the lab's own method", async () => {
    const { a } = await twoLabs();
    const v1 = await seedMethod({
      orgId: a.orgId,
      createdBy: a.userId,
      status: "PUBLISHED",
      name: "Pesagem",
      version: 1,
    });
    const v2 = await seedMethod({
      orgId: a.orgId,
      createdBy: a.userId,
      status: "DRAFT",
      name: "Pesagem",
      version: 2,
    });
    await db.insert(methodAuditLog).values({
      organizationId: a.orgId,
      methodId: v1,
      action: "create",
      changes: {},
      performedBy: a.userId,
    });

    const label = await methodsRouter.request(`/${v1}/label`);
    expect(label.status).toBe(200);
    expect(await label.json()).toEqual({ id: v1, label: "Pesagem" });

    const versions = await methodsRouter.request(`/${v1}/versions`);
    expect(versions.status).toBe(200);
    const versionsBody = await versions.json();
    expect(versionsBody.data.map((v: { id: number }) => v.id)).toEqual([
      v2,
      v1,
    ]);

    const audit = await methodsRouter.request(`/${v1}/audit`);
    expect(audit.status).toBe(200);
    const auditBody = await audit.json();
    expect(auditBody.data.map((log: { action: string }) => log.action)).toEqual(
      ["create"],
    );
    expect(auditBody.data[0].performedByName).toBe(`User ${a.userId}`);
  });

  it("REQ-18D-METH-2: from-template creates a DRAFT and freezes the adoption evidence", async () => {
    await twoLabs();
    const template = listTemplates()[0];
    if (!template) throw new Error("no method template available");
    const acceptedVerificarRefs = (template.governance?.verificarItems ?? [])
      .filter((item) => item.severity === "action")
      .map((item) => item.ref)
      .filter((ref): ref is string => typeof ref === "string");

    const res = await methodsRouter.request("/from-template", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        templateKey: template.key,
        name: "Método a partir do modelo",
        acknowledgements: {
          readVerificarAndOmitted: true,
          acceptsVerificationDuty: true,
          understandsDraftGate: true,
          acknowledgedAt: "2026-02-01T00:00:00.000Z",
          templateVersion: template.templateVersion,
          acceptedVerificarRefs,
        },
      }),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.status).toBe("DRAFT");
    expect(created.templateKey).toBe(template.key);

    // Never accredited by adoption: the row says DRAFT, outside the accredited scope, at the
    // template's version.
    const [row] = await db
      .select({
        status: calibrationMethod.status,
        accreditedScope: calibrationMethod.accreditedScope,
        templateKey: calibrationMethod.templateKey,
        templateVersion: calibrationMethod.templateVersion,
      })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, created.id));
    expect(row).toEqual({
      status: "DRAFT",
      accreditedScope: false,
      templateKey: template.key,
      templateVersion: template.templateVersion,
    });

    // The audit entry freezes the acknowledgements and an immutable snapshot of the cited
    // sources, [VERIFICAR] items and omitted components at adoption time.
    const [audit] = await db
      .select({
        action: methodAuditLog.action,
        changes: methodAuditLog.changes,
      })
      .from(methodAuditLog)
      .where(eq(methodAuditLog.methodId, created.id));
    expect(audit?.action).toBe("create");
    expect(audit?.changes).toMatchObject({
      fromTemplate: template.key,
      templateVersion: template.templateVersion,
      acknowledgements: { acceptedVerificarRefs },
      governanceSnapshot: {
        sources: template.governance?.sources,
        verificarItems: template.governance?.verificarItems,
        omittedComponents: template.governance?.omittedComponents,
      },
    });
  });

  describe("adoption gates (REQ-18D-METH-2)", () => {
    const electrical = listTemplates().find(
      (t) => t.key === "electrical-indication",
    );
    const actionRefs = (electrical?.governance?.verificarItems ?? [])
      .filter((item) => item.severity === "action")
      .map((item) => item.ref)
      .filter((ref): ref is string => typeof ref === "string");

    function adopt(
      overrides: {
        accepted?: string[];
        consent?: boolean;
        templateKey?: string;
      } = {},
    ) {
      return methodsRouter.request("/from-template", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          templateKey: overrides.templateKey ?? "electrical-indication",
          acknowledgements: {
            readVerificarAndOmitted: true,
            acceptsVerificationDuty: true,
            understandsDraftGate: overrides.consent ?? true,
            acknowledgedAt: "2026-06-18T00:00:00.000Z",
            templateVersion: electrical?.templateVersion ?? 1,
            acceptedVerificarRefs: overrides.accepted ?? actionRefs,
          },
        }),
      });
    }

    async function methodCount() {
      return (
        await db.select({ id: calibrationMethod.id }).from(calibrationMethod)
      ).length;
    }

    it("the chosen template has action-severity [VERIFICAR] references to acknowledge (guard of the cases below)", () => {
      expect(electrical).toBeTruthy();
      expect(actionRefs.length).toBeGreaterThan(0);
    });

    it("refuses (400, naming the missing ones) an adoption that leaves an action-severity [VERIFICAR] unacknowledged, and persists nothing", async () => {
      await twoLabs();

      const res = await adopt({ accepted: [] });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.missing.length).toBeGreaterThan(0);
      expect(await methodCount()).toBe(0);
    });

    it("refuses (400) at the schema gate when a consent is not true, and persists nothing", async () => {
      await twoLabs();

      expect((await adopt({ consent: false })).status).toBe(400);
      expect(await methodCount()).toBe(0);
    });

    it("answers 404 for an unknown template and persists nothing", async () => {
      await twoLabs();

      expect((await adopt({ templateKey: "does-not-exist" })).status).toBe(404);
      expect(await methodCount()).toBe(0);
    });
  });

  it("GET /templates serves only governance-complete templates, each with the catalog DTO", async () => {
    await twoLabs();

    const res = await methodsRouter.request("/templates");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect(entry.governance.reviewStatus).toBe("draft_pending_revalidation");
      expect(entry.governance.sources.length).toBeGreaterThan(0);
      expect(entry.governance.verificarItems.length).toBeGreaterThan(0);
      expect(entry.spec).toBeTruthy();
      expect(typeof entry.counts.verificar).toBe("number");
    }
    expect(
      body.map((entry: { templateKey: string }) => entry.templateKey),
    ).toContain("electrical-indication");
  });

  it("REQ-18D-METH-3: return-to-draft and archive move the status and audit", async () => {
    const { a } = await twoLabs();
    const pending = await seedMethod({
      orgId: a.orgId,
      createdBy: a.userId,
      status: "PENDING_APPROVAL",
      name: "Em aprovação",
    });
    const published = await seedMethod({
      orgId: a.orgId,
      createdBy: a.userId,
      status: "PUBLISHED",
      name: "Publicado",
    });

    const back = await methodsRouter.request(`/${pending}/return-to-draft`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "Faltou a validação do ponto zero" }),
    });
    expect(back.status).toBe(200);
    expect(await methodStatus(pending)).toBe("DRAFT");
    const [backAudit] = await db
      .select({ action: methodAuditLog.action, reason: methodAuditLog.reason })
      .from(methodAuditLog)
      .where(eq(methodAuditLog.methodId, pending));
    expect(backAudit).toEqual({
      action: "return_to_draft",
      reason: "Faltou a validação do ponto zero",
    });

    const archived = await methodsRouter.request(`/${published}/archive`, {
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect(await methodStatus(published)).toBe("ARCHIVED");
    const [archiveAudit] = await db
      .select({ action: methodAuditLog.action })
      .from(methodAuditLog)
      .where(eq(methodAuditLog.methodId, published));
    expect(archiveAudit?.action).toBe("archive");
  });

  it("REQ-18D-METH-4: lab B's method id is a 404 on every handler in lab A's session; lab B's method keeps its status", async () => {
    const { b } = await twoLabs();
    const foreignPending = await seedMethod({
      orgId: b.orgId,
      createdBy: b.userId,
      status: "PENDING_APPROVAL",
      name: "Método B pendente",
    });
    const foreignPublished = await seedMethod({
      orgId: b.orgId,
      createdBy: b.userId,
      status: "PUBLISHED",
      name: "Método B publicado",
    });

    for (const path of [
      `/${foreignPending}/label`,
      `/${foreignPending}/versions`,
      `/${foreignPending}/audit`,
    ]) {
      const res = await methodsRouter.request(path);
      expect(res.status, path).toBe(404);
    }
    const back = await methodsRouter.request(
      `/${foreignPending}/return-to-draft`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Tentativa cruzada" }),
      },
    );
    expect(back.status).toBe(404);
    const archived = await methodsRouter.request(
      `/${foreignPublished}/archive`,
      {
        method: "POST",
      },
    );
    expect(archived.status).toBe(404);

    expect(await methodStatus(foreignPending)).toBe("PENDING_APPROVAL");
    expect(await methodStatus(foreignPublished)).toBe("PUBLISHED");
  });
});
