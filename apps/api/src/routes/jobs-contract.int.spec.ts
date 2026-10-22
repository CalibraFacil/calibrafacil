/**
 * jobs-contract.int.spec.ts: REQ-TC-5 (and P2-15 REQ-TC-2: create, flag-oot and
 * generate-label). The jobs endpoints' REAL responses
 * (real handlers, real middleware, real Postgres) must parse with the response
 * schemas in `@calibra-facil/contracts` that the client SDK validates against.
 * If a handler changes the shape it returns, this fails in CI before a client
 * ever sees it. (The handlers also `satisfies` the same types at compile time;
 * this proves the runtime values do, including the JSON snapshot columns.)
 *
 * Covered: GET /, GET /:id, POST /, POST /:id/execute, /submit, /approve,
 * /reject, /assign, /flag-oot, /generate-label, DELETE /:id, POST /:id/amend,
 * GET /technicians/list.
 * Not covered here: GET /:id/download and /download-label (they sign an object
 * storage URL; the handlers still `satisfies` the contract type).
 */

import { insertJobs, setJobStatus } from "../../test/integration/job-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  compileMethodDraft,
  fingerprintJson,
  type CalculationEngineLike,
} from "@calibra-facil/method-definition";
import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
  normalizeEngineOptions,
} from "@calibra-facil/math-engine";
import {
  jobAmendResponseSchema,
  jobCreateResponseSchema,
  jobDetailSchema,
  jobFlagOotResponseSchema,
  jobGenerateLabelResponseSchema,
  jobMutationResponseSchema,
  jobTechniciansResponseSchema,
  jobsListResponseSchema,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  calibrationMethod,
  member,
  referenceStandard,
  service,
  user,
} from "@calibra-facil/db/schema";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { eq, sql } from "drizzle-orm";
import { jobsRouter } from "./jobs";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const ORG = "org-contract";
const TECHNICIAN = "user-contract-tech";
const APPROVER = "user-contract-approver";

/** A real compiled method, so execute/submit reach their status write. */
function executableMethodSnapshot() {
  const normalizedOptions = normalizeEngineOptions(METHOD_ENGINE_OPTIONS);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- same adapter cast as routes/jobs.ts: math-engine exposes a narrower concrete type than method-definition's engine interface.
  const engine = createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
  const optionsFingerprint = fingerprintJson(
    normalizedOptions,
    "engine-options",
  );
  const compiled = compileMethodDraft(
    {
      id: "erro_indicacao",
      version: 1,
      status: "draft",
      name: "Erro de indicação",
      inputs: [
        {
          kind: "scalar",
          key: "indication",
          label: "Indicação",
          unit: "g",
          required: true,
        },
        {
          kind: "scalar",
          key: "reference",
          label: "Referência",
          unit: "g",
          required: true,
        },
      ],
      formulas: [
        {
          key: "error",
          label: "Erro",
          expression: "indication - reference",
          outputUnit: "g",
          outputKind: "error",
          required: true,
        },
      ],
    },
    {
      engine,
      engineMetadata: {
        packageName: "@calibra-facil/math-engine",
        version: normalizedOptions.engineVersion,
        optionsFingerprint,
      },
    },
  );
  if (!compiled.ok) {
    throw new Error(`executableMethodSnapshot: ${JSON.stringify(compiled)}`);
  }
  return {
    methodId: 1,
    methodName: "Erro de indicação",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
    compiledMethod: compiled.method,
    methodFingerprint: compiled.method.methodFingerprint,
    engineVersion: normalizedOptions.engineVersion,
    engineOptionsFingerprint: optionsFingerprint,
    normalizedMethodJson: compiled.method.normalizedMethodJson,
  };
}

