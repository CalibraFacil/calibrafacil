import { beforeEach, describe, expect, it } from "vitest";
import { certificateTemplatesRouter } from "./certificate-templates";
import { db } from "@calibra-facil/db";
import {
  certificateTemplate,
  certificateTemplateVersion,
  member,
  subscription,
  user,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  hashCertificateDocument,
  newWysiwygStarterDocument,
} from "@calibra-facil/certificate-html-template";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the WYSIWYG engine routes
// (epic wysiwyg, spec 02 §6.1). Only the better-auth session is mocked;
// requireLabProtected/requireRole/requireFeature and every DB query run for
// real. No R2/Gotenberg involved — the wysiwyg document routes are pure
// DB + compiler, so unlike the XLSX routes they are FULLY coverable here
// (including validate + publish with its REAL trial compile).

const JSON_HEADERS = { "content-type": "application/json" };

async function seedProfessionalSubscription(organizationId: string) {
  await db.insert(subscription).values({
    organizationId,
    planId: "PROFESSIONAL",
    status: "ACTIVE",
    renewalMode: "NONE",
    currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
  });
}

async function seedWysiwygTemplate(params: {
  organizationId: string;
  createdBy: string;
  name?: string;
  versionStatus?: "DRAFT" | "VALIDATED" | "PUBLISHED";
  documentJson?: Record<string, unknown>;
}): Promise<{ templateId: number; versionId: number }> {
  const name = params.name ?? "Modelo Editor";
  const documentJson =
    params.documentJson ?? JSON.parse(JSON.stringify(newWysiwygStarterDocument()));
  const [templateRow] = await db
    .insert(certificateTemplate)
    .values({
      organizationId: params.organizationId,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      isDefault: false,
      createdBy: params.createdBy,
    })
    .returning({ id: certificateTemplate.id });
  if (!templateRow) throw new Error("seedWysiwygTemplate: template failed");
  const [versionRow] = await db
    .insert(certificateTemplateVersion)
    .values({
      organizationId: params.organizationId,
      templateId: templateRow.id,
      version: 1,
      status: params.versionStatus ?? "DRAFT",
      engine: "wysiwyg",
      documentJson,
      documentSha256: hashCertificateDocument(documentJson),
      renderPolicy: {
        converter: "gotenberg-chromium",
        compiler: "certificate-html-template",
        compilerVersion: "0.1.0",
      },
      createdBy: params.createdBy,
    })
    .returning({ id: certificateTemplateVersion.id });
  if (!versionRow) throw new Error("seedWysiwygTemplate: version failed");
  return { templateId: templateRow.id, versionId: versionRow.id };
}

function starterWithExtraParagraph(): Record<string, unknown> {
  const doc: { type: string; content: Record<string, unknown>[] } = JSON.parse(
    JSON.stringify(newWysiwygStarterDocument()),
  );
  // Body blocks land BEFORE the trailing bandPageFooter (pinned last since M-B).
  doc.content.splice(doc.content.length - 1, 0, {
    type: "paragraph",
    content: [
      { type: "text", text: "Cliente: " },
      { type: "placeholder", attrs: { path: "customer.name", label: "Razão social" } },
    ],
  });
  return doc;
}

async function versionRowById(versionId: number) {
  return db.query.certificateTemplateVersion.findFirst({
    where: eq(certificateTemplateVersion.id, versionId),
  });
}

beforeEach(async () => {
  await truncateAll();
  logout();
});

