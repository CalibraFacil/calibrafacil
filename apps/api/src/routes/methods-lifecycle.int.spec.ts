/**
 * methods-lifecycle.int.spec.ts - P2-18d [HIGH RISK].
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
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" } as const;

type Status = "DRAFT" | "PENDING_APPROVAL" | "TECHNICAL_REVIEWED" | "PUBLISHED";

async function seedMethod(params: {
  orgId: string;
  createdBy: string;
  status: Status;
  name: string;
  version?: number;
}): Promise<number> {
  const [row] = await db
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
    .returning({ id: calibrationMethod.id });
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

    const [audit] = await db
      .select({
        action: methodAuditLog.action,
        changes: methodAuditLog.changes,
      })
      .from(methodAuditLog)
      .where(eq(methodAuditLog.methodId, created.id));
    expect(audit?.action).toBe("create");
    expect(audit?.changes).toMatchObject({ fromTemplate: template.key });
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
