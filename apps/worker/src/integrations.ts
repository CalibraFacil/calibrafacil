import { Client } from "pg";
import { decryptPassword } from "@calibra-facil/signing";
import {
    applyIntegrationMappings,
    formatIntegrationCustomerAddress,
    normalizeGenericFinancialErpConfig,
    validateIntegrationMappings,
} from "@calibra-facil/shared";
import type {
    IntegrationMappingValidationIssue,
    GenericFinancialErpConnectionConfig,
    IntegrationDependencyWarning,
    IntegrationBillingDocumentPayload,
    IntegrationCustomerPayload,
    IntegrationScheduleFrequency,
    IntegrationServiceOrderPayload,
    IntegrationSyncStatus,
    IntegrationSyncTarget,
    IntegrationSyncTrigger,
    IntegrationTargetCoverageSummary,
    IntegrationTargetScheduleConfig,
} from "@calibra-facil/shared";

export interface IntegrationSyncQueueMessage {
    type: "INTEGRATION_SYNC";
    integrationId: string;
    organizationId: string;
    runId: string;
    target: IntegrationSyncTarget;
    limit: number;
    trigger: IntegrationSyncTrigger;
}

interface IntegrationWorkerEnv {
    HYPERDRIVE: Hyperdrive;
    INTEGRATIONS_MASTER_KEY?: string;
}

type SyncPayload =
    | IntegrationCustomerPayload
    | IntegrationServiceOrderPayload
    | IntegrationBillingDocumentPayload;

const INTEGRATION_TARGETS = [
    "customer",
    "service_order",
    "billing_document",
] as const satisfies readonly IntegrationSyncTarget[];

const DEFAULT_SYNC_LIMIT = 50;

function toIso(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    return null;
}

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculateNextScheduledRunAt(
    frequency: IntegrationScheduleFrequency,
    from: Date
): string {
    const next = new Date(from);
    next.setMilliseconds(0);

    if (frequency === "weekly") {
        next.setDate(next.getDate() + 7);
    } else {
        next.setDate(next.getDate() + 1);
    }

    return next.toISOString();
}

function getTargetSchedule(
    config: GenericFinancialErpConnectionConfig,
    target: IntegrationSyncTarget
): IntegrationTargetScheduleConfig {
    return config.schedules[target];
}

function getMappingValidationIssues(
    config: GenericFinancialErpConnectionConfig,
    target?: IntegrationSyncTarget
): IntegrationMappingValidationIssue[] {
    const issues = validateIntegrationMappings(config.mappings);
    if (!target) return issues;
    return issues.filter((issue) => issue.target === target);
}

function assertValidMappings(
    config: GenericFinancialErpConnectionConfig,
    target?: IntegrationSyncTarget
) {
    const issues = getMappingValidationIssues(config, target);
    if (issues.length === 0) return;
    throw new Error(issues.map((issue) => issue.message).join(" "));
}

function buildMappedTargetPayload(
    config: GenericFinancialErpConnectionConfig,
    target: IntegrationSyncTarget,
    payload: SyncPayload
) {
    return applyIntegrationMappings(
        target,
        payload as unknown as Record<string, unknown>,
        config.mappings[target]
    );
}

async function withDbClient<T>(
    env: IntegrationWorkerEnv,
    operation: (client: Client) => Promise<T>
): Promise<T> {
    const client = new Client({
        connectionString: env.HYPERDRIVE.connectionString,
    });
    await client.connect();
    try {
        return await operation(client);
    } finally {
        await client.end();
    }
}

async function insertEvent(client: Client, params: {
    integrationId: string;
    organizationId: string;
    runId?: string | null;
    level: "info" | "warning" | "error";
    event: string;
    message: string;
    details?: Record<string, unknown> | null;
}) {
    await client.query(
        `
        INSERT INTO integration_event_log
          (integration_id, organization_id, run_id, level, event, message, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `,
        [
            params.integrationId,
            params.organizationId,
            params.runId ?? null,
            params.level,
            params.event,
            params.message,
            params.details ? JSON.stringify(params.details) : null,
        ]
    );
}

