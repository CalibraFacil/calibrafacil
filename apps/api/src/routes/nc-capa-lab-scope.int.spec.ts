/**
 * nc-capa-lab-scope.int.spec.ts - P2-18e [HIGH RISK].
 *
 * Success paths (and a cross-laboratory negative for each) of the NC / CAPA
 * handlers that non-conformances.int.spec.ts and capa.int.spec.ts do not reach,
 * plus the public out-of-tolerance acknowledgement link (ISO/IEC 17025 §7.10,
 * §8.7, §8.2). Run as the owner here and, through
 * `pnpm --filter @calibra-facil/api rls:shadow-report`, as `calibra_app` under
 * the `tenant_isolation` policies.
 *
 *   REQ-18E-NC-1   GET /summary, /:id/label, /:id read only the caller's lab; lab B's NC is
 *                  a 404.
 *   REQ-18E-NC-2   POST / validates the job against the caller's lab (lab B's job is a 404,
 *                  no NC) and writes the NC with its audit row; GET /:id/audit-log lists it.
 *   REQ-18E-NC-3   §7.10 notification: GET /:id/oot-notification hides the ack token;
 *                  POST /:id/oot-ack registers the manual acknowledgement once (409 after)
 *                  with its audit row; lab B's NC is a 404 and its notification is untouched.
 *   REQ-18E-NC-4   Impact assessment: GET / PUT / sign respect the state rules (non-OOT NC
 *                  409, sign needs a conclusion, admin only, immutable once signed) and lab
 *                  B's NC is a 404.
 *   REQ-18E-NC-5   Escalate to CAPA is atomic: a failing audit insert leaves no CAPA, no CAPA
 *                  audit row, the NC unlinked and sends no notification.
 *   REQ-18E-CAPA-1 GET /summary, /:id/label, /:id (with linked NCs), /:id/audit-log read only
 *                  the caller's lab; PUT writes its audit row; lab B's CAPA is a 404.
 *   REQ-18E-ACK-1  Public ack link: the page names the NC and the laboratory; POST stamps the
 *                  notification of the laboratory the token belongs to (and only that one),
 *                  notifies once, an unknown token is a 404.
 *   REQ-18E-ACK-2  Concurrent public-link clicks stamp once, notify once, keep the first stamp.
 *   REQ-18E-ACK-3  A manual acknowledgement racing the public link (Q34): exactly one stamp, one
 *                  notification, the loser is a 409 / "already confirmed" and writes nothing;
 *                  a later manual acknowledgement is a 409 and leaves the first timestamp.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  correctiveAction,
  correctiveActionAuditLog,
  nonConformance,
  nonConformanceAuditLog,
  ootImpactAssessment,
  ootNotification,
} from "@calibra-facil/db/schema";
import { nonConformancesRouter } from "./non-conformances";
import { capaRouter } from "./capa";
import { ootAckRouter } from "./oot-ack";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { seedJobForOrg } from "../../test/integration/tenant-refs";

const notifications = vi.hoisted(() => ({
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
  notifyNCEscalatedToCapa: vi.fn().mockResolvedValue(undefined),
  notifyOotAcknowledged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@calibra-facil/notifications", () => notifications);

const JSON_HEADERS = { "content-type": "application/json" } as const;
const DETECTED_AT = "2026-01-15T10:00:00.000Z";

let ncSequence = 0;

async function seedNc(params: {
  orgId: string;
  userId: string;
  type?: "work" | "equipment" | "documentation" | "out_of_tolerance";
  status?: "open" | "under_review" | "resolved";
  jobId?: number | null;
  capaId?: number | null;
}): Promise<number> {
  ncSequence += 1;
  const [row] = await db
    .insert(nonConformance)
    .values({
      ncNumber: `NC-2026-${String(ncSequence).padStart(4, "0")}`,
      organizationId: params.orgId,
      type: params.type ?? "work",
      description: "Medicao fora de tolerancia no ensaio de balanca",
      detectedBy: params.userId,
      detectedAt: new Date(DETECTED_AT),
      status: params.status ?? "open",
      jobId: params.jobId ?? null,
      capaId: params.capaId ?? null,
      createdBy: params.userId,
    })
    .returning({ id: nonConformance.id });
  if (!row) throw new Error("seedNc: insert failed");
  return row.id;
}

let capaSequence = 0;

async function seedCapa(params: {
  orgId: string;
  userId: string;
}): Promise<{ id: number; capaNumber: string }> {
  capaSequence += 1;
  const [row] = await db
    .insert(correctiveAction)
    .values({
      capaNumber: `CAPA-2026-${String(capaSequence).padStart(4, "0")}`,
      organizationId: params.orgId,
      source: "nc_detection",
      title: "CAPA de teste",
      description: "Inserida diretamente.",
      type: "corrective",
      severity: "minor",
      category: "procedure",
      status: "OPEN",
      createdBy: params.userId,
    })
    .returning({
      id: correctiveAction.id,
      capaNumber: correctiveAction.capaNumber,
    });
  if (!row) throw new Error("seedCapa: insert failed");
  return row;
}

async function seedOotNotification(params: {
  orgId: string;
  userId: string;
  ncId: number;
  jobId: number;
}): Promise<{ id: number; ackToken: string }> {
  const [row] = await db
    .insert(ootNotification)
    .values({
      organizationId: params.orgId,
      ncId: params.ncId,
      jobId: params.jobId,
      certificateNumber: "CERT-0001",
      recipientName: "Cliente",
      recipientEmail: "cliente@example.test",
      status: "SENT",
      approvedBy: params.userId,
    })
    .returning({ id: ootNotification.id, ackToken: ootNotification.ackToken });
  if (!row) throw new Error("seedOotNotification: insert failed");
  return row;
}

async function ncAuditActions(ncId: number) {
  const rows = await db
    .select({ action: nonConformanceAuditLog.action })
    .from(nonConformanceAuditLog)
    .where(eq(nonConformanceAuditLog.ncId, ncId));
  return rows.map((row) => row.action).toSorted();
}

async function ncRow(id: number) {
  const [row] = await db
    .select()
    .from(nonConformance)
    .where(eq(nonConformance.id, id));
  if (!row) throw new Error(`NC ${id} vanished`);
  return row;
}

function ncRequest(path: string, init?: { method: string; body?: unknown }) {
  return nonConformancesRouter.request(path, {
    method: init?.method ?? "GET",
    headers: JSON_HEADERS,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function capaRequest(path: string, init?: { method: string; body?: unknown }) {
  return capaRouter.request(path, {
    method: init?.method ?? "GET",
    headers: JSON_HEADERS,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function twoLabs() {
  const a = await seedOrg({ orgId: "org-a", role: "admin" });
  const b = await seedOrg({ orgId: "org-b", role: "admin" });
  loginAs({ userId: a.userId, organizationId: a.orgId });
  return { a, b };
}

beforeEach(async () => {
  await truncateAll();
  logout();
  ncSequence = 0;
  capaSequence = 0;
  vi.clearAllMocks();
});

describe("non-conformances router: read and write handlers (P2-18e)", () => {
  it("REQ-18E-NC-1: summary, label and detail read only the caller's lab; lab B's NC is a 404", async () => {
    const { a, b } = await twoLabs();
    const job = await seedJobForOrg({
      orgId: a.orgId,
      unitId: a.unitId,
      createdBy: a.userId,
    });
    const capa = await seedCapa({ orgId: a.orgId, userId: a.userId });
    const own = await seedNc({
      orgId: a.orgId,
      userId: a.userId,
      jobId: job.jobId,
    });
    const linked = await seedNc({
      orgId: a.orgId,
      userId: a.userId,
      status: "resolved",
      capaId: capa.id,
    });
    const foreign = await seedNc({ orgId: b.orgId, userId: b.userId });

    const summary = await ncRequest("/summary");
    expect(summary.status).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody.byStatus).toEqual(
      expect.arrayContaining([
        { status: "open", count: 1 },
        { status: "resolved", count: 1 },
      ]),
    );
    expect(
      summaryBody.byStatus.reduce(
        (total: number, row: { count: number }) => total + row.count,
        0,
      ),
    ).toBe(2);

    const label = await ncRequest(`/${own}/label`);
    expect(label.status).toBe(200);
    expect((await label.json()).label).toMatch(/^NC-2026-/);

    const detail = await ncRequest(`/${own}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.job).toMatchObject({ id: job.jobId, status: "DRAFT" });
    expect(detailBody.detectedByName).toBe(`User ${a.userId}`);

    const withCapa = await (await ncRequest(`/${linked}`)).json();
    expect(withCapa.capa).toMatchObject({
      id: capa.id,
      capaNumber: capa.capaNumber,
    });

    expect((await ncRequest(`/${foreign}/label`)).status).toBe(404);
    expect((await ncRequest(`/${foreign}`)).status).toBe(404);
  });

  it("REQ-18E-NC-2: create checks the job against the lab, writes the NC and its audit row; the audit log lists it", async () => {
    const { a, b } = await twoLabs();
    const ownJob = await seedJobForOrg({
      orgId: a.orgId,
      unitId: a.unitId,
      createdBy: a.userId,
    });
    const foreignJob = await seedJobForOrg({
      orgId: b.orgId,
      unitId: b.unitId,
      createdBy: b.userId,
    });
    const body = {
      type: "work",
      description: "Procedimento aplicado fora da revisao vigente",
      detectedAt: DETECTED_AT,
    };

    const refused = await ncRequest("/", {
      method: "POST",
      body: { ...body, jobId: foreignJob.jobId },
    });
    expect(refused.status).toBe(404);
    expect(
      await db
        .select({ id: nonConformance.id })
        .from(nonConformance)
        .where(eq(nonConformance.organizationId, a.orgId)),
    ).toEqual([]);

    const created = await ncRequest("/", {
      method: "POST",
      body: { ...body, jobId: ownJob.jobId },
    });
    expect(created.status).toBe(201);
    const nc = await created.json();
    expect(nc.organizationId).toBe(a.orgId);
    expect(nc.jobId).toBe(ownJob.jobId);
    expect(await ncAuditActions(nc.id)).toEqual(["create"]);
    // The notification is handed over once, after the commit.
    expect(notifications.notifyNCCreated).toHaveBeenCalledTimes(1);
    expect(notifications.notifyNCCreated.mock.calls[0]?.[0]).toBe(nc.id);

    const log = await ncRequest(`/${nc.id}/audit-log`);
    expect(log.status).toBe(200);
    const logBody = await log.json();
    expect(logBody.data.map((row: { action: string }) => row.action)).toEqual([
      "create",
    ]);

    const foreign = await seedNc({ orgId: b.orgId, userId: b.userId });
    expect((await ncRequest(`/${foreign}/audit-log`)).status).toBe(404);
  });

  it("REQ-18E-NC-3: the §7.10 notification record hides the ack token; the manual acknowledgement registers once; lab B is a 404 and untouched", async () => {
    const { a, b } = await twoLabs();
    const jobA = await seedJobForOrg({
      orgId: a.orgId,
      unitId: a.unitId,
      createdBy: a.userId,
    });
    const jobB = await seedJobForOrg({
      orgId: b.orgId,
      unitId: b.unitId,
      createdBy: b.userId,
    });
    const ncA = await seedNc({
      orgId: a.orgId,
      userId: a.userId,
      type: "out_of_tolerance",
      jobId: jobA.jobId,
    });
    const ncB = await seedNc({
      orgId: b.orgId,
      userId: b.userId,
      type: "out_of_tolerance",
      jobId: jobB.jobId,
    });
    const own = await seedOotNotification({
      orgId: a.orgId,
      userId: a.userId,
      ncId: ncA,
      jobId: jobA.jobId,
    });
    const foreign = await seedOotNotification({
      orgId: b.orgId,
      userId: b.userId,
      ncId: ncB,
      jobId: jobB.jobId,
    });

    const read = await ncRequest(`/${ncA}/oot-notification`);
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expect(readBody.data).toMatchObject({
      id: own.id,
      certificateNumber: "CERT-0001",
      status: "SENT",
    });
    expect(JSON.stringify(readBody)).not.toContain(own.ackToken);
    expect((await ncRequest(`/${ncB}/oot-notification`)).status).toBe(404);

    const ack = await ncRequest(`/${ncA}/oot-ack`, {
      method: "POST",
      body: { note: "Confirmado por telefone com o responsavel" },
    });
    expect(ack.status).toBe(200);
    const [stamped] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, own.id));
    expect(stamped).toMatchObject({
      status: "ACKNOWLEDGED",
      acknowledgedVia: "manual",
      acknowledgedNote: "Confirmado por telefone com o responsavel",
    });
    expect(stamped?.acknowledgedAt).toBeInstanceOf(Date);
    expect(await ncAuditActions(ncA)).toEqual(["oot_acknowledged"]);
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);

    const again = await ncRequest(`/${ncA}/oot-ack`, {
      method: "POST",
      body: { note: "Segunda confirmacao" },
    });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("ALREADY_ACKNOWLEDGED");
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);

    const refused = await ncRequest(`/${ncB}/oot-ack`, {
      method: "POST",
      body: { note: "Tentativa entre laboratorios" },
    });
    expect(refused.status).toBe(404);
    const [untouched] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, foreign.id));
    expect(untouched?.status).toBe("SENT");
    expect(untouched?.acknowledgedAt).toBeNull();
    expect(await ncAuditActions(ncB)).toEqual([]);
  });

  it("REQ-18E-NC-4: the impact assessment saves, signs once and is immutable afterwards; lab B is a 404", async () => {
    const { a, b } = await twoLabs();
    const oot = await seedNc({
      orgId: a.orgId,
      userId: a.userId,
      type: "out_of_tolerance",
    });
    const plain = await seedNc({ orgId: a.orgId, userId: a.userId });
    const foreign = await seedNc({
      orgId: b.orgId,
      userId: b.userId,
      type: "out_of_tolerance",
    });
    const draft = {
      deviationSummary: "Desvio de 0,3 g no ponto de 100 g",
      items: [{ description: "Calibracao CERT-0001", disposition: "recheck" }],
    };

    expect((await ncRequest(`/${oot}/oot-impact-assessment`)).status).toBe(200);
    expect(
      (await (await ncRequest(`/${oot}/oot-impact-assessment`)).json()).data,
    ).toBeNull();
    expect(
      (
        await ncRequest(`/${plain}/oot-impact-assessment`, {
          method: "PUT",
          body: draft,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await ncRequest(`/${foreign}/oot-impact-assessment`, {
          method: "PUT",
          body: draft,
        })
      ).status,
    ).toBe(404);
    expect((await ncRequest(`/${foreign}/oot-impact-assessment`)).status).toBe(
      404,
    );

    const saved = await ncRequest(`/${oot}/oot-impact-assessment`, {
      method: "PUT",
      body: draft,
    });
    expect(saved.status).toBe(200);
    const rowsAfterFirst = await db
      .select()
      .from(ootImpactAssessment)
      .where(eq(ootImpactAssessment.ncId, oot));
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0]?.organizationId).toBe(a.orgId);

    // Saving again updates the same record.
    const updated = await ncRequest(`/${oot}/oot-impact-assessment`, {
      method: "PUT",
      body: { ...draft, conclusion: "no_significant_impact" },
    });
    expect(updated.status).toBe(200);
    const rowsAfterSecond = await db
      .select()
      .from(ootImpactAssessment)
      .where(eq(ootImpactAssessment.ncId, oot));
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]?.conclusion).toBe("no_significant_impact");

    const read = await (
      await ncRequest(`/${oot}/oot-impact-assessment`)
    ).json();
    expect(read.data.deviationSummary).toBe(draft.deviationSummary);

    expect(
      (
        await ncRequest(`/${foreign}/oot-impact-assessment/sign`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);

    const signed = await ncRequest(`/${oot}/oot-impact-assessment/sign`, {
      method: "POST",
    });
    expect(signed.status).toBe(200);
    const [row] = await db
      .select()
      .from(ootImpactAssessment)
      .where(eq(ootImpactAssessment.ncId, oot));
    expect(row?.signedBy).toBe(a.userId);
    expect(row?.signedAt).toBeInstanceOf(Date);

    const resign = await ncRequest(`/${oot}/oot-impact-assessment/sign`, {
      method: "POST",
    });
    expect(resign.status).toBe(409);
    const edit = await ncRequest(`/${oot}/oot-impact-assessment`, {
      method: "PUT",
      body: {
        ...draft,
        deviationSummary: "Texto alterado depois da assinatura",
      },
    });
    expect(edit.status).toBe(409);
    expect((await edit.json()).code).toBe("ASSESSMENT_SIGNED");
    expect(await ncAuditActions(oot)).toEqual([
      "impact_assessment_saved",
      "impact_assessment_saved",
      "impact_assessment_signed",
    ]);
  });

  it("REQ-18E-NC-4b: signing needs a conclusion", async () => {
    const { a } = await twoLabs();
    const oot = await seedNc({
      orgId: a.orgId,
      userId: a.userId,
      type: "out_of_tolerance",
    });
    await ncRequest(`/${oot}/oot-impact-assessment`, {
      method: "PUT",
      body: { deviationSummary: "Desvio de 0,3 g no ponto de 100 g" },
    });
    const res = await ncRequest(`/${oot}/oot-impact-assessment/sign`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CONCLUSION_REQUIRED");
    const [row] = await db
      .select()
      .from(ootImpactAssessment)
      .where(eq(ootImpactAssessment.ncId, oot));
    expect(row?.signedAt).toBeNull();
  });

  it("REQ-18E-NC-5: a failing audit insert rolls the escalation back: no CAPA, no CAPA audit, NC unlinked, no notification", async () => {
    const { a } = await twoLabs();
    const nc = await seedNc({ orgId: a.orgId, userId: a.userId });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await db.execute(
      sql.raw(`create or replace function p218e_fail_nc_audit() returns trigger
        language plpgsql as $$ begin raise exception 'p218e: forced failure'; end $$`),
    );
    await db.execute(
      sql.raw(
        `create trigger p218e_fail_nc_audit before insert on non_conformance_audit_log
         for each row when (NEW.action = 'escalate_to_capa')
         execute function p218e_fail_nc_audit()`,
      ),
    );
    let status: number;
    try {
      const res = await ncRequest(`/${nc}/escalate-to-capa`, {
        method: "POST",
        body: {},
      });
      status = res.status;
    } finally {
      await db.execute(
        sql.raw(
          `drop trigger if exists p218e_fail_nc_audit on non_conformance_audit_log`,
        ),
      );
    }
    expect(status).toBe(500);

    expect(
      await db
        .select({ id: correctiveAction.id })
        .from(correctiveAction)
        .where(eq(correctiveAction.organizationId, a.orgId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: correctiveActionAuditLog.id })
        .from(correctiveActionAuditLog)
        .where(eq(correctiveActionAuditLog.organizationId, a.orgId)),
    ).toEqual([]);
    expect((await ncRow(nc)).capaId).toBeNull();
    expect(await ncAuditActions(nc)).toEqual([]);
    expect(notifications.notifyNCEscalatedToCapa).not.toHaveBeenCalled();

    // Without the failure the same request succeeds and notifies once, after the commit.
    const retry = await ncRequest(`/${nc}/escalate-to-capa`, {
      method: "POST",
      body: {},
    });
    expect(retry.status).toBe(201);
    expect((await ncRow(nc)).capaId).not.toBeNull();
    expect(await ncAuditActions(nc)).toEqual(["escalate_to_capa"]);
    expect(notifications.notifyNCEscalatedToCapa).toHaveBeenCalledTimes(1);
  });
});

describe("capa router: read handlers and the update audit (P2-18e)", () => {
  it("REQ-18E-CAPA-1: summary, label, detail (with linked NCs) and audit log read only the caller's lab; PUT audits; lab B is a 404", async () => {
    const { a, b } = await twoLabs();
    const own = await seedCapa({ orgId: a.orgId, userId: a.userId });
    const foreign = await seedCapa({ orgId: b.orgId, userId: b.userId });
    await seedCapa({ orgId: b.orgId, userId: b.userId });
    const linkedNc = await seedNc({
      orgId: a.orgId,
      userId: a.userId,
      capaId: own.id,
    });

    const summary = await capaRequest("/summary");
    expect(summary.status).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody.byStatus).toEqual([{ status: "OPEN", count: 1 }]);
    expect(summaryBody.totalClosed).toBe(0);

    const label = await capaRequest(`/${own.id}/label`);
    expect(label.status).toBe(200);
    expect(await label.json()).toEqual({ id: own.id, label: own.capaNumber });

    const detail = await capaRequest(`/${own.id}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.linkedNCs.map((row: { id: number }) => row.id)).toEqual([
      linkedNc,
    ]);
    expect(detailBody.createdByName).toBe(`User ${a.userId}`);

    const updated = await capaRequest(`/${own.id}`, {
      method: "PUT",
      body: { title: "Titulo revisado da CAPA" },
    });
    expect(updated.status).toBe(200);
    const log = await capaRequest(`/${own.id}/audit-log`);
    expect(log.status).toBe(200);
    const logBody = await log.json();
    expect(logBody.data.map((row: { action: string }) => row.action)).toEqual([
      "update",
    ]);
    expect(logBody.data[0].performedByName).toBe(`User ${a.userId}`);

    expect((await capaRequest(`/${foreign.id}/label`)).status).toBe(404);
    expect((await capaRequest(`/${foreign.id}`)).status).toBe(404);
    expect((await capaRequest(`/${foreign.id}/audit-log`)).status).toBe(404);
    expect(
      (
        await capaRequest(`/${foreign.id}`, {
          method: "PUT",
          body: { title: "Tentativa entre laboratorios" },
        })
      ).status,
    ).toBe(404);
    const [untouched] = await db
      .select()
      .from(correctiveAction)
      .where(eq(correctiveAction.id, foreign.id));
    expect(untouched?.title).toBe("CAPA de teste");
  });
});

describe("NC and CAPA numbers are per laboratory (Q33)", () => {
  it("REQ-18E-NUM-1: two labs each create their first NC and first CAPA of the year; both get the same number", async () => {
    const a = await seedOrg({ orgId: "org-a", role: "admin" });
    const b = await seedOrg({ orgId: "org-b", role: "admin" });
    const year = new Date().getFullYear();
    const ncBody = {
      type: "work",
      description: "Procedimento aplicado fora da revisao vigente",
      detectedAt: DETECTED_AT,
    };
    const capaBody = (responsibleId: string) => ({
      title: "Falha no procedimento de calibração",
      description: "Desvio identificado na verificação intermediária.",
      source: "nc_detection",
      sourceReference: null,
      detectionDate: "2026-06-01",
      type: "corrective",
      severity: "minor",
      category: "procedure",
      actionPlan: "Revisar o procedimento e retreinar a equipe.",
      responsibleId,
      dueDate: "2026-09-01",
      rootCauseAnalysis: null,
      rootCauseAnalysisMethod: null,
      preventiveMeasures: null,
    });

    const numbers: Record<string, { nc: string; capa: string }> = {};
    for (const lab of [a, b]) {
      loginAs({ userId: lab.userId, organizationId: lab.orgId });
      const nc = await ncRequest("/", { method: "POST", body: ncBody });
      expect(nc.status).toBe(201);
      const capa = await capaRequest("/", {
        method: "POST",
        body: capaBody(lab.userId),
      });
      expect(capa.status).toBe(201);
      numbers[lab.orgId] = {
        nc: (await nc.json()).ncNumber,
        capa: (await capa.json()).capaNumber,
      };
    }

    expect(numbers["org-a"]).toEqual({
      nc: `NC-${year}-0001`,
      capa: `CAPA-${year}-0001`,
    });
    expect(numbers["org-b"]).toEqual(numbers["org-a"]);

    // Within one laboratory the number stays unique: the next NC takes the next one.
    loginAs({ userId: a.userId, organizationId: a.orgId });
    const second = await ncRequest("/", { method: "POST", body: ncBody });
    expect((await second.json()).ncNumber).toBe(`NC-${year}-0002`);
  });
});

describe("public out-of-tolerance acknowledgement link (P2-18e)", () => {
  async function seedLab(orgId: string) {
    const lab = await seedOrg({ orgId, role: "admin" });
    const job = await seedJobForOrg({
      orgId,
      unitId: lab.unitId,
      createdBy: lab.userId,
    });
    const nc = await seedNc({
      orgId,
      userId: lab.userId,
      type: "out_of_tolerance",
      jobId: job.jobId,
    });
    const notification = await seedOotNotification({
      orgId,
      userId: lab.userId,
      ncId: nc,
      jobId: job.jobId,
    });
    return { lab, nc, notification };
  }

  it("REQ-18E-ACK-1: the page names the NC and its lab; POST stamps only that lab's notification and notifies once", async () => {
    const a = await seedLab("org-a");
    const b = await seedLab("org-b");

    const page = await ootAckRouter.request(`/${a.notification.ackToken}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("NC-2026-0001");
    expect(html).toContain("Lab org-a");
    expect(html).not.toContain("Lab org-b");

    const stamped = await ootAckRouter.request(`/${a.notification.ackToken}`, {
      method: "POST",
    });
    expect(stamped.status).toBe(200);
    expect(await stamped.text()).toContain("Recebimento confirmado");

    const [own] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, a.notification.id));
    expect(own).toMatchObject({
      status: "ACKNOWLEDGED",
      acknowledgedVia: "email_link",
    });
    expect(own?.acknowledgedAt).toBeInstanceOf(Date);
    const [other] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, b.notification.id));
    expect(other?.status).toBe("SENT");
    expect(other?.acknowledgedAt).toBeNull();
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);
    expect(notifications.notifyOotAcknowledged.mock.calls[0]).toEqual([
      a.notification.id,
      a.nc,
      "NC-2026-0001",
      "org-a",
    ]);

    // A second click only renders the "already confirmed" page: nothing is stamped or sent again.
    const again = await ootAckRouter.request(`/${a.notification.ackToken}`, {
      method: "POST",
    });
    expect(again.status).toBe(200);
    expect(await again.text()).toContain("Recebimento já confirmado");
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);

    const unknown = await ootAckRouter.request(
      "/00000000-0000-4000-8000-000000000000",
      { method: "POST" },
    );
    expect(unknown.status).toBe(404);
  });

  it("REQ-18E-ACK-2 (Q34): two concurrent acknowledgements stamp once, notify once and keep the first timestamp", async () => {
    const a = await seedLab("org-a");
    const click = () =>
      ootAckRouter.request(`/${a.notification.ackToken}`, { method: "POST" });

    const responses = await Promise.all([click(), click(), click()]);
    expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
    const pages = await Promise.all(responses.map((res) => res.text()));
    expect(
      pages.filter((html) => html.includes("Recebimento confirmado")),
    ).toHaveLength(1);
    expect(
      pages.filter((html) => html.includes("Recebimento já confirmado")),
    ).toHaveLength(2);
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);

    const [stamped] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, a.notification.id));
    expect(stamped?.status).toBe("ACKNOWLEDGED");
    const firstStamp = stamped?.acknowledgedAt;
    expect(firstStamp).toBeInstanceOf(Date);

    // A later click leaves the first timestamp (and the notification count) alone.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await click()).status).toBe(200);
    const [after] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, a.notification.id));
    expect(after?.acknowledgedAt?.getTime()).toBe(firstStamp?.getTime());
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);
  });

  it("REQ-18E-ACK-3 (Q34): a manual acknowledgement racing the public link stamps once and notifies once; a later manual one is a 409 and keeps the first timestamp", async () => {
    const a = await seedLab("org-a");
    loginAs({ userId: a.lab.userId, organizationId: a.lab.orgId });

    const [manual, link] = await Promise.all([
      ncRequest(`/${a.nc}/oot-ack`, {
        method: "POST",
        body: { note: "Confirmado por telefone" },
      }),
      ootAckRouter.request(`/${a.notification.ackToken}`, { method: "POST" }),
    ]);

    const [stamped] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, a.notification.id));
    expect(stamped?.status).toBe("ACKNOWLEDGED");
    const firstStamp = stamped?.acknowledgedAt;
    expect(firstStamp).toBeInstanceOf(Date);
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);

    // The link answers 200 whoever won; the manual call is the loser's 409.
    expect(link.status).toBe(200);
    if (stamped?.acknowledgedVia === "manual") {
      expect(manual.status).toBe(200);
      expect(stamped.acknowledgedNote).toBe("Confirmado por telefone");
      expect(await ncAuditActions(a.nc)).toEqual(["oot_acknowledged"]);
    } else {
      expect(stamped?.acknowledgedVia).toBe("email_link");
      expect(manual.status).toBe(409);
      expect((await manual.json()).code).toBe("ALREADY_ACKNOWLEDGED");
      expect(stamped?.acknowledgedNote).toBeNull();
      expect(await ncAuditActions(a.nc)).toEqual([]);
    }

    // A later manual acknowledgement is refused and changes nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const later = await ncRequest(`/${a.nc}/oot-ack`, {
      method: "POST",
      body: { note: "Segunda confirmacao" },
    });
    expect(later.status).toBe(409);
    const laterBody = await later.json();
    expect(laterBody.code).toBe("ALREADY_ACKNOWLEDGED");
    expect(laterBody.error).toContain("já foi confirmado");
    const [after] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.id, a.notification.id));
    expect(after?.acknowledgedAt?.getTime()).toBe(firstStamp?.getTime());
    expect(after?.acknowledgedVia).toBe(stamped?.acknowledgedVia);
    expect(after?.acknowledgedNote).toBe(stamped?.acknowledgedNote);
    expect(notifications.notifyOotAcknowledged).toHaveBeenCalledTimes(1);
  });
});
