/**
 * contract.test.ts: P2-15 REQ-TC-4. The routes the desktop local-server keeps
 * after the offline scope was narrowed to field capture, intake and reference
 * reads (jobs reads, execution save/submit, attachments, environmental limits,
 * service-order create/list/get, asset create/list/get, asset types, customers /
 * standards / methods reads, sync) answer with the SAME response schemas in
 * `@calibra-facil/contracts` that the cloud API is held to
 * (`apps/api/src/routes/*-contract.int.spec.ts`). The local mirror is fed the
 * rows the cloud sync hands out (`applySyncBootstrap`), so a local read model
 * that drops or renames a field the clients rely on fails here.
 */

import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  assetDetailSchema,
  assetRecordSchema,
  assetTypesResponseSchema,
  assetsListResponseSchema,
  customerDetailSchema,
  customersListResponseSchema,
  effectiveEnvironmentalLimitsResponseSchema,
  jobDetailSchema,
  jobExecutionResponseSchema,
  jobsListResponseSchema,
  localAttachmentSchema,
  localAttachmentsResponseSchema,
  localDeadOutboxEventsResponseSchema,
  localDiagnosticsSchema,
  localSyncConflictsResponseSchema,
  syncBootstrapResponseSchema,
  syncPushRequestSchema,
  massCompositionProfilesResponseSchema,
  methodDetailSchema,
  methodsListResponseSchema,
  serviceOrderCreateResponseSchema,
  serviceOrderDetailResponseSchema,
  serviceOrdersListResponseSchema,
  standardSchema,
  standardsListResponseSchema,
  syncStatusSnapshotSchema,
  type SyncBootstrapResponse,
} from "@calibra-facil/contracts";
import { buildJobRow } from "@calibra-facil/contracts/jobs-fixtures";
import {
  buildEnvironmentalLimitRow,
  buildMassCompositionProfile,
  buildStandardRecord,
} from "@calibra-facil/contracts/standards-fixtures";
import {
  compileMethodDraft,
  fingerprintJson,
} from "@calibra-facil/method-definition";
import { ENGINE_VERSION } from "@calibra-facil/math-engine";
import { applySyncBootstrap, openLocalDatabase } from "@calibra-facil/local-db";
import { createLocalServer } from "./server";
import { createMethodDefinitionEngine } from "./method-engine";
import type { LocalServerConfig } from "./bootstrap";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const NOW = "2026-01-15T10:00:00.000Z";

/**
 * What the cloud's job detail carries and the offline mirror does not (REPORTED
 * for review, not loosened out of `jobDetailSchema`). Each group is a column the
 * SQLite cache does not keep because the workflow that owns it is online-only.
 */
const JOB_DETAIL_GAPS = [
  // Who created / reviewed the job: the review trail lives on the cloud.
  "createdBy",
  "approvedBy",
  "approverName",
  "rejectedBy",
  "rejectorName",
  "rejectionReason",
  // The amendment chain: amending a certificate is an online-only flow.
  "amendmentNumber",
  "amendmentReason",
  "supersededAt",
  "supersededById",
  "supersedesId",
  // Computed when the job is approved, which only happens online.
  "asFoundConformity",
  "asFoundMargins",
  // Printed on the cloud-rendered certificate and label.
  "certificateNumberingSnapshot",
  "labelUrl",
  "labName",
  "labStreet",
  "labNumber",
  "labComplement",
  "labNeighbourhood",
  "labCity",
  "labState",
  "labCep",
  "customerAddress",
  // Commercial terms of the service (billing is online-only).
  "servicePrice",
  "serviceTat",
];

function compiledMassErrorMethod() {
  const engine = createMethodDefinitionEngine();
  const result = compileMethodDraft(
    {
      id: "mass_error",
      version: 1,
      status: "published",
      name: "Mass error",
      inputs: [
        {
          kind: "scalar",
          key: "indication",
          label: "Indication",
          required: true,
        },
        {
          kind: "scalar",
          key: "reference",
          label: "Reference",
          required: true,
        },
      ],
      formulas: [
        {
          key: "error",
          label: "Error",
          expression: "indication - reference",
          outputKind: "error",
          required: true,
        },
      ],
      measurementModels: [],
      acceptanceCriteria: [],
      previewScenarios: [
        {
          key: "nominal",
          label: "Nominal",
          inputs: { indication: "10.03", reference: "10" },
          expected: { formulas: { error: "0.03" } },
        },
      ],
    },
    {
      engine,
      engineMetadata: {
        packageName: "@calibra-facil/math-engine",
        version: ENGINE_VERSION,
        optionsFingerprint: fingerprintJson(engine.options, "engine-options"),
      },
      requirePublishable: true,
    },
  );
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "method did not compile");
  }
  return result.method;
}