async function updateRun(client: Client, params: {
    runId: string;
    status: IntegrationSyncStatus;
    processedCount?: number;
    successCount?: number;
    errorCount?: number;
    errorSummary?: string | null;
    summary?: Record<string, unknown> | null;
    startedAt?: Date;
    finishedAt?: Date;
}) {
    await client.query(
        `
        UPDATE integration_sync_run
        SET
          status = $2,
          processed_count = COALESCE($3, processed_count),
          success_count = COALESCE($4, success_count),
          error_count = COALESCE($5, error_count),
          error_summary = COALESCE($6, error_summary),
          summary = COALESCE($7::jsonb, summary),
          started_at = COALESCE($8, started_at),
          finished_at = COALESCE($9, finished_at),
          updated_at = NOW()
        WHERE id = $1
        `,
        [
            params.runId,
            params.status,
            params.processedCount ?? null,
            params.successCount ?? null,
            params.errorCount ?? null,
            params.errorSummary ?? null,
            params.summary ? JSON.stringify(params.summary) : null,
            params.startedAt ?? null,
            params.finishedAt ?? null,
        ]
    );
}

async function updateIntegrationConfig(
    client: Client,
    params: {
        integrationId: string;
        config: GenericFinancialErpConnectionConfig;
    }
) {
    await client.query(
        `
        UPDATE integration_connection
        SET config = $2::jsonb,
            updated_at = NOW()
        WHERE integration_id = $1
        `,
        [params.integrationId, JSON.stringify(params.config)]
    );
}

