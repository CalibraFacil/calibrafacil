import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Context, type Next } from "hono";

// Route tests for the from-template picker surface (catalog + adoption).
// We exercise the real `methodsRouter` and the REAL `@calibra-facil/method-templates`
// catalog (so the governance/[VERIFICAR] data under test is the shipped data), and
// only fake the DB + auth boundary.
//
// `dbQueue` is a FIFO of canned results: each awaited drizzle chain pulls the next
// entry, in the order the handler issues queries. `inserts` records every
// `db.insert(table).values(...)` so we can assert what the route persists — the
// DRAFT status and the frozen adoption evidence in the audit log.
const dbQueue: Array<unknown> = [];
const inserts: Array<{ table: unknown; values: unknown }> = [];

vi.mock("@calibra-facil/db", async () => {
  // Real schema table objects (no DB connection — schema.ts is pure table defs),
  // so the route's `eq(calibrationMethod.col, …)` and `db.insert(table)` resolve
  // against genuine drizzle columns; only `db` itself is faked.
  const schema = await vi.importActual<Record<string, unknown>>(
    "@calibra-facil/db/schema",
  );

  const resolveNext = () =>
    Promise.resolve(dbQueue.length ? dbQueue.shift() : []);

  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "selectDistinctOn",
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "groupBy",
    "orderBy",
    "limit",
    "offset",
    "set",
  ]) {
    builder[method] = () => builder;
  }
  // Thenable: an awaited select chain resolves the next canned result.
  // oxlint-disable-next-line unicorn/no-thenable
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => resolveNext().then(resolve, reject);

  builder.insert = (table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      const result: Record<string, unknown> = {
        // `.returning()` is awaited for the calibration_method insert.
        returning: () => resolveNext(),
      };
      // …while the audit-log insert is awaited directly (no `.returning()`).
      // oxlint-disable-next-line unicorn/no-thenable
      result.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => resolveNext().then(resolve, reject);
      return result;
    },
  });

  return { ...schema, db: builder };
});

// Auth boundary: inject a LAB member with the perms the routes require, so the
// handler logic (not the real auth/permission stack) is what's under test.
vi.mock("../../middleware/permission", () => {
  const setActor = async (c: Context, next: Next) => {
    c.set("session", { user: { id: "user-1" } });
    c.set("member", {
      id: "member-1",
      role: "LAB_ADMIN",
      organizationId: "lab-org-1",
      organizationType: "LAB",
      userId: "user-1",
    });
    await next();
  };
  return {
    withLabPermission: () => [setActor],
    requireRole: () => async (_c: Context, next: Next) => next(),
  };
});

const { methodsRouter } = await import("../methods");
const { listTemplates } = await import("@calibra-facil/method-templates");

// A governance-complete template that carries action-severity [VERIFICAR] refs,
// so the acknowledgement gate is actually exercised (electrical: cg-15 §4.1 etc.).
const electrical = listTemplates().find(
  (t) => t.key === "electrical-indication",
);
const actionRefs = (electrical?.governance?.verificarItems ?? [])
  .filter((item) => item.severity === "action")
  .map((item) => item.ref)
  .filter((ref): ref is string => typeof ref === "string");

function acknowledgements(
  templateVersion: number,
  acceptedVerificarRefs: string[],
) {
  return {
    readVerificarAndOmitted: true,
    acceptsVerificationDuty: true,
    understandsDraftGate: true,
    acknowledgedAt: "2026-06-18T00:00:00.000Z",
    templateVersion,
    acceptedVerificarRefs,
  };
}

function postFromTemplate(body: unknown) {
  return methodsRouter.request("/from-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  dbQueue.length = 0;
  inserts.length = 0;
});

describe("GET /templates (catalog)", () => {
  it("serves only governance-complete templates, each with the catalog DTO", async () => {
    const res = await methodsRouter.request("/templates");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Every served template carries complete governance + the spec/counts DTO.
    for (const entry of body) {
      expect(entry.governance).toBeTruthy();
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
});

describe("POST /from-template (adoption)", () => {
  it("guard: the chosen template has action-severity [VERIFICAR] refs", () => {
    expect(electrical).toBeTruthy();
    expect(actionRefs.length).toBeGreaterThan(0);
  });

  it("creates a DRAFT and freezes acknowledgements + cited sources into the audit log", async () => {
    if (!electrical) throw new Error("electrical template missing");
    dbQueue.push([{ id: 7 }]); // asset-type slug → id
    dbQueue.push([]); // uniqueness: no existing method
    dbQueue.push([{ id: 101, name: electrical.defaultName, status: "DRAFT" }]); // insert ... returning

    const res = await postFromTemplate({
      templateKey: "electrical-indication",
      acknowledgements: acknowledgements(
        electrical.templateVersion,
        actionRefs,
      ),
    });

    expect(res.status).toBe(201);
    // Exactly two writes: the method row, then the audit entry.
    expect(inserts.length).toBe(2);

    // (1) The created method is a DRAFT and never accredited.
    expect(inserts[0]?.values).toMatchObject({
      status: "DRAFT",
      accreditedScope: false,
      templateKey: "electrical-indication",
      templateVersion: electrical.templateVersion,
    });

    // (2) The audit log freezes the acknowledgements + an immutable snapshot of
    // the cited sources / [VERIFICAR] / omitted items at adoption time.
    expect(inserts[1]?.values).toMatchObject({
      action: "create",
      changes: {
        fromTemplate: "electrical-indication",
        templateVersion: electrical.templateVersion,
        acknowledgements: { acceptedVerificarRefs: actionRefs },
        governanceSnapshot: {
          sources: electrical.governance?.sources,
          verificarItems: electrical.governance?.verificarItems,
          omittedComponents: electrical.governance?.omittedComponents,
        },
      },
    });
  });

  it("rejects (400) when an action-severity [VERIFICAR] ref is unacknowledged", async () => {
    if (!electrical) throw new Error("electrical template missing");
    const res = await postFromTemplate({
      templateKey: "electrical-indication",
      acknowledgements: acknowledgements(electrical.templateVersion, []),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.missing)).toBe(true);
    expect(body.missing.length).toBeGreaterThan(0);
    expect(inserts.length).toBe(0); // nothing persisted
  });

  it("rejects (400) at the schema gate when a consent boolean is not true", async () => {
    if (!electrical) throw new Error("electrical template missing");
    const res = await postFromTemplate({
      templateKey: "electrical-indication",
      acknowledgements: {
        ...acknowledgements(electrical.templateVersion, actionRefs),
        understandsDraftGate: false,
      },
    });

    expect(res.status).toBe(400);
    expect(inserts.length).toBe(0);
  });

  it("returns 404 for an unknown template key", async () => {
    const res = await postFromTemplate({
      templateKey: "does-not-exist",
      acknowledgements: acknowledgements(1, []),
    });
    expect(res.status).toBe(404);
    expect(inserts.length).toBe(0);
  });
});
