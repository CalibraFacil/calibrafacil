import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createLocalAsset,
  createLocalAttachment,
  createLocalCustomer,
  createLocalServiceOrderDeliveryDocumentDraft,
  createLocalJobDraft,
  createLocalServiceOrderIntake,
  createLocalServiceOrderQuoteDraft,
  getLocalAssetDetail,
  getLocalAttachment,
  getLocalCustomerDetail,
  getLocalDashboardStats,
  getLocalDatabaseDiagnostics,
  getLocalEffectiveEnvironmentalLimits,
  getLocalSessionSnapshot,
  getLocalSchemaVersion,
  getLocalJobDetail,
  getLocalMethodDetail,
  getLocalServiceDetail,
  getLocalServiceOrderDetail,
  getLocalStandardDetail,
  buildLocalStandardsSnapshot,
  listLocalAssetTypes,
  listLocalAssets,
  listLocalAttachments,
  listLocalCustomers,
  listLocalJobs,
  listLocalMethods,
  listLocalCompositionProfiles,
  listLocalServices,
  listLocalServiceOrders,
  listLocalStandards,
  listSyncConflicts,
  openLocalDatabase,
  resolveSyncConflict,
  saveLocalServiceOrderExecutionNotes,
  saveLocalJobExecution,
  updateLocalCustomer,
  updateLocalCustomerCompliance,
  updateLocalAsset,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import {
  CreateAssetSchema,
  CreateCustomerSchema,
  CreateServiceOrderQuoteSchema,
  CreateServiceOrderSchema,
  IssueServiceOrderDeliveryDocumentSchema,
  UpdateComplianceSchema,
  UpdateAssetSchema,
  UpdateCustomerSchema,
  UpdateServiceOrderExecutionSchema,
} from "@calibra-facil/schemas";
import {
  localAttachmentSchema,
  localAttachmentsResponseSchema,
  localDiagnosticsSchema,
  localSessionSnapshotResponseSchema,
  localSyncConflictResolutionSchema,
  localSyncConflictsResponseSchema,
} from "@calibra-facil/contracts";
import {
  createLocalEnvironmentBootstrap,
  readLocalServerConfig,
  type LocalServerConfig,
} from "./bootstrap";
import {
  generateLocalCertificateDraft,
  readLocalCertificateDraftFile,
  storeLocalCertificateDraftPdf,
} from "./certificates";
import {
  createLocalSyncRuntime,
  notifyCloudConflictResolution,
  type LocalSyncRuntimeOptions,
} from "./sync";
import { executeLocalCompiledMethod } from "./execution";
import { registerPrinterRoutes } from "./printing/routes";

export type LocalServerInstance = {
  app: ReturnType<typeof createLocalServer>;
  config: LocalServerConfig;
  database: LocalDatabase;
};

type CalibrationLocationInput = {
  type: "customer_site" | "lab" | "other";
  addressText: string;
  notes?: string | null;
};

type CalibrationPhaseInput = {
  blocks: Record<
    string,
    {
      mode: "before_and_after" | "before_only" | "after_only" | "not_performed";
      reason?: string | null;
    }
  >;
};

type LocalJobCreateInput = {
  assetId?: number;
  serviceId?: number;
  technicianId?: string | null;
  dueDate?: string | null;
};

type LocalJobExecutionInput = {
  data: Record<string, unknown>;
  results: Record<string, unknown> | null;
  selectedStandardIds?: number[];
  environment?: {
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
  };
  calibrationLocation?: CalibrationLocationInput;
  calibrationPhases?: CalibrationPhaseInput;
};

function buildCalibrationLocationSnapshot(
  input: CalibrationLocationInput | undefined,
  existing: Record<string, unknown> | null | undefined,
  actorUserId: string,
): Record<string, unknown> | null | undefined {
  if (!input) return existing ?? undefined;

  return {
    type: input.type,
    addressText: input.addressText.trim(),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    recordedAt: new Date().toISOString(),
    recordedBy: actorUserId,
  };
}

function buildCalibrationPhaseSnapshot(
  input: CalibrationPhaseInput | undefined,
  existing: Record<string, unknown> | null | undefined,
  actorUserId: string,
): Record<string, unknown> | null | undefined {
  if (!input) return existing ?? undefined;

  const blocks: Record<string, unknown> = {};
  for (const [key, block] of Object.entries(input.blocks ?? {})) {
    if (!key.trim()) continue;
    if (!isCalibrationPhaseMode(block.mode)) continue;
    blocks[key] = {
      mode: block.mode,
      ...(block.reason?.trim() ? { reason: block.reason.trim() } : {}),
    };
  }

  return {
    blocks,
    recordedAt: new Date().toISOString(),
    recordedBy: actorUserId,
  };
}

function isCalibrationPhaseMode(mode: unknown) {
  return (
    mode === "before_and_after" ||
    mode === "before_only" ||
    mode === "after_only" ||
    mode === "not_performed"
  );
}