async function fetchRuntime(
    client: Client,
    integrationId: string,
    organizationId: string
): Promise<{
    config: GenericFinancialErpConnectionConfig;
    encryptedSecret: string;
    secretIv: string;
    status: "ACTIVE" | "DISABLED";
    lastValidatedAt: string | null;
    lastValidationError: string | null;
} | null> {
    const result = await client.query(
        `
        SELECT
          ic.config,
          ic.encrypted_secret,
          ic.secret_iv,
          oi.status,
          oi.last_validated_at,
          oi.last_validation_error
        FROM organization_integration oi
        INNER JOIN integration_connection ic ON ic.integration_id = oi.id
        WHERE oi.id = $1
          AND oi.organization_id = $2
        LIMIT 1
        `,
        [integrationId, organizationId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
        config: normalizeGenericFinancialErpConfig(row.config),
        encryptedSecret: row.encrypted_secret,
        secretIv: row.secret_iv,
        status: row.status,
        lastValidatedAt: toIso(row.last_validated_at),
        lastValidationError: row.last_validation_error ?? null,
    };
}

async function loadPayloads(
    client: Client,
    organizationId: string,
    target: IntegrationSyncTarget,
    limit: number
): Promise<SyncPayload[]> {
    if (target === "customer") {
        const result = await client.query(
            `
            SELECT id, name, tax_id, email, phone, address, created_at, updated_at
            FROM customer
            WHERE lab_organization_id = $1
            ORDER BY updated_at DESC
            LIMIT $2
            `,
            [organizationId, limit]
        );

        return result.rows.map((row) => ({
            externalId: `customer:${row.id}`,
            organizationId,
            name: row.name,
            taxId: row.tax_id,
            email: row.email,
            phone: row.phone,
            address: formatIntegrationCustomerAddress(row.address),
            createdAt: toIso(row.created_at),
            updatedAt: toIso(row.updated_at),
        }));
    }

    if (target === "service_order") {
        const result = await client.query(
            `
            SELECT
              cj.id,
              cj.job_id,
              cj.status,
              cj.unit_id,
              ou.name AS unit_name,
              c.id AS customer_id,
              c.name AS customer_name,
              a.name AS asset_name,
              a.tag AS asset_tag,
              s.name AS service_name,
              s.price AS service_price,
              s.currency AS service_currency,
              cj.performed_at,
              cj.approved_at,
              cj.updated_at
            FROM calibration_job cj
            LEFT JOIN customer c ON cj.customer_id = c.id
            LEFT JOIN asset a ON cj.asset_id = a.id
            LEFT JOIN service s ON cj.service_id = s.id
            LEFT JOIN organization_unit ou ON cj.unit_id = ou.id
            WHERE cj.organization_id = $1
              AND cj.status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'SUPERSEDED')
            ORDER BY cj.updated_at DESC
            LIMIT $2
            `,
            [organizationId, limit]
        );

        return result.rows.map((row) => ({
            externalId: `service_order:${row.id}`,
            organizationId,
            unitId: row.unit_id,
            unitName: row.unit_name ?? null,
            jobId: row.job_id,
            status: row.status,
            customerExternalId: row.customer_id ? `customer:${row.customer_id}` : null,
            customerName: row.customer_name ?? null,
            assetName: row.asset_name ?? null,
            assetTag: row.asset_tag ?? null,
            serviceName: row.service_name ?? null,
            servicePriceCents: row.service_price ?? null,
            currency: row.service_currency ?? null,
            performedAt: toIso(row.performed_at),
            approvedAt: toIso(row.approved_at),
            updatedAt: toIso(row.updated_at),
        }));
    }

    const result = await client.query(
        `
        SELECT
          cj.id,
          cj.job_id,
          cj.unit_id,
          ou.name AS unit_name,
          c.id AS customer_id,
          c.name AS customer_name,
          s.name AS service_name,
          s.price AS amount,
          s.currency,
          cj.approved_at,
          cj.due_date
        FROM calibration_job cj
        LEFT JOIN customer c ON cj.customer_id = c.id
        LEFT JOIN service s ON cj.service_id = s.id
        LEFT JOIN organization_unit ou ON cj.unit_id = ou.id
        WHERE cj.organization_id = $1
          AND cj.status IN ('APPROVED', 'SUPERSEDED')
          AND s.price IS NOT NULL
          AND s.price > 0
        ORDER BY cj.approved_at DESC
        LIMIT $2
        `,
        [organizationId, limit]
    );

    return result.rows.map((row) => ({
        externalId: `billing_document:${row.id}`,
        organizationId,
        unitId: row.unit_id,
        unitName: row.unit_name ?? null,
        jobId: row.job_id,
        customerExternalId: row.customer_id ? `customer:${row.customer_id}` : null,
        customerName: row.customer_name ?? null,
        serviceName: row.service_name ?? null,
        amountCents: row.amount,
        currency: row.currency ?? "BRL",
        issuedAt: toIso(row.approved_at),
        dueAt: toIso(row.due_date),
        status: "ready",
    }));
}

async function countLocalTargetRecords(
    client: Client,
    organizationId: string,
    target: IntegrationSyncTarget
): Promise<number> {
    if (target === "customer") {
        const result = await client.query(
            `SELECT COUNT(*)::int AS total FROM customer WHERE lab_organization_id = $1`,
            [organizationId]
        );
        return Number(result.rows[0]?.total ?? 0);
    }

    if (target === "service_order") {
        const result = await client.query(
            `
            SELECT COUNT(*)::int AS total
            FROM calibration_job
            WHERE organization_id = $1
              AND status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'SUPERSEDED')
            `,
            [organizationId]
        );
        return Number(result.rows[0]?.total ?? 0);
    }

    const result = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM calibration_job cj
        LEFT JOIN service s ON cj.service_id = s.id
        WHERE cj.organization_id = $1
          AND cj.status IN ('APPROVED', 'SUPERSEDED')
          AND s.price IS NOT NULL
          AND s.price > 0
        `,
        [organizationId]
    );

    return Number(result.rows[0]?.total ?? 0);
}

async function countLinkedTargetRecords(
    client: Client,
    integrationId: string,
    target: IntegrationSyncTarget
): Promise<number> {
    const result = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM integration_object_link
        WHERE integration_id = $1
          AND target = $2
        `,
        [integrationId, target]
    );

    return Number(result.rows[0]?.total ?? 0);
}