/** What the cloud hands a desktop at bootstrap: its own rows, camelCase. */
function cloudBootstrap(): SyncBootstrapResponse {
  const compiled = compiledMassErrorMethod();
  const methodSnapshot = {
    methodId: 321,
    methodName: "Mass error",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
    compiledMethod: compiled,
    methodFingerprint: compiled.methodFingerprint,
    engineVersion: compiled.engine.version,
    engineOptionsFingerprint: compiled.engine.optionsFingerprint,
    normalizedMethodJson: compiled.normalizedMethodJson,
  };

  return {
    serverTime: NOW,
    user: { id: "user-1", name: "Técnico", email: "tech@lab.test" },
    organization: { id: "org-1", type: "LAB" },
    activeUnits: [{ id: 1, name: "Matriz", role: "technician" }],
    permissions: {
      role: "technician",
      unitRole: "technician",
      activeUnitId: 1,
      accessibleUnitIds: [1],
      canAccessAllUnits: false,
    },
    featureFlags: {
      offlineApprovals: false,
      offlineCertificatePublication: false,
    },
    syncCursor: "cursor-1",
    publishedMethods: [
      {
        id: 321,
        name: "Mass error",
        description: null,
        version: 1,
        status: "PUBLISHED",
        assetTypeId: 456,
        dataFields: [],
        variableBindings: [],
        formulas: [],
        measurementModels: [],
        validations: [],
        uncertaintyParams: [],
        compiledMethod: compiled,
        methodFingerprint: compiled.methodFingerprint,
        methodEngine: {
          version: compiled.engine.version,
          optionsFingerprint: compiled.engine.optionsFingerprint,
        },
        publicationEvidence: { publishedAt: NOW },
        createdAt: NOW,
        publishedAt: NOW,
        parentId: null,
      },
    ],
    assetTypes: [
      {
        id: 456,
        name: "Balança",
        slug: "balanca",
        description: null,
        definition: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    customers: [
      {
        id: 123,
        name: "Acme Lab",
        tradeName: "Acme",
        taxId: "00.000.000/0001-00",
        email: "contato@acme.test",
        phone: null,
        address: null,
        authOrganizationId: "client-org-1",
        labOrganizationId: "org-1",
        groupId: null,
        compliance: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    assets: [
      {
        id: 789,
        customerId: 123,
        assetTypeId: 456,
        unitId: 1,
        name: "Balança 01",
        manufacturer: "Marca",
        model: "M1",
        serialNumber: "SN-001",
        tag: "TAG-001",
        status: "ACTIVE",
        baseMeasurementUnit: "g",
        specifications: null,
        lastCalibrationDate: null,
        nextCalibrationDate: null,
        comments: null,
        metrologyRegime: "INDUSTRIAL",
        regulatedInterval: null,
        nextLegalVerificationDate: null,
        installedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    services: [
      {
        id: 654,
        name: "Mass calibration",
        assetTypeId: 456,
        methodId: 321,
        isActive: true,
      },
    ],
    standards: [{ ...buildStandardRecord({ id: 111 }), unitId: 1 }],
    massCompositionProfiles: [buildMassCompositionProfile()],
    environmentalLimits: [
      buildEnvironmentalLimitRow({ id: 5, assetTypeId: null }),
      buildEnvironmentalLimitRow({
        id: 6,
        assetTypeId: 456,
        temperatureMax: 23,
      }),
    ],
    jobs: [
      buildJobRow({
        id: 12345,
        jobId: "CAL-2026-0001",
        customerId: 123,
        assetId: 789,
        serviceId: 654,
        status: "DRAFT",
        data: null,
        methodSnapshot,
        technicianId: "user-1",
      }),
    ],
    serviceOrders: [
      {
        id: 50,
        publicId: "so_synced",
        serviceOrderNumber: "OS-2026-0001",
        customerId: 123,
        assetId: 789,
        unitId: 1,
        status: "awaiting_tech_evaluation",
        priority: "normal",
        intakeType: "counter",
        claimedDefect: "Não liga",
        intakeCondition: "Riscos na carcaça",
        openedAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}

function bootLocalServer(
  options: {
    cloud?: {
      fetch: (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => Promise<Response>;
    };
  } = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-contract-"));
  tempDirectories.push(directory);
  const dbPath = path.join(directory, "calibra.sqlite");
  const config: LocalServerConfig = {
    host: "127.0.0.1",
    port: 4317,
    appVersion: "test",
    localServerVersion: "test",
    dbPath,
    storageRoot: path.join(directory, "files"),
    deviceId: "device-test",
    tenantId: null,
    organizationId: "org-1",
    unitId: 1,
    userId: "user-1",
    syncEnabled: true,
    bootstrapToken: null,
    cloudApiUrl: options.cloud ? "https://api.example.test" : null,
    cloudAuthToken: options.cloud ? "cloud-token" : null,
    cloudProxyToken: null,
    desktopRunId: "desktop-test-run",
    localServerRunId: "local-server-test-run",
  };
  const database = openLocalDatabase({ filePath: dbPath });
  const app = createLocalServer(config, database, options.cloud);
  applySyncBootstrap(database, cloudBootstrap());
  return { app, database };
}

function recordFromJson(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** The part of a Zod schema these tests use (this package has no `zod` dependency). */
type ContractSchema<TOutput> = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: TOutput }
    | { success: false; error: { issues: Array<{ path: PropertyKey[] }> } };
};

/** Parses with the cloud's contract schema; the issues name the drifting path. */
async function parsedBody<TOutput>(
  response: Response,
  schema: ContractSchema<TOutput>,
  expectedStatus = 200,
): Promise<TOutput> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `${response.url || "response"} drifted from its contract: ${JSON.stringify(result.error)}`,
    );
  }
  return result.data;
}

/**
 * The fields of a cloud response the offline mirror does not keep. They are
 * REPORTED, not loosened out of the schema: this asserts the exact set of
 * failing paths, so a NEW gap fails the test and a gap that gets fixed fails it
 * too (remove it from the list). Array indexes are normalised to `[]`.
 */
async function parsedWithKnownGaps(
  response: Response,
  schema: ContractSchema<unknown>,
  knownGaps: readonly string[],
  expectedStatus = 200,
) {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  const failing = result.success
    ? []
    : [
        ...new Set(
          result.error.issues.map((issue) =>
            issue.path
              .map((segment) =>
                typeof segment === "number" ? "[]" : `.${String(segment)}`,
              )
              .join("")
              .replace(/^\./, "")
              .replaceAll(".[]", "[]"),
          ),
        ),
      ].sort();
  expect(failing).toEqual([...knownGaps].sort());
}

function post(
  app: ReturnType<typeof bootLocalServer>["app"],
  route: string,
  body: unknown,
) {
  return app.request(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("local-server answers with the cloud's contract schemas (P2-15 REQ-TC-4)", () => {
  it("REQ-TC-4: jobs list and detail parse with the schemas the cloud jobs endpoints use", async () => {
    const { app, database } = bootLocalServer();

    const list = await parsedBody(
      await app.request("/api/jobs?page=1&limit=20"),
      jobsListResponseSchema,
    );
    expect(list.data.map((job) => job.jobId)).toEqual(["CAL-2026-0001"]);

    await parsedWithKnownGaps(
      await app.request("/api/jobs/12345"),
      jobDetailSchema,
      JOB_DETAIL_GAPS,
    );
    // A job that is still open has no frozen asset snapshot: like the cloud, the
    // detail derives one from the live asset (type slug included).
    const detail = recordFromJson(
      await (await app.request("/api/jobs/12345")).json(),
    );
    expect(recordFromJson(detail.assetSnapshot)).toMatchObject({
      assetId: 789,
      assetTypeSlug: "balanca",
      tag: "TAG-001",
    });
    database.close();
  });

  it("REQ-TC-4: execution save and submit answer with the cloud's { message, data } job row", async () => {
    const { app, database } = bootLocalServer();
    const worksheet = {
      data: { indication: "10.03", reference: "10" },
      selectedStandardIds: [111],
      environment: { temperature: 21, humidity: 50, pressure: 1013 },
      calibrationLocation: { type: "lab", addressText: "Laboratório" },
    };

    const saved = await parsedBody(
      await post(app, "/api/jobs/12345/execute", worksheet),
      jobExecutionResponseSchema,
    );
    expect(saved.data.status).toBe("IN_PROGRESS");
    await parsedWithKnownGaps(
      await app.request("/api/jobs/12345"),
      jobDetailSchema,
      JOB_DETAIL_GAPS,
    );

    const submitted = await parsedBody(
      await post(app, "/api/jobs/12345/submit", worksheet),
      jobExecutionResponseSchema,
    );
    expect(submitted.data.status).toBe("REVIEW");
    await parsedWithKnownGaps(
      await app.request("/api/jobs/12345"),
      jobDetailSchema,
      JOB_DETAIL_GAPS,
    );
    database.close();
  });

  it("REQ-TC-4: standards list, detail and the composition-profile catalog parse", async () => {
    const { app, database } = bootLocalServer();

    const list = await parsedBody(
      await app.request("/api/standards?status=ACTIVE&limit=100"),
      standardsListResponseSchema,
    );
    expect(list.data.map((standard) => standard.id)).toEqual([111]);
    await parsedBody(await app.request("/api/standards/111"), standardSchema);
    const catalog = await parsedBody(
      await app.request("/api/standards/composition-profiles"),
      massCompositionProfilesResponseSchema,
    );
    expect(catalog.data).toHaveLength(1);
    database.close();
  });

  it("REQ-TC-4: environmental limits answer with the cloud's source vocabulary", async () => {
    const { app, database } = bootLocalServer();

    const override = await parsedBody(
      await app.request("/api/environmental-limits/effective/456?unitId=1"),
      effectiveEnvironmentalLimitsResponseSchema,
    );
    expect(override.source).toBe("asset_type");
    expect(override.limits?.temperatureMax).toBe(23);

    const fallback = await parsedBody(
      await app.request("/api/environmental-limits/effective/999"),
      effectiveEnvironmentalLimitsResponseSchema,
    );
    expect(fallback.source).toBe("unit_default");

    database.close();
  });

  it("REQ-TC-4: customers, asset types and methods reads parse", async () => {
    const { app, database } = bootLocalServer();

    const customers = await parsedBody(
      await app.request("/api/customers"),
      customersListResponseSchema,
    );
    expect(customers.data.map((customer) => customer.name)).toEqual([
      "Acme Lab",
    ]);
    await parsedBody(
      await app.request("/api/customers/123"),
      customerDetailSchema,
    );
    const assetTypes = await parsedBody(
      await app.request("/api/asset-types"),
      assetTypesResponseSchema,
    );
    // The mirror keeps the cloud's slug (it used to answer with its own row id).
    expect(assetTypes.data.map((type) => type.slug)).toEqual(["balanca"]);
    const methods = await parsedBody(
      await app.request("/api/methods?status=PUBLISHED&limit=100"),
      methodsListResponseSchema,
    );
    expect(methods.data.map((method) => method.name)).toEqual(["Mass error"]);
    await parsedBody(await app.request("/api/methods/321"), methodDetailSchema);
    database.close();
  });

  it("REQ-TC-4: asset create, list and get parse", async () => {
    const { app, database } = bootLocalServer();

    const created = await parsedBody(
      await post(app, "/api/assets", {
        customerId: 123,
        assetTypeId: 456,
        name: "Balança de campo",
        serialNumber: "SN-FIELD",
        tag: "TAG-FIELD",
        status: "ACTIVE",
      }),
      assetRecordSchema,
      201,
    );
    expect(created.tag).toBe("TAG-FIELD");

    const list = await parsedBody(
      await app.request("/api/assets?page=1&limit=20"),
      assetsListResponseSchema,
    );
    expect(list.data.map((asset) => asset.tag).sort()).toEqual(
      ["TAG-FIELD", "TAG-001"].sort(),
    );
    const detail = await parsedBody(
      await app.request("/api/assets/789"),
      assetDetailSchema,
    );
    expect(detail.assetTypeSlug).toBe("balanca");
    await parsedBody(
      await app.request(`/api/assets/${created.id}`),
      assetDetailSchema,
    );
    database.close();
  });

  it("REQ-TC-4: service-order create, list and get parse (synced and locally captured)", async () => {
    const { app, database } = bootLocalServer();

    const created = await parsedBody(
      await post(app, "/api/service-orders", {
        customerId: 123,
        assetId: 789,
        claimedDefect: "Display apagado",
        intakeCondition: "Sem avarias aparentes",
      }),
      serviceOrderCreateResponseSchema,
      201,
    );

    const list = await parsedBody(
      await app.request("/api/service-orders?page=1&limit=20"),
      serviceOrdersListResponseSchema,
    );
    expect(list.data).toHaveLength(2);
    await parsedBody(
      await app.request("/api/service-orders/50"),
      serviceOrderDetailResponseSchema,
    );
    await parsedBody(
      await app.request(`/api/service-orders/${created.data.id}`),
      serviceOrderDetailResponseSchema,
    );
    database.close();
  });

  it("REQ-TC-4: what the desktop pushes parses with the schema the cloud's /api/sync/push validates with", async () => {
    const pushBodies: unknown[] = [];
    const { app, database } = bootLocalServer({
      cloud: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/api/sync/push") {
            const body: unknown = JSON.parse(String(init?.body));
            pushBodies.push(body);
            const request = syncPushRequestSchema.parse(body);
            return Response.json({
              accepted: request.events.map((event) => ({
                eventId: event.eventId,
                remoteVersion: event.localVersion + 1,
                cloudEventId: `cloud:${event.eventId}`,
              })),
              rejected: [],
              conflicts: [],
              newCursor: "cursor-after-push",
            });
          }
          if (url.pathname === "/api/sync/pull") {
            return Response.json({
              cursor: "cursor-after-pull",
              hasMore: false,
              events: [],
            });
          }
          // The cloud's bootstrap is a contract fixture too.
          return Response.json(
            syncBootstrapResponseSchema.parse(cloudBootstrap()),
          );
        },
      },
    });

    // Field capture and intake queue outbox events...
    await post(app, "/api/jobs/12345/execute", {
      data: { indication: "10.03", reference: "10" },
      selectedStandardIds: [111],
      environment: { temperature: 21, humidity: 50, pressure: 1013 },
      calibrationLocation: { type: "lab", addressText: "Laboratório" },
    });
    await post(app, "/api/service-orders", {
      customerId: 123,
      assetId: 789,
      claimedDefect: "Display apagado",
      intakeCondition: "Sem avarias aparentes",
    });
    await post(app, "/api/assets", {
      customerId: 123,
      assetTypeId: 456,
      name: "Balança de campo",
      serialNumber: "SN-FIELD",
      tag: "TAG-FIELD",
      status: "ACTIVE",
    });

    // ...and a sync sends them: every batch is a valid push request.
    const sync = await app.request("/api/local/sync/start", { method: "POST" });
    expect(sync.status, await sync.clone().text()).toBe(200);
    expect(pushBodies.length).toBeGreaterThan(0);
    const events = pushBodies.flatMap(
      (body) => syncPushRequestSchema.parse(body).events,
    );
    expect(new Set(events.map((event) => event.entityType))).toEqual(
      new Set(["calibration_job", "service_order", "asset"]),
    );
    database.close();
  });

  it("REQ-TC-4: attachments upload and list parse, and sync status answers its snapshot", async () => {
    const { app, database } = bootLocalServer();

    const form = new FormData();
    form.set("entityType", "calibration_job");
    form.set("entityId", "12345");
    form.set(
      "file",
      new File(["measurement evidence"], "evidence.txt", {
        type: "text/plain",
      }),
    );
    const uploaded = await parsedBody(
      await app.request("/api/attachments", { method: "POST", body: form }),
      localAttachmentSchema,
      201,
    );
    const listed = await parsedBody(
      await app.request(
        "/api/attachments?entityType=calibration_job&entityId=12345",
      ),
      localAttachmentsResponseSchema,
    );
    expect(listed.data.map((attachment) => attachment.id)).toEqual([
      uploaded.id,
    ]);

    await parsedBody(
      await app.request("/api/local/sync/status"),
      syncStatusSnapshotSchema,
    );
    await parsedBody(
      await app.request("/api/local/sync/conflicts"),
      localSyncConflictsResponseSchema,
    );
    await parsedBody(
      await app.request("/api/local/sync/dead-events"),
      localDeadOutboxEventsResponseSchema,
    );
    await parsedBody(
      await app.request("/api/local/diagnostics"),
      localDiagnosticsSchema,
    );
    database.close();
  });
});