describe("certificate-templates wysiwyg routes — real DB + real middleware", () => {
  it("REQ-WTPL-001 POST / with engine=wysiwyg creates the template + a v1 DRAFT starter version", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Modelo Visual", engine: "wysiwyg" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item.organizationId).toBe(org.orgId);
    expect(body.initialVersion.engine).toBe("wysiwyg");
    expect(body.initialVersion.status).toBe("DRAFT");
    expect(body.initialVersion.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    const lockedBlocks = (body.initialVersion.documentJson.content ?? []).filter(
      (block: { type: string }) => block.type === "lockedBlock",
    );
    expect(lockedBlocks).toHaveLength(12);
  });

  it("REQ-WTPL-010 GET / lists wysiwygVersions summaries so DRAFTs stay reachable from the templates page", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const { versionId } = await seedWysiwygTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    const item = body.items.find(
      (candidate: { wysiwygVersions?: Array<{ id: number }> }) =>
        (candidate.wysiwygVersions ?? []).some(
          (version) => version.id === versionId,
        ),
    );
    expect(item).toBeDefined();
    expect(typeof item.slug).toBe("string");
    expect(item.wysiwygVersions[0].status).toBe("DRAFT");
    expect(item.wysiwygVersions[0].version).toBe(1);
  });

  it("REQ-WTPL-002 GET /placeholder-catalog serves the typed catalog to any lab member; 401 unauthenticated", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await certificateTemplatesRouter.request("/placeholder-catalog");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(40);
    expect(body.lockedBlocks).toHaveLength(12);
    expect(
      body.items.every(
        (entry: { path?: string; label?: string; source?: string }) =>
          entry.path && entry.label && entry.source,
      ),
    ).toBe(true);
    // §7.8.4.3 ban holds on the served catalog too.
    expect(
      body.items.some((entry: { path: string }) =>
        /nextCalibrationDate|calibrationIntervalMonths/.test(entry.path),
      ),
    ).toBe(false);

    logout();
    const anon = await certificateTemplatesRouter.request("/placeholder-catalog");
    expect(anon.status).toBe(401);
  });

  it("REQ-WTPL-003 PUT …/document saves a valid draft (server-side sha) and 422s an invalid one, atomically", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const { templateId, versionId } = await seedWysiwygTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const valid = starterWithExtraParagraph();
    const okRes = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/document`,
      { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ documentJson: valid }) },
    );
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json();
    expect(okBody.item.documentSha256).toBe(hashCertificateDocument(valid));

    // invalid: mandatory block removed — 422 with issues; row NOT clobbered.
    const invalid = JSON.parse(JSON.stringify(valid));
    invalid.content = invalid.content.filter(
      (block: { attrs?: { blockKey?: string } }) =>
        block.attrs?.blockKey !== "results_table",
    );
    const badRes = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/document`,
      { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ documentJson: invalid }) },
    );
    expect(badRes.status).toBe(422);
    const badBody = await badRes.json();
    expect(
      badBody.issues.some((issue: { message: string }) =>
        issue.message.includes("results_table"),
      ),
    ).toBe(true);
    const row = await versionRowById(versionId);
    expect(row?.documentSha256).toBe(hashCertificateDocument(valid));

    // unknown placeholder — 422 too.
    const unknown = JSON.parse(JSON.stringify(valid));
    unknown.content.push({
      type: "paragraph",
      content: [{ type: "placeholder", attrs: { path: "made.up" } }],
    });
    const unknownRes = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/document`,
      { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ documentJson: unknown }) },
    );
    expect(unknownRes.status).toBe(422);
  });

  it("REQ-WTPL-004 [HIGH RISK] published versions are immutable: PUT …/document -> 409", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const { templateId, versionId } = await seedWysiwygTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
      versionStatus: "PUBLISHED",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const before = await versionRowById(versionId);
    const res = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/document`,
      {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ documentJson: starterWithExtraParagraph() }),
      },
    );
    expect(res.status).toBe(409);
    const after = await versionRowById(versionId);
    expect(after?.documentSha256).toBe(before?.documentSha256);
  });

  it("REQ-WTPL-005 validate-document runs the REAL trial compile and promotes DRAFT -> VALIDATED", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const { templateId, versionId } = await seedWysiwygTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/validate-document`,
      { method: "POST", headers: JSON_HEADERS },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.trialCompile.compiledHtmlSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.status).toBe("VALIDATED");
    const row = await versionRowById(versionId);
    expect(row?.status).toBe("VALIDATED");
  });

  it("REQ-WTPL-006 publish gates on the real compiler: valid -> PUBLISHED; invalid seeded doc -> 409, stays unpublished", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const good = await seedWysiwygTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
      name: "Modelo Bom",
    });
    // Invalid document seeded DIRECTLY (bypassing the PUT validation) — the
    // publish gate must catch it independently (defense in depth).
    const invalidDoc: { type: string; content: Record<string, unknown>[] } =
      JSON.parse(JSON.stringify(newWysiwygStarterDocument()));
    invalidDoc.content = invalidDoc.content.filter(
      (block) =>
        !(
          typeof block.attrs === "object" &&
          block.attrs !== null &&
          Reflect.get(block.attrs, "blockKey") === "uncertainty_statement"
        ),
    );
    const bad = await seedWysiwygTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
      name: "Modelo Ruim",
      documentJson: invalidDoc,
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const okRes = await certificateTemplatesRouter.request(
      `/${good.templateId}/versions/${good.versionId}/publish`,
      { method: "POST", headers: JSON_HEADERS },
    );
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json();
    expect(okBody.item.status).toBe("PUBLISHED");

    const badRes = await certificateTemplatesRouter.request(
      `/${bad.templateId}/versions/${bad.versionId}/publish`,
      { method: "POST", headers: JSON_HEADERS },
    );
    expect(badRes.status).toBe(409);
    const badRow = await versionRowById(bad.versionId);
    expect(badRow?.status).not.toBe("PUBLISHED");
  });

  it("REQ-WTPL-007 [HIGH RISK] tenant isolation: org B gets 404 on org A's version for every wysiwyg route", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    await seedProfessionalSubscription(orgA.orgId);
    await seedProfessionalSubscription(orgB.orgId);
    const { templateId, versionId } = await seedWysiwygTemplate({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
    });
    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });

    const putRes = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/document`,
      {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ documentJson: starterWithExtraParagraph() }),
      },
    );
    expect(putRes.status).toBe(404);

    const validateRes = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/validate-document`,
      { method: "POST", headers: JSON_HEADERS },
    );
    expect(validateRes.status).toBe(404);

    const forkRes = await certificateTemplatesRouter.request(
      `/${templateId}/versions/wysiwyg`,
      { method: "POST", headers: JSON_HEADERS },
    );
    expect(forkRes.status).toBe(404);

    // org A's row untouched.
    const row = await versionRowById(versionId);
    expect(row?.organizationId).toBe(orgA.orgId);
  });

  it("REQ-WTPL-008 RBAC: plain member cannot write (403) but can read the catalog", async () => {
    const admin = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(admin.orgId);
    const { templateId, versionId } = await seedWysiwygTemplate({
      organizationId: admin.orgId,
      createdBy: admin.userId,
    });
    // Second, non-admin member of the SAME org, inserted directly.
    const memberUserId = "member-user";
    await db.insert(user).values({
      id: memberUserId,
      name: "Membro Comum",
      email: "membro@lab.test",
    });
    await db.insert(member).values({
      id: `member-${admin.orgId}-${memberUserId}`,
      organizationId: admin.orgId,
      userId: memberUserId,
      role: "member",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    loginAs({ userId: memberUserId, organizationId: admin.orgId });
    const res = await certificateTemplatesRouter.request(
      `/${templateId}/versions/${versionId}/document`,
      {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ documentJson: starterWithExtraParagraph() }),
      },
    );
    expect(res.status).toBe(403);
    const catalog = await certificateTemplatesRouter.request("/placeholder-catalog");
    expect(catalog.status).toBe(200);
  });

  it("REQ-WTPL-009 POST …/versions/wysiwyg forks a new DRAFT copying the latest document", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    const { templateId } = await seedWysiwygTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
      versionStatus: "PUBLISHED",
      documentJson: starterWithExtraParagraph(),
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request(
      `/${templateId}/versions/wysiwyg`,
      { method: "POST", headers: JSON_HEADERS },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item.version).toBe(2);
    expect(body.item.status).toBe("DRAFT");
    expect(body.item.engine).toBe("wysiwyg");
    expect(body.item.documentSha256).toBe(
      hashCertificateDocument(starterWithExtraParagraph()),
    );
  });
});