function buildDependencyWarnings(params: {
    target: IntegrationSyncTarget;
    validated: boolean;
    integrationStatus: "ACTIVE" | "DISABLED";
    coverageByTarget: Record<IntegrationSyncTarget, IntegrationTargetCoverageSummary>;
}): IntegrationDependencyWarning[] {
    const warnings: IntegrationDependencyWarning[] = [];

    if (params.integrationStatus !== "ACTIVE") {
        warnings.push({
            code: "INTEGRATION_DISABLED",
            target: params.target,
            severity: "error",
            message: "Ative a integração antes de sincronizar este alvo.",
        });
    }

    if (!params.validated) {
        warnings.push({
            code: "VALIDATION_REQUIRED",
            target: params.target,
            severity: "error",
            message: "Valide a conexão antes de executar sincronizações.",
        });
    }

    if (params.target === "service_order") {
        const customerCoverage = params.coverageByTarget.customer;
        if (customerCoverage.localCount > customerCoverage.linkedCount) {
            warnings.push({
                code: "CUSTOMERS_NOT_SYNCED",
                target: params.target,
                severity: "error",
                message:
                    "Existem clientes locais sem vínculo remoto. Sincronize clientes antes das ordens de serviço.",
            });
        }
    }

    if (params.target === "billing_document") {
        const customerCoverage = params.coverageByTarget.customer;
        const serviceOrderCoverage = params.coverageByTarget.service_order;

        if (customerCoverage.localCount > customerCoverage.linkedCount) {
            warnings.push({
                code: "CUSTOMERS_NOT_SYNCED",
                target: params.target,
                severity: "error",
                message:
                    "Existem clientes locais sem vínculo remoto. Sincronize clientes antes do faturamento.",
            });
        }

        if (serviceOrderCoverage.localCount > serviceOrderCoverage.linkedCount) {
            warnings.push({
                code: "SERVICE_ORDERS_NOT_SYNCED",
                target: params.target,
                severity: "error",
                message:
                    "Existem ordens de serviço sem vínculo remoto. Sincronize ordens antes do faturamento.",
            });
        }
    }

    return warnings;
}

function buildRunSummary(params: {
    target: IntegrationSyncTarget;
    requestedLimit?: number;
    processedCount?: number;
    successCount?: number;
    errorCount?: number;
    blocked?: boolean;
    retryOfRunId?: string | null;
}) {
    return {
        target: params.target,
        requestedLimit: params.requestedLimit ?? DEFAULT_SYNC_LIMIT,
        processedCount: params.processedCount ?? 0,
        successCount: params.successCount ?? 0,
        errorCount: params.errorCount ?? 0,
        blocked: params.blocked ?? false,
        retryOfRunId: params.retryOfRunId ?? null,
    };
}

function getTargetPath(config: GenericFinancialErpConnectionConfig, target: IntegrationSyncTarget) {
    if (target === "customer") return config.customerPath;
    if (target === "service_order") return config.serviceOrderPath;
    return config.billingDocumentPath;
}

async function getExistingRemoteId(
    client: Client,
    integrationId: string,
    target: IntegrationSyncTarget,
    localEntityId: string
): Promise<string | null> {
    const result = await client.query(
        `
        SELECT remote_entity_id
        FROM integration_object_link
        WHERE integration_id = $1
          AND target = $2
          AND local_entity_id = $3
        LIMIT 1
        `,
        [integrationId, target, localEntityId]
    );

    return result.rows[0]?.remote_entity_id ?? null;
}

async function upsertLink(
    client: Client,
    params: {
        integrationId: string;
        organizationId: string;
        target: IntegrationSyncTarget;
        localEntityId: string;
        remoteEntityId: string | null;
    }
) {
    await client.query(
        `
        INSERT INTO integration_object_link
          (id, integration_id, organization_id, target, local_entity_id, remote_entity_id, remote_display_id, last_synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6, NOW())
        ON CONFLICT (integration_id, target, local_entity_id)
        DO UPDATE
          SET remote_entity_id = EXCLUDED.remote_entity_id,
              remote_display_id = EXCLUDED.remote_display_id,
              last_synced_at = NOW(),
              updated_at = NOW()
        `,
        [
            crypto.randomUUID(),
            params.integrationId,
            params.organizationId,
            params.target,
            params.localEntityId,
            params.remoteEntityId,
        ]
    );
}