async function seedLab() {
  const org = await seedOrg({ orgId: ORG, userId: TECHNICIAN, role: "admin" });
  await db.insert(user).values({
    id: APPROVER,
    name: "Aprovador",
    email: `${APPROVER}@lab.test`,
  });
  await db.insert(member).values({
    id: `member-${APPROVER}`,
    organizationId: ORG,
    userId: APPROVER,
    role: "admin",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const customerId = await seedCustomer({
    labOrganizationId: ORG,
    name: "Cliente Contrato",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Balança", slug: "balanca-contract", definition: [] })
    .returning({ id: assetType.id });
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: org.unitId,
      customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${customerId})`,
      assetTypeId: type?.id ?? 0,
      name: "Balança analítica",
      serialNumber: "SN-CONTRACT",
      tag: "TAG-CONTRACT",
      baseMeasurementUnit: "g",
    })
    .returning({ id: asset.id });
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: ORG,
      unitId: org.unitId,
      name: "Calibração de massa",
      isActive: true,
    })
    .returning({ id: service.id });
  const [standard] = await db
    .insert(referenceStandard)
    .values({
      organizationId: ORG,
      unitId: org.unitId,
      createdBy: TECHNICIAN,
      name: "Massa padrão",
      kind: "generic_scalar",
      serialNumber: "SN-STD-CONTRACT",
      certificateNumber: "CERT-CONTRACT",
      calibrationDate: new Date("2025-01-10T15:00:00.000Z"),
      nextCalibrationDate: addCalendarDays(labToday(), 90),
      coverageFactor: 2,
      distribution: "normal",
      status: "ACTIVE",
      referenceValue: 1,
      uncertainty: 0.01,
    })
    .returning({ id: referenceStandard.id });

  return {
    unitId: org.unitId,
    customerId,
    assetTypeId: type?.id ?? 0,
    assetId: assetRow?.id ?? 0,
    serviceId: serviceRow?.id ?? 0,
    standardId: standard?.id ?? 0,
  };
}

type Lab = Awaited<ReturnType<typeof seedLab>>;

async function seedJob(
  lab: Lab,
  jobId: string,
  status: typeof calibrationJob.$inferInsert.status,
) {
  const [row] = await insertJobs({
    jobId,
    certificateName: jobId,
    organizationId: ORG,
    unitId: lab.unitId,
    customerId: lab.customerId,
    assetId: lab.assetId,
    serviceId: lab.serviceId,
    createdBy: TECHNICIAN,
    technicianId: TECHNICIAN,
    status,
    methodSnapshot: executableMethodSnapshot(),
  });
  if (!row) throw new Error("seedJob: insert failed");
  return row.id;
}

function post(path: string, body: unknown) {
  return jobsRouter.request(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Parses with the contract schema; the issues name the drifting path on failure. */
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

describe("jobs endpoints: real responses honor the contract schemas (REQ-TC-5)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("REQ-TC-5: GET /, GET /:id and GET /technicians/list parse (open job, derived asset snapshot)", async () => {
    const lab = await seedLab();
    const id = await seedJob(lab, "JOB-TC-READ", "DRAFT");
    loginAs({ userId: TECHNICIAN, organizationId: ORG });

    const list = await parsedBody(
      await jobsRouter.request("/?page=1&limit=20"),
      jobsListResponseSchema,
    );
    expect(list.data.map((job) => job.jobId)).toEqual(["JOB-TC-READ"]);
    expect(list.data[0]?.customerName).toBe("Cliente Contrato");

    const detail = await parsedBody(
      await jobsRouter.request(`/${id}`),
      jobDetailSchema,
    );
    expect(detail.jobId).toBe("JOB-TC-READ");
    // An open job has no frozen asset snapshot: the handler derives one.
    expect(detail.assetSnapshot?.baseMeasurementUnit).toBe("g");
    expect(detail.methodSnapshot.methodName).toBe("Erro de indicação");
    // The web needs the unit (environmental limits lookup) and the as-found
    // verdict (out-of-tolerance badge): the detail must carry both keys.
    expect(detail.unitId).toBe(lab.unitId);
    expect(detail).toHaveProperty("asFoundConformity", null);
    expect(detail).toHaveProperty("asFoundMargins", null);

    await parsedBody(
      await jobsRouter.request("/technicians/list"),
      jobTechniciansResponseSchema,
    );
  });

  it("REQ-TC-5: execute, submit, approve and amend responses parse, and so does the detail at every step", async () => {
    const lab = await seedLab();
    const id = await seedJob(lab, "JOB-TC-FLOW", "DRAFT");
    loginAs({ userId: TECHNICIAN, organizationId: ORG });

    const worksheet = {
      data: { indication: "10", reference: "9" },
      selectedStandardIds: [lab.standardId],
      environment: { temperature: 22, humidity: 50, pressure: 1013 },
      calibrationLocation: { type: "lab", addressText: "Laboratório" },
      performedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };

    const executed = await parsedBody(
      await post(`/${id}/execute`, worksheet),
      jobMutationResponseSchema,
    );
    expect(executed.data.status).toBe("IN_PROGRESS");
    // The frozen evidence is part of the contract, not an opaque blob.
    const inProgress = await parsedBody(
      await jobsRouter.request(`/${id}`),
      jobDetailSchema,
    );
    expect(inProgress.standardsSnapshot?.map((s) => s.name)).toEqual([
      "Massa padrão",
    ]);
    expect(inProgress.environmentalSnapshot?.withinLimits).toBe(true);
    expect(inProgress.calibrationLocationSnapshot?.type).toBe("lab");

    const submitted = await parsedBody(
      await post(`/${id}/submit`, worksheet),
      jobMutationResponseSchema,
    );
    expect(submitted.data.status).toBe("REVIEW");
    await parsedBody(await jobsRouter.request(`/${id}`), jobDetailSchema);

    loginAs({ userId: APPROVER, organizationId: ORG });
    const approved = await parsedBody(
      await post(`/${id}/approve`, { reason: "Conforme" }),
      jobMutationResponseSchema,
    );
    expect(approved.data.status).toBe("GENERATING_PDF");
    const generating = await parsedBody(
      await jobsRouter.request(`/${id}`),
      jobDetailSchema,
    );
    expect(generating.approverName).toBe("Aprovador");

    // The certificate worker is not part of this test: finish the approval.
    await setJobStatus(id, "APPROVED", {
      certificateUrl: "/certificates/x.pdf",
    });
    const amended = await parsedBody(
      await post(`/${id}/amend`, {
        reason: "Correção do valor de referência",
      }),
      jobAmendResponseSchema,
      201,
    );
    expect(amended.originalJob.status).toBe("SUPERSEDED");
    expect(amended.amendedJob.amendmentNumber).toBe(1);

    const superseded = await parsedBody(
      await jobsRouter.request(`/${id}`),
      jobDetailSchema,
    );
    expect(superseded.supersededById).toBe(amended.amendedJob.id);
    await parsedBody(
      await jobsRouter.request(`/${amended.amendedJob.id}`),
      jobDetailSchema,
    );
  });

  it("REQ-TC-5: the detail of an approved job returns its as-found verdict and margins", async () => {
    const lab = await seedLab();
    const id = await seedJob(lab, "JOB-TC-ASFOUND", "REVIEW");
    await db
      .update(calibrationJob)
      .set({ results: { margem_conformidade_antes: [0.5, -0.1, 0.3] } })
      .where(eq(calibrationJob.id, id));
    loginAs({ userId: APPROVER, organizationId: ORG });

    await parsedBody(
      await post(`/${id}/approve`, { reason: "Conforme" }),
      jobMutationResponseSchema,
    );
    const detail = await parsedBody(
      await jobsRouter.request(`/${id}`),
      jobDetailSchema,
    );

    expect(detail.asFoundConformity).toBe("NON_CONFORMING");
    expect(detail.asFoundMargins).toEqual([0.5, -0.1, 0.3]);
    expect(detail.unitId).toBe(lab.unitId);
  });

  it("REQ-TC-5: reject, cancel and assign responses parse", async () => {
    const lab = await seedLab();
    const toReject = await seedJob(lab, "JOB-TC-REJECT", "REVIEW");
    const toCancel = await seedJob(lab, "JOB-TC-CANCEL", "DRAFT");
    const toAssign = await seedJob(lab, "JOB-TC-ASSIGN", "DRAFT");
    loginAs({ userId: APPROVER, organizationId: ORG });

    const rejected = await parsedBody(
      await post(`/${toReject}/reject`, { reason: "Dados inconsistentes" }),
      jobMutationResponseSchema,
    );
    expect(rejected.data.status).toBe("REJECTED");
    expect(rejected.data.rejectionReason).toBe("Dados inconsistentes");
    const rejectedDetail = await parsedBody(
      await jobsRouter.request(`/${toReject}`),
      jobDetailSchema,
    );
    expect(rejectedDetail.rejectorName).toBe("Aprovador");

    const canceled = await parsedBody(
      await jobsRouter.request(`/${toCancel}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Cancelamento de teste" }),
      }),
      jobMutationResponseSchema,
    );
    expect(canceled.data.status).toBe("CANCELED");

    const assigned = await parsedBody(
      await post(`/${toAssign}/assign`, { technicianId: TECHNICIAN }),
      jobMutationResponseSchema,
    );
    expect(assigned.data.technicianId).toBe(TECHNICIAN);
  });

  it("P2-15 REQ-TC-2: POST / answers 201 with the created job row", async () => {
    const lab = await seedLab();
    // A service with a PUBLISHED method: the snapshot the job freezes.
    const snapshot = executableMethodSnapshot();
    const [method] = await db
      .insert(calibrationMethod)
      .values({
        organizationId: ORG,
        assetTypeId: lab.assetTypeId,
        name: "Erro de indicação",
        version: 1,
        status: "PUBLISHED",
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
        methodFingerprint: snapshot.methodFingerprint,
        compiledMethod: snapshot.compiledMethod,
        methodEngine: {
          version: snapshot.engineVersion,
          optionsFingerprint: snapshot.engineOptionsFingerprint,
        },
        publicationEvidence: { publishedAt: "2026-01-01T00:00:00.000Z" },
        createdBy: TECHNICIAN,
      })
      .returning({ id: calibrationMethod.id });
    await db
      .update(service)
      .set({ methodId: method?.id })
      .where(eq(service.id, lab.serviceId));
    loginAs({ userId: TECHNICIAN, organizationId: ORG });

    const response = await jobsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(lab.unitId) },
      body: JSON.stringify({
        assetId: lab.assetId,
        serviceId: lab.serviceId,
        technicianId: TECHNICIAN,
      }),
    });
    const created = await parsedBody(response, jobCreateResponseSchema, 201);

    expect(created.status).toBe("DRAFT");
    expect(created.assetId).toBe(lab.assetId);
    expect(created.technicianId).toBe(TECHNICIAN);
    expect(created.methodSnapshot.methodName).toBe("Erro de indicação");
    // The create answer is the same row the detail then serves.
    const detail = await parsedBody(
      await jobsRouter.request(`/${created.id}`),
      jobDetailSchema,
    );
    expect(detail.jobId).toBe(created.jobId);
  });

  it("P2-15 REQ-TC-2: POST /:id/flag-oot answers 201 with the NC and the customer notification (or none)", async () => {
    const lab = await seedLab();
    const notified = await seedJob(lab, "JOB-TC-OOT-1", "APPROVED");
    const silent = await seedJob(lab, "JOB-TC-OOT-2", "APPROVED");
    loginAs({ userId: APPROVER, organizationId: ORG });

    const withNotice = await parsedBody(
      await post(`/${notified}/flag-oot`, {
        description: "Fora de tolerância",
        affectedScope: "Janela de medição de março",
        notifyCustomer: true,
      }),
      jobFlagOotResponseSchema,
      201,
    );
    expect(withNotice.data.nc.type).toBe("out_of_tolerance");
    expect(withNotice.data.nc.jobId).toBe(notified);
    expect(withNotice.data.notification?.status).toBe("PENDING");
    expect(withNotice.data.notification?.affectedScope).toBe(
      "Janela de medição de março",
    );

    const withoutNotice = await parsedBody(
      await post(`/${silent}/flag-oot`, { notifyCustomer: false }),
      jobFlagOotResponseSchema,
      201,
    );
    expect(withoutNotice.data.notification).toBeNull();
  });

  it("P2-15 REQ-TC-2: POST /:id/generate-label answers with the queued acknowledgement", async () => {
    const lab = await seedLab();
    const id = await seedJob(lab, "JOB-TC-LABEL", "APPROVED");
    loginAs({ userId: TECHNICIAN, organizationId: ORG });

    const queued = await parsedBody(
      await post(`/${id}/generate-label`, {}),
      jobGenerateLabelResponseSchema,
    );

    expect(queued.jobId).toBe(id);
  });
});