function validateCalibrationLocationForSubmit(
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  if (!snapshot) return "Local da calibração é obrigatório";
  if (
    snapshot.type !== "customer_site" &&
    snapshot.type !== "lab" &&
    snapshot.type !== "other"
  ) {
    return "Tipo de local da calibração é inválido";
  }
  if (
    typeof snapshot.addressText !== "string" ||
    !snapshot.addressText.trim()
  ) {
    return "Endereço/local da calibração é obrigatório";
  }
  return null;
}

function validateCalibrationPhasesForSubmit(
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  const blocks = snapshot?.blocks;
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
    return null;
  }

  for (const [blockKey, block] of Object.entries(blocks)) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      continue;
    }
    const blockRecord = recordFromUnknown(block);
    const mode = blockRecord.mode;
    const reason = blockRecord.reason;
    if (
      mode === "not_performed" &&
      (typeof reason !== "string" || reason.trim() === "")
    ) {
      return `Informe o motivo para não executar o bloco ${blockKey}`;
    }
  }

  return null;
}

export function createLocalServer(
  config: LocalServerConfig,
  database: LocalDatabase,
  syncOptions: LocalSyncRuntimeOptions = {},
) {
  const app = new Hono();
  const syncRuntime = createLocalSyncRuntime(config, database, syncOptions);
  const fetchImpl = syncOptions.fetch ?? fetch;

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return undefined;
        if (origin.startsWith("http://localhost:")) return origin;
        if (origin.startsWith("http://127.0.0.1:")) return origin;
        if (origin.startsWith("app://")) return origin;
        return undefined;
      },
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "x-calibra-local-token"],
    }),
  );

  const requireLocalApiToken: Parameters<typeof app.use>[1] = async (
    c,
    next,
  ) => {
    if (!config.bootstrapToken) {
      await next();
      return;
    }

    const authorization = c.req.header("authorization");
    const localToken = c.req.header("x-calibra-local-token");
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;

    if (
      bearerToken !== config.bootstrapToken &&
      localToken !== config.bootstrapToken
    ) {
      return c.json({ error: "Unauthorized local API request" }, 401);
    }

    await next();
  };

  app.use("/api/*", requireLocalApiToken);

  registerPrinterRoutes(app, database);

  // The environment bootstrap reveals the signed-in user/org/unit, so any
  // local process could otherwise enumerate who is logged in. It requires the
  // same token as /api/* — the desktop main process, which spawns this server
  // and generates the token, is its only consumer (readiness probe + IPC
  // bootstrap). Standalone dev without a bootstrapToken skips the check,
  // matching /api/*.
  app.get(
    "/.well-known/calibra/local-environment",
    requireLocalApiToken,
    (c) => {
      const context = getLocalRequestContext(config, database);
      return c.json({
        ...createLocalEnvironmentBootstrap(config),
        organizationId: context.organizationId,
        unitId: context.unitId,
        userId: context.userId,
        dbSchemaVersion: getLocalSchemaVersion(database),
      });
    },
  );

  app.get("/api/local/app-info", (c) => {
    const environment = createLocalEnvironmentBootstrap(config);

    return c.json({
      name: "CalibraFacil Local Server",
      version: environment.localServerVersion,
      dbSchemaVersion: getLocalSchemaVersion(database),
      deviceId: environment.deviceId,
      desktopRunId: config.desktopRunId,
      localServerRunId: config.localServerRunId,
    });
  });

  app.get("/api/local/session", (c) => {
    return c.json(
      localSessionSnapshotResponseSchema.parse({
        data: getLocalSessionSnapshot(database),
      }),
    );
  });

  app.get("/api/local/sync/status", (c) => {
    return c.json(syncRuntime.getStatus());
  });

  app.get("/api/local/diagnostics", (c) => {
    const syncStatus = syncRuntime.getStatus();
    return c.json(
      localDiagnosticsSchema.parse({
        runtime: {
          desktopRunId: config.desktopRunId,
          localServerRunId: config.localServerRunId,
        },
        sync: {
          state: syncStatus.state,
          activeRunId: syncStatus.activeRunId ?? null,
          lastRunId: syncStatus.lastRunId ?? null,
          lastError: syncStatus.lastError ?? null,
        },
        database: getLocalDatabaseDiagnostics(database),
      }),
    );
  });

  app.get("/api/local/sync/conflicts", (c) => {
    return c.json(
      localSyncConflictsResponseSchema.parse(
        listSyncConflicts(database, {
          status: parseConflictStatus(c.req.query("status")),
          limit: Number(c.req.query("limit") ?? "50"),
        }),
      ),
    );
  });

  app.post("/api/local/sync/conflicts/:id/resolve", async (c) => {
    const resolution = localSyncConflictResolutionSchema.parse(
      await readJsonOrEmpty(c.req.raw),
    );
    const conflict = resolveSyncConflict(
      database,
      c.req.param("id"),
      resolution.status,
    );

    if (!conflict) {
      return c.json({ error: "Conflito de sincronizacao nao encontrado" }, 404);
    }

    const cloudResolution = await notifyCloudConflictResolution(
      config,
      conflict.id,
      resolution.status,
      fetchImpl,
    );

    return c.json({
      data: conflict,
      syncStatus: syncRuntime.getStatus(),
      cloudResolution,
    });
  });

  app.get("/api/dashboard/stats", (c) => {
    return c.json(getLocalDashboardStats(database));
  });

  app.get("/api/jobs", (c) => {
    return c.json({
      ...listLocalJobs(database, {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "20"),
        customerId: parseNumber(c.req.query("customerId")),
        query: c.req.query("query") || undefined,
        status: parseJobStatus(c.req.query("status")),
      }),
    });
  });

  app.get("/api/jobs/technicians/list", (c) => {
    return c.json({ data: [] });
  });

  app.post("/api/jobs", async (c) => {
    const input = parseLocalJobCreateInput(await c.req.json());

    if (!input.assetId || !input.serviceId) {
      return c.json({ error: "Ativo e servico sao obrigatorios" }, 400);
    }

    const context = getLocalRequestContext(config, database);
    try {
      const job = createLocalJobDraft(database, {
        organizationId: context.organizationId,
        unitId: context.unitId,
        assetId: input.assetId,
        serviceId: input.serviceId,
        technicianId: input.technicianId,
        dueDate: input.dueDate,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json(job, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/services", (c) => {
    return c.json({
      ...listLocalServices(database, {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "20"),
        query: c.req.query("query") || undefined,
        assetTypeId: parseNumber(c.req.query("assetTypeId")),
        isActive: parseBoolean(c.req.query("isActive")),
      }),
    });
  });

  app.post("/api/services", (c) => {
    return c.json(
      {
        error:
          "Edicao local do catalogo de servicos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.get("/api/services/:id/audit-log", (c) => {
    const service = getLocalServiceDetail(database, c.req.param("id"));
    if (!service) {
      return c.json({ error: "Servico nao encontrado" }, 404);
    }

    return c.json({ data: [] });
  });

  app.get("/api/services/:id", (c) => {
    const service = getLocalServiceDetail(database, c.req.param("id"));
    if (!service) {
      return c.json({ error: "Servico nao encontrado" }, 404);
    }

    return c.json(service);
  });

  app.put("/api/services/:id", (c) => {
    return c.json(
      {
        error:
          "Edicao local do catalogo de servicos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.delete("/api/services/:id", (c) => {
    return c.json(
      {
        error:
          "Edicao local do catalogo de servicos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.get("/api/methods", (c) => {
    return c.json(
      listLocalMethods(database, {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "20"),
        status: c.req.query("status") || undefined,
        assetTypeId: parseNumber(c.req.query("assetTypeId")),
        query: c.req.query("query") || undefined,
      }),
    );
  });

  app.post("/api/methods", (c) => {
    return c.json(
      {
        error: "Autoria local de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/compile", (c) => {
    return c.json(
      {
        error:
          "Compilacao local de rascunhos de metodo ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/preview", (c) => {
    return c.json(
      {
        error:
          "Previa local de rascunhos de metodo ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.get("/api/methods/:id/audit", (c) => {
    const method = getLocalMethodDetail(database, c.req.param("id"));
    if (!method) {
      return c.json({ error: "Metodo nao encontrado" }, 404);
    }

    return c.json({ data: [] });
  });

  app.get("/api/methods/:id/label", (c) => {
    const method = getLocalMethodDetail(database, c.req.param("id"));
    if (!method) {
      return c.json({ error: "Metodo nao encontrado" }, 404);
    }

    return c.json({ id: method.id, label: method.name });
  });

  app.get("/api/methods/:id", (c) => {
    const method = getLocalMethodDetail(database, c.req.param("id"));
    if (!method) {
      return c.json({ error: "Metodo nao encontrado" }, 404);
    }

    return c.json(method);
  });

  app.put("/api/methods/:id", (c) => {
    return c.json(
      {
        error: "Autoria local de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/:id/archive", (c) => {
    return c.json(
      {
        error:
          "Arquivamento local de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/:id/new-version", (c) => {
    return c.json(
      {
        error:
          "Versionamento local de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/:id/technical-review", (c) => {
    return c.json(
      {
        error: "Revisao local de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/:id/quality-approve", (c) => {
    return c.json(
      {
        error:
          "Aprovacao local de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/:id/return-to-draft", (c) => {
    return c.json(
      {
        error:
          "Retorno local de metodos para rascunho ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/:id/publish", (c) => {
    return c.json(
      {
        error:
          "Publicacao local de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/methods/:id/request-approval", (c) => {
    return c.json(
      {
        error:
          "Solicitacao local de aprovacao de metodos ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.get("/api/jobs/:id", (c) => {
    const job = getLocalJobDetail(database, c.req.param("id"));
    if (!job) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    return c.json(job);
  });

  app.post("/api/jobs/:id/execute", async (c) => {
    const routeId = c.req.param("id");
    const input = parseLocalJobExecutionInput(await c.req.json());
    const current = getLocalJobDetail(database, routeId);

    if (!current) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    const context = getLocalRequestContext(config, database);
    const calibrationLocationSnapshot = buildCalibrationLocationSnapshot(
      input.calibrationLocation,
      recordOrNull(current.calibrationLocationSnapshot),
      context.userId ?? "local",
    );
    const calibrationPhaseSnapshot = buildCalibrationPhaseSnapshot(
      input.calibrationPhases,
      recordOrNull(current.calibrationPhaseSnapshot),
      context.userId ?? "local",
    );
    try {
      const standardsSnapshot = buildLocalStandardsSnapshot(
        database,
        input.selectedStandardIds,
        input.data,
      );
      const results = executeLocalCompiledMethod({
        methodSnapshot: recordFromUnknown(current.methodSnapshot),
        assetSnapshot: recordFromUnknown(current.assetSnapshot),
        standardsSnapshot:
          standardsSnapshot === undefined
            ? current.standardsSnapshot
            : standardsSnapshot,
        data: input.data,
        fallbackResults: input.results,
        environmentalSnapshot: input.environment,
        calibrationPhaseSnapshot,
        requireSuccess: false,
      });
      const job = saveLocalJobExecution(database, {
        routeId,
        data: input.data,
        results,
        selectedStandardIds: input.selectedStandardIds,
        environment: input.environment,
        calibrationLocationSnapshot,
        calibrationPhaseSnapshot,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json({ data: job });
    } catch (error) {
      return c.json(
        {
          error: errorMessage(error),
          diagnostics: getDiagnostics(error),
        },
        422,
      );
    }
  });

  app.post("/api/jobs/:id/submit", async (c) => {
    const routeId = c.req.param("id");
    const input = parseLocalJobExecutionInput(await c.req.json());
    const current = getLocalJobDetail(database, routeId);

    if (!current) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    const context = getLocalRequestContext(config, database);
    const calibrationLocationSnapshot = buildCalibrationLocationSnapshot(
      input.calibrationLocation,
      recordOrNull(current.calibrationLocationSnapshot),
      context.userId ?? "local",
    );
    const calibrationPhaseSnapshot = buildCalibrationPhaseSnapshot(
      input.calibrationPhases,
      recordOrNull(current.calibrationPhaseSnapshot),
      context.userId ?? "local",
    );
    const calibrationLocationError = validateCalibrationLocationForSubmit(
      calibrationLocationSnapshot,
    );
    if (calibrationLocationError) {
      return c.json({ error: calibrationLocationError }, 400);
    }
    const calibrationPhaseError = validateCalibrationPhasesForSubmit(
      calibrationPhaseSnapshot,
    );
    if (calibrationPhaseError) {
      return c.json({ error: calibrationPhaseError }, 400);
    }
    try {
      const standardsSnapshot = buildLocalStandardsSnapshot(
        database,
        input.selectedStandardIds,
        input.data,
      );
      const results = executeLocalCompiledMethod({
        methodSnapshot: recordFromUnknown(current.methodSnapshot),
        assetSnapshot: recordFromUnknown(current.assetSnapshot),
        standardsSnapshot:
          standardsSnapshot === undefined
            ? current.standardsSnapshot
            : standardsSnapshot,
        data: input.data,
        fallbackResults: input.results,
        environmentalSnapshot: input.environment,
        calibrationPhaseSnapshot,
        requireSuccess: true,
      });
      const job = saveLocalJobExecution(database, {
        routeId,
        data: input.data,
        results,
        selectedStandardIds: input.selectedStandardIds,
        environment: input.environment,
        calibrationLocationSnapshot,
        calibrationPhaseSnapshot,
        requireResults: true,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json({ data: job });
    } catch (error) {
      return c.json(
        {
          error: errorMessage(error),
          diagnostics: getDiagnostics(error),
        },
        422,
      );
    }
  });

  app.post("/api/jobs/:id/certificate-draft", async (c) => {
    try {
      return c.json(
        await generateLocalCertificateDraft(
          database,
          config,
          c.req.param("id"),
        ),
        201,
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/jobs/:id/certificate-draft/file", async (c) => {
    try {
      const file = await readLocalCertificateDraftFile(
        database,
        config,
        c.req.param("id"),
      );
      if (!file) {
        return c.json({ error: "Rascunho de certificado nao encontrado" }, 404);
      }

      return new Response(file.bytes, {
        headers: {
          "Content-Type": `${file.contentType}; charset=utf-8`,
          "Content-Disposition": `inline; filename="${file.fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/jobs/:id/certificate-draft/:draftId/pdf", async (c) => {
    try {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength === 0) {
        return c.json({ error: "PDF local vazio" }, 400);
      }

      return c.json(
        await storeLocalCertificateDraftPdf(
          database,
          config,
          c.req.param("id"),
          c.req.param("draftId"),
          bytes,
        ),
      );
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/customers", (c) => {
    return c.json({
      ...listLocalCustomers(database, {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "20"),
        query: c.req.query("query") || undefined,
      }),
    });
  });

  app.post("/api/customers", async (c) => {
    const input = CreateCustomerSchema.parse(await c.req.json());
    const context = getLocalRequestContext(config, database);

    try {
      const customer = createLocalCustomer(database, {
        organizationId: context.organizationId,
        unitId: context.unitId,
        name: input.name,
        taxId: input.taxId,
        email: input.email || null,
        phone: input.phone,
        address: input.address,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json(customer, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/customers/:id", (c) => {
    const customer = getLocalCustomerDetail(database, c.req.param("id"));

    if (!customer) {
      return c.json({ error: "Cliente local nao encontrado" }, 404);
    }

    return c.json(customer);
  });

  app.put("/api/customers/:id", async (c) => {
    const input = UpdateCustomerSchema.parse(await c.req.json());
    const context = getLocalRequestContext(config, database);

    try {
      const customer = updateLocalCustomer(database, {
        identifier: c.req.param("id"),
        name: input.name,
        taxId: input.taxId,
        email: input.email,
        phone: input.phone,
        address: input.address,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json(customer);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/customers/:id/audit-log", (c) => {
    return c.json({
      data: [],
      pagination: {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "50"),
        total: 0,
        totalPages: 0,
      },
    });
  });

  app.put("/api/customers/:id/compliance", async (c) => {
    const input = UpdateComplianceSchema.parse(await c.req.json());
    const context = getLocalRequestContext(config, database);

    try {
      const customer = updateLocalCustomerCompliance(database, {
        identifier: c.req.param("id"),
        compliance: input.compliance,
        reason: input.reason,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json(customer);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/customers/:id/members", (c) => {
    return c.json([]);
  });

  app.get("/api/customers/:id/invitations", (c) => {
    return c.json([]);
  });

  app.post("/api/customers/:id/invitations", (c) => {
    return c.json(
      { error: "Convites do portal exigem sincronizacao com a nuvem" },
      409,
    );
  });

  app.post("/api/customers/:id/invitations/:invId/resend", (c) => {
    return c.json(
      { error: "Reenvio de convite exige sincronizacao com a nuvem" },
      409,
    );
  });

  app.delete("/api/customers/:id/invitations/:invId", (c) => {
    return c.json(
      { error: "Cancelamento de convite exige sincronizacao com a nuvem" },
      409,
    );
  });

  app.delete("/api/customers/:id/members/:memberId", (c) => {
    return c.json(
      { error: "Remocao de usuario do portal exige sincronizacao com a nuvem" },
      409,
    );
  });

  app.get("/api/service-orders", (c) => {
    return c.json({
      ...listLocalServiceOrders(database, {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "20"),
        query: c.req.query("query") || undefined,
        status: parseServiceOrderStatus(c.req.query("status")),
      }),
    });
  });

  app.post("/api/service-orders", async (c) => {
    const parsed = CreateServiceOrderSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        {
          error: "Dados invalidos para OS local",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    const context = getLocalRequestContext(config, database);
    try {
      const serviceOrder = createLocalServiceOrderIntake(database, {
        ...parsed.data,
        organizationId: context.organizationId,
        unitId: context.unitId,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json({ data: serviceOrder }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/service-orders/:id", (c) => {
    const serviceOrder = getLocalServiceOrderDetail(
      database,
      c.req.param("id"),
    );
    if (!serviceOrder) {
      return c.json({ error: "Ordem de servico nao encontrada" }, 404);
    }

    return c.json({ data: serviceOrder });
  });

  app.post("/api/service-orders/:id/quotes", async (c) => {
    const parsed = CreateServiceOrderQuoteSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        {
          error: "Dados invalidos para orcamento local",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    const context = getLocalRequestContext(config, database);
    try {
      const quote = createLocalServiceOrderQuoteDraft(database, {
        routeId: c.req.param("id"),
        ...parsed.data,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json({ data: quote }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.patch("/api/service-orders/:id/execution", async (c) => {
    const parsed = UpdateServiceOrderExecutionSchema.safeParse(
      await c.req.json(),
    );
    if (!parsed.success) {
      return c.json(
        {
          error: "Dados invalidos para execucao local",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    const context = getLocalRequestContext(config, database);
    try {
      const execution = saveLocalServiceOrderExecutionNotes(database, {
        routeId: c.req.param("id"),
        ...parsed.data,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json({ data: execution });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/service-orders/:id/delivery-document", async (c) => {
    const parsed = IssueServiceOrderDeliveryDocumentSchema.safeParse(
      await c.req.json(),
    );
    if (!parsed.success) {
      return c.json(
        {
          error: "Dados invalidos para documento de entrega local",
          issues: parsed.error.issues,
        },
        400,
      );
    }

    const context = getLocalRequestContext(config, database);
    try {
      const document = createLocalServiceOrderDeliveryDocumentDraft(database, {
        routeId: c.req.param("id"),
        ...parsed.data,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json({ data: document }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/standards", (c) => {
    return c.json(
      listLocalStandards(database, {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "100"),
        query: c.req.query("query") || undefined,
        status: parseStandardStatus(c.req.query("status")),
      }),
    );
  });

  app.post("/api/standards", (c) => {
    return c.json(
      {
        error:
          "Edicao local de padroes de referencia ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.get("/api/standards/composition-profiles", (c) => {
    return c.json(listLocalCompositionProfiles(database));
  });

  app.get("/api/standards/:id/audit-log", (c) => {
    const standard = getLocalStandardDetail(database, c.req.param("id"));
    if (!standard) {
      return c.json({ error: "Padrao nao encontrado" }, 404);
    }

    return c.json({ data: [] });
  });

  app.get("/api/standards/:id", (c) => {
    const standard = getLocalStandardDetail(database, c.req.param("id"));
    if (!standard) {
      return c.json({ error: "Padrao nao encontrado" }, 404);
    }

    return c.json(standard);
  });

  app.get("/api/standards/:id/label", (c) => {
    const standard = getLocalStandardDetail(database, c.req.param("id"));
    if (!standard) {
      return c.json({ error: "Padrao nao encontrado" }, 404);
    }

    return c.json({ id: standard.id, label: standard.name });
  });

  app.put("/api/standards/:id", (c) => {
    return c.json(
      {
        error:
          "Edicao local de padroes de referencia ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.delete("/api/standards/:id", (c) => {
    return c.json(
      {
        error:
          "Edicao local de padroes de referencia ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.post("/api/standards/:id/renew", (c) => {
    return c.json(
      {
        error:
          "Renovacao local de certificado de padrao ainda nao esta disponivel no desktop",
      },
      409,
    );
  });

  app.get("/api/environmental-limits/effective/:assetTypeId", (c) => {
    const assetTypeId = parseNumber(c.req.param("assetTypeId"));
    const context = getLocalRequestContext(config, database);
    const limits = assetTypeId
      ? getLocalEffectiveEnvironmentalLimits(database, {
          assetTypeId,
          unitId: context.unitId,
        })
      : null;

    return c.json({
      limits,
      source: limits ? "local" : null,
    });
  });

  app.get("/api/assets", (c) => {
    return c.json({
      ...listLocalAssets(database, {
        page: Number(c.req.query("page") ?? "1"),
        limit: Number(c.req.query("limit") ?? "20"),
        customerId: parseNumber(c.req.query("customerId")),
        assetTypeId: parseNumber(c.req.query("assetTypeId")),
        status: parseAssetStatus(c.req.query("status")),
        query: c.req.query("query") || undefined,
      }),
    });
  });

  app.post("/api/assets", async (c) => {
    const input = CreateAssetSchema.parse(await c.req.json());
    const context = getLocalRequestContext(config, database);

    try {
      const asset = createLocalAsset(database, {
        organizationId: context.organizationId,
        unitId: context.unitId,
        customerId: input.customerId,
        assetTypeId: input.assetTypeId,
        name: input.name,
        manufacturer: input.manufacturer,
        model: input.model,
        serialNumber: input.serialNumber,
        tag: input.tag,
        status: input.status,
        lastCalibrationDate: input.lastCalibrationDate,
        nextCalibrationDate: input.nextCalibrationDate,
        comments: input.comments,
        specifications: input.specifications,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json(asset, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/assets/:id", (c) => {
    const asset = getLocalAssetDetail(database, c.req.param("id"));

    if (!asset) {
      return c.json({ error: "Ativo local nao encontrado" }, 404);
    }

    return c.json(asset);
  });

  app.put("/api/assets/:id", async (c) => {
    const input = UpdateAssetSchema.parse(await c.req.json());
    const context = getLocalRequestContext(config, database);

    try {
      const asset = updateLocalAsset(database, {
        identifier: c.req.param("id"),
        name: input.name,
        manufacturer: input.manufacturer,
        model: input.model,
        serialNumber: input.serialNumber,
        tag: input.tag,
        status: input.status,
        lastCalibrationDate: input.lastCalibrationDate,
        nextCalibrationDate: input.nextCalibrationDate,
        comments: input.comments,
        specifications: input.specifications,
        actorUserId: context.userId,
        deviceId: config.deviceId,
      });

      return c.json(asset);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/assets/:id/audit-log", (c) => {
    return c.json({ data: [] });
  });

  app.get("/api/asset-types", (c) => {
    return c.json(listLocalAssetTypes(database));
  });

  app.get("/api/attachments", (c) => {
    return c.json(
      localAttachmentsResponseSchema.parse({
        data: listLocalAttachments(database, {
          entityType: c.req.query("entityType") || undefined,
          entityId: c.req.query("entityId") || undefined,
          limit: Number(c.req.query("limit") ?? "50"),
        }).data.map((attachment) => toAttachmentResponse(attachment, config)),
      }),
    );
  });

  app.post("/api/attachments", async (c) => {
    let localPath: string | null = null;
    let absolutePath: string | null = null;

    try {
      const body = await c.req.parseBody();
      const entityType = getFormString(body.entityType);
      const entityId = getFormString(body.entityId);
      const file = getFormFile(body.file);

      if (!entityType || !entityId || !file) {
        return c.json(
          { error: "Tipo, entidade e arquivo sao obrigatorios" },
          400,
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      localPath = buildLocalAttachmentPath({
        entityType,
        entityId,
        contentHash,
        fileName: file.name,
      });
      absolutePath = resolveLocalStoragePath(config.storageRoot, localPath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);

      const attachment = createLocalAttachment(database, {
        entityType,
        entityId,
        localPath,
        contentHash,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: bytes.byteLength,
        actorUserId: getLocalRequestContext(config, database).userId,
        deviceId: config.deviceId,
      });

      return c.json(
        localAttachmentSchema.parse(toAttachmentResponse(attachment, config)),
        201,
      );
    } catch (error) {
      if (absolutePath) {
        await rm(absolutePath, { force: true });
      }

      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.get("/api/attachments/:id", async (c) => {
    try {
      const attachment = getLocalAttachment(database, c.req.param("id"));
      if (!attachment) {
        return c.json({ error: "Anexo local nao encontrado" }, 404);
      }

      const absolutePath = resolveLocalStoragePath(
        config.storageRoot,
        attachment.localPath,
      );
      const bytes = await readFile(absolutePath);

      return new Response(bytes, {
        headers: {
          "Content-Type": attachment.mimeType,
          "Content-Disposition": `inline; filename="${toSafeFileName(
            path.basename(attachment.localPath),
          )}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  app.post("/api/local/sync/start", async (c) => {
    try {
      await syncRuntime.runInitialSync();
      return c.json({ ok: true, message: "Initial sync completed." });
    } catch (error) {
      return c.json(
        {
          ok: false,
          message:
            error instanceof Error ? error.message : "Initial sync failed.",
        },
        500,
      );
    }
  });

  app.post("/api/local/sync/pause", (c) => {
    return c.json({ ok: true, message: "Continuous sync is not running." });
  });

  app.post("/api/local/sync/retry", async (c) => {
    try {
      await syncRuntime.runInitialSync();
      return c.json({ ok: true, message: "Initial sync completed." });
    } catch (error) {
      return c.json(
        {
          ok: false,
          message:
            error instanceof Error ? error.message : "Initial sync failed.",
        },
        500,
      );
    }
  });

  return app;
}

export function createLocalServerFromEnv(
  env: Record<string, string | undefined>,
): LocalServerInstance {
  const config = readLocalServerConfig(env);
  return createLocalServerFromConfig(config);
}

export function createLocalServerFromConfig(
  config: LocalServerConfig,
): LocalServerInstance {
  const database = openLocalDatabase({ filePath: config.dbPath });

  return {
    app: createLocalServer(config, database),
    config,
    database,
  };
}

function parseJobStatus(status: string | undefined) {
  if (
    status === "DRAFT" ||
    status === "IN_PROGRESS" ||
    status === "REVIEW" ||
    status === "GENERATING_PDF" ||
    status === "APPROVED" ||
    status === "REJECTED" ||
    status === "CANCELED" ||
    status === "SUPERSEDED"
  ) {
    return status;
  }

  return undefined;
}

function parseAssetStatus(status: string | undefined) {
  if (
    status === "ACTIVE" ||
    status === "INACTIVE" ||
    status === "MAINTENANCE" ||
    status === "SCRAPPED"
  ) {
    return status;
  }

  return undefined;
}

function parseServiceOrderStatus(status: string | undefined) {
  if (
    status === "opened" ||
    status === "awaiting_tech_evaluation" ||
    status === "under_evaluation" ||
    status === "awaiting_quote_approval" ||
    status === "quote_approved" ||
    status === "quote_rejected" ||
    status === "repair_in_progress" ||
    status === "awaiting_calibration" ||
    status === "calibration_in_progress" ||
    status === "awaiting_final_review" ||
    status === "ready_for_pickup" ||
    status === "delivered" ||
    status === "closed" ||
    status === "canceled" ||
    status === "warranty_return"
  ) {
    return status;
  }

  return undefined;
}

function parseStandardStatus(status: string | undefined) {
  if (
    status === "ACTIVE" ||
    status === "INACTIVE" ||
    status === "OUT_OF_TOLERANCE" ||
    status === "SENT_FOR_CALIBRATION"
  ) {
    return status;
  }

  return undefined;
}

function parseConflictStatus(status: string | undefined) {
  if (status === "open" || status === "resolved" || status === "ignored") {
    return status;
  }

  return undefined;
}

function parseNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

async function readJsonOrEmpty(request: Request) {
  const raw = await request.text();
  return raw ? JSON.parse(raw) : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro local";
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  const record = recordFromUnknown(value);
  return Object.keys(record).length > 0 ? record : null;
}

function parseLocalJobCreateInput(value: unknown): LocalJobCreateInput {
  const input = recordFromUnknown(value);
  return {
    assetId: numberFromUnknown(input.assetId),
    serviceId: numberFromUnknown(input.serviceId),
    technicianId: nullableStringFromUnknown(input.technicianId),
    dueDate: nullableStringFromUnknown(input.dueDate),
  };
}

function parseLocalJobExecutionInput(value: unknown): LocalJobExecutionInput {
  const input = recordFromUnknown(value);
  return {
    data: recordFromUnknown(input.data),
    results: recordOrNull(input.results),
    selectedStandardIds: numberArrayFromUnknown(input.selectedStandardIds),
    environment: environmentFromUnknown(input.environment),
    calibrationLocation: calibrationLocationFromUnknown(
      input.calibrationLocation,
    ),
    calibrationPhases: calibrationPhasesFromUnknown(input.calibrationPhases),
  };
}

function calibrationLocationFromUnknown(
  value: unknown,
): CalibrationLocationInput | undefined {
  const input = recordFromUnknown(value);
  if (
    input.type !== "customer_site" &&
    input.type !== "lab" &&
    input.type !== "other"
  ) {
    return undefined;
  }

  const addressText =
    typeof input.addressText === "string" ? input.addressText : "";
  return {
    type: input.type,
    addressText,
    notes: nullableStringFromUnknown(input.notes),
  };
}

function calibrationPhasesFromUnknown(
  value: unknown,
): CalibrationPhaseInput | undefined {
  const input = recordFromUnknown(value);
  const blocks = recordFromUnknown(input.blocks);
  if (Object.keys(blocks).length === 0) {
    return undefined;
  }

  const parsedBlocks: CalibrationPhaseInput["blocks"] = {};
  for (const [key, block] of Object.entries(blocks)) {
    const blockRecord = recordFromUnknown(block);
    if (!isCalibrationPhaseMode(blockRecord.mode)) {
      continue;
    }

    parsedBlocks[key] = {
      mode: blockRecord.mode,
      reason: nullableStringFromUnknown(blockRecord.reason),
    };
  }

  return { blocks: parsedBlocks };
}

function environmentFromUnknown(
  value: unknown,
): LocalJobExecutionInput["environment"] {
  const input = recordFromUnknown(value);
  if (Object.keys(input).length === 0) {
    return undefined;
  }

  return {
    temperature: nullableNumberFromUnknown(input.temperature),
    humidity: nullableNumberFromUnknown(input.humidity),
    pressure: nullableNumberFromUnknown(input.pressure),
  };
}

function numberArrayFromUnknown(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item))
    : undefined;
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nullableNumberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableStringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getLocalRequestContext(
  config: LocalServerConfig,
  database: LocalDatabase,
) {
  const snapshot = tenantSnapshotFromUnknown(
    database
      .prepare(
        `
SELECT organization_id, active_unit_id, user_id
FROM tenant_snapshot
ORDER BY pulled_at DESC
LIMIT 1
`,
      )
      .get(),
  );

  return {
    organizationId: config.organizationId ?? snapshot?.organization_id ?? null,
    unitId: config.unitId ?? snapshot?.active_unit_id ?? null,
    userId: config.userId ?? snapshot?.user_id ?? null,
  };
}

function tenantSnapshotFromUnknown(value: unknown) {
  const snapshot = recordFromUnknown(value);
  const organizationId = snapshot.organization_id;
  const activeUnitId = snapshot.active_unit_id;
  const userId = snapshot.user_id;

  if (typeof organizationId !== "string" || typeof userId !== "string") {
    return undefined;
  }

  return {
    organization_id: organizationId,
    active_unit_id:
      typeof activeUnitId === "number" && Number.isFinite(activeUnitId)
        ? activeUnitId
        : null,
    user_id: userId,
  };
}

function getDiagnostics(error: unknown) {
  if (error && typeof error === "object" && "diagnostics" in error) {
    return Reflect.get(error, "diagnostics");
  }

  return undefined;
}

function getFormString(
  value: FormDataEntryValue | FormDataEntryValue[] | undefined,
) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return getFormString(value[0]);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getFormFile(
  value: FormDataEntryValue | FormDataEntryValue[] | undefined,
) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return getFormFile(value[0]);
  return value instanceof File && value.size > 0 ? value : null;
}

function buildLocalAttachmentPath(input: {
  entityType: string;
  entityId: string;
  contentHash: string;
  fileName: string;
}) {
  const extension = path.extname(input.fileName).slice(0, 12);
  const suffix =
    extension && /^[a-zA-Z0-9.]+$/.test(extension) ? extension : "";

  return [
    "attachments",
    toSafePathSegment(input.entityType),
    toSafePathSegment(input.entityId),
    `${input.contentHash.slice(0, 16)}-${randomUUID()}${suffix}`,
  ].join("/");
}

function resolveLocalStoragePath(storageRoot: string, localPath: string) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, localPath);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Caminho de arquivo local invalido");
  }

  return target;
}

function toAttachmentResponse(
  attachment: ReturnType<typeof createLocalAttachment>,
  _config: LocalServerConfig,
) {
  return {
    ...attachment,
    fileUrl: `/api/attachments/${encodeURIComponent(attachment.id)}`,
  };
}

function toSafePathSegment(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local"
  );
}

function toSafeFileName(value: string) {
  return (
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "arquivo"
  );
}