function buildHeaders(secret: string) {
    return {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
    };
}

async function callRemoteJson(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => null);

    return {
        ok: response.ok,
        status: response.status,
        data,
    };
}

function extractRemoteId(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    if (typeof record.remoteId === "string" && record.remoteId.trim()) {
        return record.remoteId;
    }
    if (typeof record.id === "string" && record.id.trim()) {
        return record.id;
    }
    if (typeof record.id === "number") {
        return String(record.id);
    }
    return null;
}

async function pushRecord(
    client: Client,
    params: {
        integrationId: string;
        organizationId: string;
        target: IntegrationSyncTarget;
        config: GenericFinancialErpConnectionConfig;
        secret: string;
        payload: SyncPayload;
    }
) {
    const { mappedPayload, issues } = buildMappedTargetPayload(
        params.config,
        params.target,
        params.payload
    );

    if (issues.length > 0) {
        throw new Error(`Payload inválido para ${params.target}: ${issues.join(" ")}`);
    }

    const existingRemoteId = await getExistingRemoteId(
        client,
        params.integrationId,
        params.target,
        params.payload.externalId
    );
    const targetPath = getTargetPath(params.config, params.target);
    const method = existingRemoteId ? "PUT" : "POST";
    const url = existingRemoteId
        ? `${params.config.baseUrl}${targetPath}/${encodeURIComponent(existingRemoteId)}`
        : `${params.config.baseUrl}${targetPath}`;

    const result = await callRemoteJson(url, {
        method,
        headers: buildHeaders(params.secret),
        body: JSON.stringify(mappedPayload),
    });

    if (!result.ok) {
        throw new Error(`Remoto respondeu ${result.status}`);
    }

    const remoteId = extractRemoteId(result.data) ?? existingRemoteId;

    await upsertLink(client, {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        target: params.target,
        localEntityId: params.payload.externalId,
        remoteEntityId: remoteId,
    });
}

async function createSyncRun(
    client: Client,
    params: {
        integrationId: string;
        organizationId: string;
        target: IntegrationSyncTarget;
        trigger: IntegrationSyncTrigger;
        requestedLimit: number;
    }
): Promise<string> {
    const id = crypto.randomUUID();
    await client.query(
        `
        INSERT INTO integration_sync_run
          (id, integration_id, organization_id, trigger, target, status, summary)
        VALUES ($1, $2, $3, $4, $5, 'PENDING', $6::jsonb)
        `,
        [
            id,
            params.integrationId,
            params.organizationId,
            params.trigger,
            params.target,
            JSON.stringify(
                buildRunSummary({
                    target: params.target,
                    requestedLimit: params.requestedLimit,
                })
            ),
        ]
    );

    return id;
}

async function hasActiveTargetRun(
    client: Client,
    params: {
        integrationId: string;
        organizationId: string;
        target: IntegrationSyncTarget;
    }
): Promise<boolean> {
    const result = await client.query(
        `
        SELECT 1
        FROM integration_sync_run
        WHERE integration_id = $1
          AND organization_id = $2
          AND target = $3
          AND status IN ('PENDING', 'RUNNING')
        LIMIT 1
        `,
        [params.integrationId, params.organizationId, params.target]
    );

    return result.rows.length > 0;
}

type DueScheduledRun = {
    integrationId: string;
    organizationId: string;
    target: IntegrationSyncTarget;
    limit: number;
    trigger: "scheduled";
};

export async function processScheduledIntegrationSyncs(
    env: IntegrationWorkerEnv
): Promise<{ scheduledRuns: number }> {
    return withDbClient(env, async (client) => {
        const integrations = await client.query(
            `
            SELECT
              oi.id,
              oi.organization_id,
              ic.config
            FROM organization_integration oi
            INNER JOIN integration_connection ic ON ic.integration_id = oi.id
            WHERE oi.status = 'ACTIVE'
            `
        );

        const now = new Date();
        const dueRuns: DueScheduledRun[] = [];

        for (const row of integrations.rows) {
            const config = normalizeGenericFinancialErpConfig(row.config);

            for (const target of INTEGRATION_TARGETS) {
                const schedule = getTargetSchedule(config, target);
                const nextRun = parseDate(schedule.nextScheduledRunAt);

                if (schedule.mode !== "scheduled" || !nextRun) {
                    continue;
                }

                if (nextRun.getTime() > now.getTime()) {
                    continue;
                }

                const active = await hasActiveTargetRun(client, {
                    integrationId: row.id,
                    organizationId: row.organization_id,
                    target,
                });

                if (active) {
                    continue;
                }

                dueRuns.push({
                    integrationId: row.id,
                    organizationId: row.organization_id,
                    target,
                    limit: DEFAULT_SYNC_LIMIT,
                    trigger: "scheduled",
                });
            }
        }

        for (const dueRun of dueRuns) {
            const runtime = await fetchRuntime(
                client,
                dueRun.integrationId,
                dueRun.organizationId
            );

            if (!runtime) {
                continue;
            }

            const advancedConfig = normalizeGenericFinancialErpConfig({
                ...runtime.config,
                schedules: {
                    ...runtime.config.schedules,
                    [dueRun.target]: {
                        ...runtime.config.schedules[dueRun.target],
                        lastScheduledRunAt: now.toISOString(),
                        nextScheduledRunAt: calculateNextScheduledRunAt(
                            runtime.config.schedules[dueRun.target].frequency,
                            now
                        ),
                    },
                },
            });

            await updateIntegrationConfig(client, {
                integrationId: dueRun.integrationId,
                config: advancedConfig,
            });

            const runId = await createSyncRun(client, {
                integrationId: dueRun.integrationId,
                organizationId: dueRun.organizationId,
                target: dueRun.target,
                trigger: "scheduled",
                requestedLimit: dueRun.limit,
            });

            try {
                await processIntegrationSync(env, {
                    type: "INTEGRATION_SYNC",
                    integrationId: dueRun.integrationId,
                    organizationId: dueRun.organizationId,
                    runId,
                    target: dueRun.target,
                    limit: dueRun.limit,
                    trigger: dueRun.trigger,
                });
            } catch (error) {
                console.error("[IntegrationScheduler] Failed scheduled run", {
                    integrationId: dueRun.integrationId,
                    organizationId: dueRun.organizationId,
                    target: dueRun.target,
                    runId,
                    error,
                });
            }
        }

        return { scheduledRuns: dueRuns.length };
    });
}

export async function processIntegrationSync(
    env: IntegrationWorkerEnv,
    message: IntegrationSyncQueueMessage
): Promise<void> {
    await withDbClient(env, async (client) => {
        await updateRun(client, {
            runId: message.runId,
            status: "RUNNING",
            startedAt: new Date(),
        });

        try {
            const runtime = await fetchRuntime(
                client,
                message.integrationId,
                message.organizationId
            );

            if (!runtime) {
                throw new Error("Integração não encontrada");
            }
            if (!env.INTEGRATIONS_MASTER_KEY) {
                throw new Error("INTEGRATIONS_MASTER_KEY não configurada");
            }

            const validated =
                Boolean(runtime.lastValidatedAt) && !runtime.lastValidationError;
            const coverageByTarget = Object.fromEntries(
                await Promise.all(
                    INTEGRATION_TARGETS.map(async (target) => {
                        const [localCount, linkedCount] = await Promise.all([
                            countLocalTargetRecords(client, message.organizationId, target),
                            countLinkedTargetRecords(client, message.integrationId, target),
                        ]);

                        return [
                            target,
                            {
                                target,
                                localCount,
                                linkedCount,
                                unlinkedCount: Math.max(localCount - linkedCount, 0),
                            } satisfies IntegrationTargetCoverageSummary,
                        ] as const;
                    })
                )
            ) as Record<IntegrationSyncTarget, IntegrationTargetCoverageSummary>;
            const blockingWarnings = buildDependencyWarnings({
                target: message.target,
                validated,
                integrationStatus: runtime.status,
                coverageByTarget,
            }).filter((warning) => warning.severity === "error");

            if (blockingWarnings.length > 0) {
                const blockedMessage = blockingWarnings[0]?.message ?? "Sincronização bloqueada";

                await updateRun(client, {
                    runId: message.runId,
                    status: "FAILED",
                    errorSummary: blockedMessage,
                    summary: buildRunSummary({
                        target: message.target,
                        requestedLimit: message.limit,
                        blocked: true,
                    }),
                    finishedAt: new Date(),
                });

                await insertEvent(client, {
                    integrationId: message.integrationId,
                    organizationId: message.organizationId,
                    runId: message.runId,
                    level: "warning",
                    event: "sync.blocked",
                    message: blockedMessage,
                    details: {
                        target: message.target,
                        warnings: blockingWarnings,
                        trigger: message.trigger,
                    },
                });

                return;
            }

            assertValidMappings(runtime.config, message.target);

            const secret = decryptPassword(
                runtime.encryptedSecret,
                runtime.secretIv,
                env.INTEGRATIONS_MASTER_KEY
            );

            const payloads = await loadPayloads(
                client,
                message.organizationId,
                message.target,
                message.limit
            );

            let successCount = 0;
            let errorCount = 0;
            let errorSummary: string | null = null;

            for (const payload of payloads) {
                try {
                    await pushRecord(client, {
                        integrationId: message.integrationId,
                        organizationId: message.organizationId,
                        target: message.target,
                        config: runtime.config,
                        secret,
                        payload,
                    });
                    successCount += 1;
                } catch (error) {
                    errorCount += 1;
                    errorSummary =
                        error instanceof Error ? error.message : "Falha desconhecida";

                    await insertEvent(client, {
                        integrationId: message.integrationId,
                        organizationId: message.organizationId,
                        runId: message.runId,
                        level: "error",
                        event: "sync.record_failed",
                        message: errorSummary,
                        details: {
                            target: message.target,
                            localEntityId: payload.externalId,
                        },
                    });
                }
            }

            const processedCount = payloads.length;
            const status: IntegrationSyncStatus =
                errorCount === 0
                    ? "COMPLETED"
                    : successCount === 0
                      ? "FAILED"
                      : "PARTIAL";

            await updateRun(client, {
                runId: message.runId,
                status,
                processedCount,
                successCount,
                errorCount,
                errorSummary,
                summary: buildRunSummary({
                    target: message.target,
                    requestedLimit: message.limit,
                    processedCount,
                    successCount,
                    errorCount,
                }),
                finishedAt: new Date(),
            });

            await insertEvent(client, {
                integrationId: message.integrationId,
                organizationId: message.organizationId,
                runId: message.runId,
                level: status === "COMPLETED" ? "info" : "warning",
                event: "sync.completed",
                message:
                    status === "COMPLETED"
                        ? "Sincronização concluída"
                        : "Sincronização concluída com ressalvas",
                details: {
                    target: message.target,
                    processedCount,
                    successCount,
                    errorCount,
                },
            });
        } catch (error) {
            const messageText =
                error instanceof Error ? error.message : "Falha ao processar integração";

            await updateRun(client, {
                runId: message.runId,
                status: "FAILED",
                errorSummary: messageText,
                summary: buildRunSummary({
                    target: message.target,
                    requestedLimit: message.limit,
                }),
                finishedAt: new Date(),
            });

            await insertEvent(client, {
                integrationId: message.integrationId,
                organizationId: message.organizationId,
                runId: message.runId,
                level: "error",
                event: "sync.failed",
                message: messageText,
                details: {
                    target: message.target,
                },
            });

            throw error;
        }
    });
}
