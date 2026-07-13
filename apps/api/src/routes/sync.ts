import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import {
  syncBootstrapResponseSchema,
  syncAckRequestSchema,
  syncAckResponseSchema,
  syncAttachmentCompleteUploadRequestSchema,
  syncAttachmentCompleteUploadResponseSchema,
  syncAttachmentDownloadResponseSchema,
  syncAttachmentInitUploadRequestSchema,
  syncAttachmentInitUploadResponseSchema,
  syncConflictResolutionRequestSchema,
  syncConflictResolutionResponseSchema,
  type SyncEvent,
  syncPullResponseSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  type AssetSnapshot,
  type CalibrationPhaseSnapshot,
  type CalibrationLocationSnapshot,
  calibrationJob,
  calibrationMethod,
  customer,
  customerAuditLog,
  environmentalLimits,
  type EnvironmentalSnapshot,
  jobAuditLog,
  member,
  organizationEventLog,
  massCompositionProfile,
  referenceStandard,
  referenceStandardCertificateDocument,
  service,
  serviceOrder,
  serviceOrderDeliveryDocument,
  serviceOrderExecution,
  serviceOrderQuote,
  type MethodSnapshot,
  type StandardSnapshot,
  type ReferenceStandardCertificateDocumentSnapshot,
} from "@calibra-facil/db/schema";
import {
  executeCompiledMethod,
  type CalculationEngineLike,
  type CompiledMethod,
  type MethodDiagnostic,
} from "@calibra-facil/method-definition";
import { createCalculationEngine } from "@calibra-facil/math-engine";
import { normalizeStandardsForOfficialExecution } from "@calibra-facil/shared";
import { desktopCertificatePdfKey } from "@calibra-facil/shared/storage-keys";
import {
  buildDesktopSyncConflictId,
  buildSyncPushCursor,
} from "@calibra-facil/contracts";
import {
  CreateAssetSchema,
  CreateCustomerSchema,
  CreateNonConformanceSchema,
  CreateServiceOrderQuoteSchema,
  CreateServiceOrderSchema,
  IssueServiceOrderDeliveryDocumentSchema,
  RegulatedIntervalSchema,
  StandardSnapshotSchema,
  UpdateComplianceSchema,
  UpdateCustomerSchema,
  UpdateServiceOrderExecutionSchema,
} from "@calibra-facil/schemas";
import { and, desc, eq, gt, inArray, isNull, like, not } from "drizzle-orm";
import { writeOrganizationAuditEvent } from "../lib/audit";
import {
  createR2Client,
  generatePresignedUploadUrl,
  generatePresignedUrl,
  uploadToR2,
  type R2Env,
} from "../lib/storage";
import {
  type AuthVariables,
  type MemberData,
  withLabPermission,
} from "../middleware/permission";
import { buildUnitScopeCondition } from "../lib/units";
import { resolveAssetRegimeWrite } from "../lib/asset-regime";
import { deriveRegulatedNextDate } from "../lib/regulated-interval";
import { deriveNextCalibrationDate } from "../lib/portal-asset-interval";
import { buildAsFoundReliabilityVerdict } from "../lib/as-found-reliability-verdict";
import { advanceAssetCalibrationDatesOnApproval } from "../lib/asset-calibration-advance";
import {
  asRecord,
  buildSyncAttachmentObjectKey,
  encodeSyncAttachmentId,
  formNumber,
  formString,
  getNullableString,
  getNumber,
  getRecordOrNull,
  isIntegerNumber,
  isPositiveInteger,
  parseSnapshotDate,
  parseSyncPullCursor,
  parseSyncPullLimit,
  toSyncTimestamp,
  tryDecodeSyncAttachmentId,
} from "../modules/sync/helpers";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import { createNonConformanceRecord } from "../lib/non-conformances";
import { ensureOotNotificationForNc } from "../lib/oot-notifications";
import { syncJobStandardLinks } from "../lib/job-standards";
import {
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "../lib/asset-measurement";
import {
  getEffectiveCertificateTemplateSnapshot,
  serializeCertificateTemplateSnapshot,
} from "../lib/certificate-template-snapshots";
import {
  createInitialServiceOrderRecords,
  recordServiceOrderEvent,
  replaceExecutionItems,
  replaceQuoteItems,
} from "../lib/service-order-workflow";
import { createClientOrganizationAsServiceOwner } from "../lib/portal-service-account";
import {
  loadCustomerActiveCommercialAgreement,
  syncComplianceWithActiveAgreement,
} from "../lib/finance";

const METHOD_ENGINE_OPTIONS = {
  numericMode: "decimal" as const,
  rejectUnusedInputs: true,
  maxExponentMagnitude: 12,
  maxSignificantDigits: 24,
};
const MAX_DESKTOP_CERTIFICATE_PDF_BYTES = 25 * 1024 * 1024;
const CERTIFICATE_PUBLIC_BASE_URL = "https://certificates.calibrafacil.com";
const SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS = 900;

// ============================================================================
// Desktop payload tolerance
// ============================================================================
// Desktop outbox payloads are built by merging the FULL local SQLite row
// (packages/local-db), so optional fields arrive as explicit `null`, never as
// an absent key. The shared schemas declare those fields `.optional()`
// (absent-only) for the web/local-server boundary, which rejected every real
// desktop event here ("expected string, received null") — the push path only
// ever passed with hand-crafted null-free payloads. These variants accept
// `null` exactly where the local row can produce it; the apply handlers below
// already normalize null (`|| null`, `?? null`, `parseSyncDate`).
// Exported for spec coverage (sync.spec.ts) — not part of the route surface.
export const DesktopCreateAssetSchema = CreateAssetSchema.extend({
  manufacturer: CreateAssetSchema.shape.manufacturer.nullable(),
  model: CreateAssetSchema.shape.model.nullable(),
  comments: CreateAssetSchema.shape.comments.nullable(),
  lastCalibrationDate: CreateAssetSchema.shape.lastCalibrationDate.nullable(),
  installedAt: CreateAssetSchema.shape.installedAt.nullable(),
  specifications: CreateAssetSchema.shape.specifications.nullable(),
});

export const DesktopUpdateAssetSchema = DesktopCreateAssetSchema.partial().omit(
  {
    customerId: true,
    assetTypeId: true,
    baseMeasurementUnit: true,
  },
);

export const DesktopUpdateServiceOrderExecutionSchema =
  UpdateServiceOrderExecutionSchema.extend({
    result: UpdateServiceOrderExecutionSchema.shape.result.nullable(),
    items: UpdateServiceOrderExecutionSchema.shape.items.nullable(),
  });

// `CreateServiceOrderSchema` carries a superRefine, so it cannot be extended
// (Zod throws at runtime and `safeExtend` rejects the widened field types).
// For the two keys the local-db intake builder sends as `?? null`
// (`clientContactSnapshot`, `assetSnapshot`), drop an explicit null before the
// parse — for a CREATE, null and absent mean the same thing.
export const DESKTOP_SERVICE_ORDER_NULLABLE_KEYS = [
  "clientContactSnapshot",
  "assetSnapshot",
] as const;

export function stripDesktopNullEntries(
  payload: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const cleaned = { ...payload };
  for (const key of keys) {
    if (cleaned[key] === null) delete cleaned[key];
  }
  return cleaned;
}

function getMemberData(c: { get: (key: "member") => MemberData }) {
  return c.get("member");
}

export const syncRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>()
  .post(
    "/bootstrap",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const session = c.get("session");
      const memberData = getMemberData(c);
      const [
        publishedMethods,
        assetTypes,
        customers,
        assets,
        services,
        standards,
        environmentalLimitRows,
        jobs,
        serviceOrders,
      ] = await Promise.all([
        db
          .select({
            id: calibrationMethod.id,
            organizationId: calibrationMethod.organizationId,
            assetTypeId: calibrationMethod.assetTypeId,
            name: calibrationMethod.name,
            version: calibrationMethod.version,
            dataFields: calibrationMethod.dataFields,
            variableBindings: calibrationMethod.variableBindings,
            formulas: calibrationMethod.formulas,
            measurementModels: calibrationMethod.measurementModels,
            validations: calibrationMethod.validations,
            uncertaintyParams: calibrationMethod.uncertaintyParams,
            certificateContent: calibrationMethod.certificateContent,
            accreditedScope: calibrationMethod.accreditedScope,
            methodFingerprint: calibrationMethod.methodFingerprint,
            methodEngine: calibrationMethod.methodEngine,
            compiledMethod: calibrationMethod.compiledMethod,
            publicationEvidence: calibrationMethod.publicationEvidence,
            publishedAt: calibrationMethod.publishedAt,
          })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, memberData.organizationId),
              eq(calibrationMethod.status, "PUBLISHED"),
            ),
          ),
        db.select().from(assetType),
        db
          .select({
            id: customer.id,
            name: customer.name,
            taxId: customer.taxId,
            email: customer.email,
            phone: customer.phone,
            address: customer.address,
            compliance: customer.compliance,
            updatedAt: customer.updatedAt,
          })
          .from(customer)
          .where(eq(customer.labOrganizationId, memberData.organizationId)),
        db
          .select({
            id: asset.id,
            organizationId: customer.labOrganizationId,
            unitId: asset.unitId,
            customerId: asset.customerId,
            assetTypeId: asset.assetTypeId,
            name: asset.name,
            serialNumber: asset.serialNumber,
            tag: asset.tag,
            manufacturer: asset.manufacturer,
            model: asset.model,
            baseMeasurementUnit: asset.baseMeasurementUnit,
            specifications: asset.specifications,
            // Track-1 dates + comments: the local upsert maps them; omitting
            // them here both hid due dates from the desktop AND nulled the
            // local columns on every pull (the upsert writes absent as null).
            lastCalibrationDate: asset.lastCalibrationDate,
            nextCalibrationDate: asset.nextCalibrationDate,
            comments: asset.comments,
            metrologyRegime: asset.metrologyRegime,
            regulatedInterval: asset.regulatedInterval,
            nextLegalVerificationDate: asset.nextLegalVerificationDate,
            installedAt: asset.installedAt,
            status: asset.status,
            updatedAt: asset.updatedAt,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(
            and(
              eq(customer.labOrganizationId, memberData.organizationId),
              buildUnitScopeCondition(asset.unitId, memberData),
              isNull(asset.deletedAt),
            ),
          ),
        db
          .select({
            id: service.id,
            organizationId: service.organizationId,
            unitId: service.unitId,
            assetTypeId: service.assetTypeId,
            methodId: service.methodId,
            name: service.name,
            description: service.description,
            isActive: service.isActive,
            updatedAt: service.updatedAt,
          })
          .from(service)
          .where(
            and(
              eq(service.organizationId, memberData.organizationId),
              buildUnitScopeCondition(service.unitId, memberData),
              eq(service.isActive, true),
            ),
          ),
        db
          .select({
            id: referenceStandard.id,
            organizationId: referenceStandard.organizationId,
            unitId: referenceStandard.unitId,
            name: referenceStandard.name,
            kind: referenceStandard.kind,
            type: referenceStandard.type,
            serialNumber: referenceStandard.serialNumber,
            manufacturer: referenceStandard.manufacturer,
            model: referenceStandard.model,
            certificateNumber: referenceStandard.certificateNumber,
            calibratedBy: referenceStandard.calibratedBy,
            calibrationDate: referenceStandard.calibrationDate,
            nextCalibrationDate: referenceStandard.nextCalibrationDate,
            referenceValue: referenceStandard.referenceValue,
            uncertainty: referenceStandard.uncertainty,
            uncertaintyUnit: referenceStandard.uncertaintyUnit,
            coverageFactor: referenceStandard.coverageFactor,
            distribution: referenceStandard.distribution,
            drift: referenceStandard.drift,
            certifiedValues: referenceStandard.certifiedValues,
            metrologyData: referenceStandard.metrologyData,
            status: referenceStandard.status,
            createdAt: referenceStandard.createdAt,
            updatedAt: referenceStandard.updatedAt,
          })
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.organizationId, memberData.organizationId),
              buildUnitScopeCondition(referenceStandard.unitId, memberData),
              isNull(referenceStandard.deletedAt),
            ),
          ),
        db
          .select()
          .from(environmentalLimits)
          .where(
            and(
              eq(environmentalLimits.organizationId, memberData.organizationId),
              buildUnitScopeCondition(environmentalLimits.unitId, memberData),
            ),
          ),
        db
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            organizationId: calibrationJob.organizationId,
            unitId: calibrationJob.unitId,
            customerId: calibrationJob.customerId,
            assetId: calibrationJob.assetId,
            serviceId: calibrationJob.serviceId,
            technicianId: calibrationJob.technicianId,
            methodSnapshot: calibrationJob.methodSnapshot,
            assetSnapshot: calibrationJob.assetSnapshot,
            standardsSnapshot: calibrationJob.standardsSnapshot,
            environmentalSnapshot: calibrationJob.environmentalSnapshot,
            calibrationLocationSnapshot:
              calibrationJob.calibrationLocationSnapshot,
            calibrationPhaseSnapshot: calibrationJob.calibrationPhaseSnapshot,
            data: calibrationJob.data,
            results: calibrationJob.results,
            status: calibrationJob.status,
            dueDate: calibrationJob.dueDate,
            createdAt: calibrationJob.createdAt,
            updatedAt: calibrationJob.updatedAt,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              buildUnitScopeCondition(calibrationJob.unitId, memberData),
            ),
          ),
        db
          .select({
            id: serviceOrder.id,
            organizationId: serviceOrder.organizationId,
            unitId: serviceOrder.unitId,
            serviceOrderNumber: serviceOrder.serviceOrderNumber,
            customerId: serviceOrder.customerId,
            assetId: serviceOrder.assetId,
            clientContactId: serviceOrder.clientContactId,
            clientContactSnapshot: serviceOrder.clientContactSnapshot,
            intakeType: serviceOrder.intakeType,
            sourceServiceOrderId: serviceOrder.sourceServiceOrderId,
            status: serviceOrder.status,
            priority: serviceOrder.priority,
            responsibleTechnicianId: serviceOrder.responsibleTechnicianId,
            claimedDefect: serviceOrder.claimedDefect,
            intakeCondition: serviceOrder.intakeCondition,
            accessories: serviceOrder.accessories,
            removedSealingMarkNumber: serviceOrder.removedSealingMarkNumber,
            affixedSealingMarkNumber: serviceOrder.affixedSealingMarkNumber,
            inmetroRepairMarkNumber: serviceOrder.inmetroRepairMarkNumber,
            invoiceRemittanceNumber: serviceOrder.invoiceRemittanceNumber,
            invoiceRemittanceKey: serviceOrder.invoiceRemittanceKey,
            invoiceRemittanceIssuedAt: serviceOrder.invoiceRemittanceIssuedAt,
            carrierName: serviceOrder.carrierName,
            carrierDocument: serviceOrder.carrierDocument,
            thirdPartyName: serviceOrder.thirdPartyName,
            thirdPartyDocument: serviceOrder.thirdPartyDocument,
            thirdPartyPhone: serviceOrder.thirdPartyPhone,
            deliveryMethod: serviceOrder.deliveryMethod,
            internalNotes: serviceOrder.internalNotes,
            clientVisibleNotes: serviceOrder.clientVisibleNotes,
            evaluationFeeCents: serviceOrder.evaluationFeeCents,
            warrantyUntil: serviceOrder.warrantyUntil,
            warrantyTerms: serviceOrder.warrantyTerms,
            openedAt: serviceOrder.openedAt,
            updatedAt: serviceOrder.updatedAt,
          })
          .from(serviceOrder)
          .where(
            and(
              eq(serviceOrder.organizationId, memberData.organizationId),
              buildUnitScopeCondition(serviceOrder.unitId, memberData),
            ),
          ),
      ]);
      const standardsWithDocuments =
        await attachReferenceStandardCertificateDocuments(standards);

      const massCompositionProfileRows = await db
        .select({
          id: massCompositionProfile.id,
          profileKey: massCompositionProfile.profileKey,
          profileClass: massCompositionProfile.profileClass,
          nominal: massCompositionProfile.nominal,
          nominalG: massCompositionProfile.nominalG,
          value: massCompositionProfile.value,
          uncertainty: massCompositionProfile.uncertainty,
          unit: massCompositionProfile.unit,
          maxError: massCompositionProfile.maxError,
          drift: massCompositionProfile.drift,
          buoyancy: massCompositionProfile.buoyancy,
          coverageFactor: massCompositionProfile.coverageFactor,
          quantityAvailable: massCompositionProfile.quantityAvailable,
        })
        .from(massCompositionProfile)
        .where(
          and(
            eq(
              massCompositionProfile.organizationId,
              memberData.organizationId,
            ),
            eq(massCompositionProfile.status, "ACTIVE"),
            isNull(massCompositionProfile.deletedAt),
          ),
        )
        .orderBy(
          massCompositionProfile.profileClass,
          massCompositionProfile.nominalG,
        );

      return c.json(
        syncBootstrapResponseSchema.parse({
          serverTime: new Date().toISOString(),
          user: {
            id: session.user.id,
            name: session.user.name ?? null,
            email: session.user.email ?? null,
          },
          organization: {
            id: memberData.organizationId,
            type: memberData.organizationType,
          },
          activeUnits: memberData.accessibleUnits.map((unit) => ({
            id: unit.id,
            name: unit.name,
            role: unit.role ?? null,
          })),
          permissions: {
            role: memberData.role,
            unitRole: memberData.unitRole,
            activeUnitId: memberData.activeUnitId,
            accessibleUnitIds: memberData.accessibleUnitIds,
            canAccessAllUnits: memberData.canAccessAllUnits,
          },
          featureFlags: {
            offlineApprovals: false,
            offlineCertificatePublication: false,
          },
          syncCursor: new Date().toISOString(),
          publishedMethods,
          assetTypes,
          customers,
          assets,
          services,
          standards: standardsWithDocuments,
          massCompositionProfiles: massCompositionProfileRows,
          environmentalLimits: environmentalLimitRows,
          jobs,
          serviceOrders,
        }),
      );
    },
  )
  .post(
    "/certificate-pdfs",
    ...withLabPermission({ calibration: ["approve"] }),
    async (c) => {
      const memberData = getMemberData(c);
      const session = c.get("session");
      const formData = await c.req.formData();
      const result = await applyDesktopCertificatePdfUpload({
        formData,
        memberData,
        sessionUserId: session.user.id,
        env: c.env,
      });

      return c.json(syncPushResponseSchema.parse(result));
    },
  )
  .post(
    "/push",
    ...withLabPermission({ calibration: ["create"] }),
    async (c) => {
      const memberData = getMemberData(c);
      const session = c.get("session");
      const body = syncPushRequestSchema.parse(await c.req.json());
      const accepted: Array<{
        eventId: string;
        remoteEntityId?: number | string;
        remoteEntity?: unknown;
        remoteVersion: number;
        cloudEventId: string;
      }> = [];
      const rejected: Array<{
        eventId: string;
        reason: string;
        code: string;
      }> = [];
      const conflicts: Array<{
        id: string;
        eventId: string;
        entityType: string;
        entityId: string;
        conflictType: string;
        status: string;
        localPayload: unknown;
        remotePayload: unknown;
      }> = [];

      const actorMembershipCache = new Map<string, boolean>();

      for (const event of body.events) {
        if (event.organizationId !== memberData.organizationId) {
          rejected.push({
            eventId: event.eventId,
            code: "ORGANIZATION_SCOPE_MISMATCH",
            reason:
              "Sync event organization does not match active organization.",
          });
          continue;
        }

        if (
          event.unitId !== null &&
          !memberData.accessibleUnitIds.includes(event.unitId)
        ) {
          rejected.push({
            eventId: event.eventId,
            code: "UNIT_SCOPE_MISMATCH",
            reason: "Sync event unit is not accessible to this member.",
          });
          continue;
        }

        const claimedActorUserId = getClaimedSyncActorUserId(event.actorUserId);
        const actorAllowed = await validateSyncActorScope(
          claimedActorUserId,
          memberData,
          session.user.id,
          actorMembershipCache,
        );
        if (!actorAllowed) {
          rejected.push({
            eventId: event.eventId,
            code: "ACTOR_SCOPE_MISMATCH",
            reason:
              "Sync event actor is not a member of the active organization.",
          });
          continue;
        }

        const appliedEvent = await findAppliedDesktopSyncEvent(
          memberData.organizationId,
          event,
        );
        if (appliedEvent) {
          accepted.push({
            eventId: event.eventId,
            remoteEntityId: appliedEvent.remoteEntityId,
            remoteEntity: appliedEvent.remoteEntity,
            remoteVersion: event.localVersion + 1,
            cloudEventId: `cloud:${event.eventId}`,
          });
          continue;
        }

        const result = await applyDesktopSyncEvent({
          event,
          memberData,
          sessionUserId: session.user.id,
          deviceId: body.deviceId,
          clientBatchId: body.clientBatchId,
        });

        if (!result.ok) {
          if (result.conflict) {
            conflicts.push({
              id: buildDesktopSyncConflictId(event),
              eventId: event.eventId,
              entityType: event.entityType,
              entityId: event.entityId,
              conflictType: result.conflict.conflictType,
              status: "open",
              localPayload: event.payload,
              remotePayload: result.conflict.remotePayload ?? {},
            });
            continue;
          }

          rejected.push({
            eventId: event.eventId,
            code: result.code,
            reason: result.reason,
          });
          continue;
        }

        accepted.push({
          eventId: event.eventId,
          remoteEntityId: result.remoteEntityId,
          remoteEntity: result.remoteEntity,
          remoteVersion: event.localVersion + 1,
          cloudEventId: `cloud:${event.eventId}`,
        });
      }

      return c.json(
        syncPushResponseSchema.parse({
          accepted,
          rejected,
          conflicts,
          newCursor:
            accepted.length > 0 || conflicts.length > 0
              ? buildSyncPushCursor(
                  body.clientBatchId,
                  accepted.length,
                  conflicts.length,
                )
              : (body.baseCursor ?? undefined),
        }),
      );
    },
  )
  .get("/pull", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const cursor = c.req.query("cursor") ?? null;
    const since = parseSyncPullCursor(cursor);
    const limit = parseSyncPullLimit(c.req.query("limit"));
    const memberData = getMemberData(c);
    const pull = await loadCloudSyncEventsSince(memberData, since, limit);
    const serverCursor = new Date().toISOString();

    return c.json(
      syncPullResponseSchema.parse({
        cursor: pull.hasMore ? pull.cursor : serverCursor,
        hasMore: pull.hasMore,
        events: pull.events,
      }),
    );
  })
  .post("/ack", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const body = syncAckRequestSchema.parse(await c.req.json());

    return c.json(
      syncAckResponseSchema.parse({
        ok: true,
        cursor: body.cursor,
        acknowledgedAt: new Date().toISOString(),
      }),
    );
  })
  .post(
    "/conflicts/:id/resolve",
    ...withLabPermission({ calibration: ["create"] }),
    async (c) => {
      const memberData = getMemberData(c);
      const session = c.get("session");
      const conflictId = c.req.param("id");
      const body = syncConflictResolutionRequestSchema.parse(
        await c.req.json(),
      );
      const resolvedAt = new Date().toISOString();

      await writeOrganizationAuditEvent({
        organizationId: memberData.organizationId,
        unitId: memberData.activeUnitId,
        actorUserId: session.user.id,
        actorMemberId: memberData.id,
        action: "sync.conflict_resolved",
        entityType: "sync_conflict",
        entityId: conflictId,
        details: {
          conflictId,
          status: body.status,
          resolvedAt,
        },
      });

      return c.json(
        syncConflictResolutionResponseSchema.parse({
          data: {
            id: conflictId,
            status: body.status,
            resolvedAt,
          },
        }),
      );
    },
  )
  .post(
    "/attachments/init-upload",
    ...withLabPermission({ calibration: ["create"] }),
    async (c) => {
      const memberData = getMemberData(c);
      const body = syncAttachmentInitUploadRequestSchema.parse(
        await c.req.json(),
      );
      const objectKey = buildSyncAttachmentObjectKey(memberData, body);
      const uploadUrl = await generatePresignedUploadUrl(
        createR2Client(c.env),
        c.env.R2_BUCKET_NAME,
        objectKey,
        body.mimeType,
        SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
      );

      return c.json(
        syncAttachmentInitUploadResponseSchema.parse({
          attachmentId: encodeSyncAttachmentId(objectKey),
          objectKey,
          uploadUrl,
          expiresInSeconds: SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
          headers: {
            "content-type": body.mimeType,
          },
        }),
      );
    },
  )
  .post(
    "/attachments/complete-upload",
    ...withLabPermission({ calibration: ["create"] }),
    async (c) => {
      const body = syncAttachmentCompleteUploadRequestSchema.parse(
        await c.req.json(),
      );
      const objectKey = tryDecodeSyncAttachmentId(body.attachmentId);
      if (!objectKey) {
        return c.json({ error: "Invalid attachment id." }, 400);
      }

      if (objectKey !== body.objectKey) {
        return c.json(
          { error: "Attachment id does not match object key." },
          400,
        );
      }

      return c.json(
        syncAttachmentCompleteUploadResponseSchema.parse({
          ok: true,
          attachmentId: body.attachmentId,
          objectKey: body.objectKey,
          completedAt: new Date().toISOString(),
        }),
      );
    },
  )
  .get(
    "/attachments/:attachmentId/download",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const attachmentId = c.req.param("attachmentId");
      const objectKey = tryDecodeSyncAttachmentId(attachmentId);
      if (!objectKey) {
        return c.json({ error: "Invalid attachment id." }, 400);
      }

      const downloadUrl = await generatePresignedUrl(
        createR2Client(c.env),
        c.env.R2_BUCKET_NAME,
        objectKey,
        SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
      );

      return c.json(
        syncAttachmentDownloadResponseSchema.parse({
          attachmentId,
          objectKey,
          downloadUrl,
          expiresInSeconds: SYNC_ATTACHMENT_URL_EXPIRES_IN_SECONDS,
        }),
      );
    },
  );

type ApplyDesktopSyncEventInput = {
  event: SyncEvent;
  memberData: MemberData;
  sessionUserId: string;
  deviceId: string;
  clientBatchId: string;
};

type ApplyDesktopCertificatePdfUploadInput = {
  formData: FormData;
  memberData: MemberData;
  sessionUserId: string;
  env: R2Env;
};

type ApplyDesktopSyncEventResult =
  | { ok: true; remoteEntityId?: number | string; remoteEntity?: unknown }
  | {
      ok: false;
      code: string;
      reason: string;
      conflict?: {
        conflictType: string;
        remotePayload?: unknown;
      };
    };

// ============================================================================
// Optimistic-concurrency guard for the blind desktop applies (REL-01 slice 2)
// ============================================================================
// The desktop emits `baseUpdatedAt` — the cloud row's `updatedAt` captured at
// PULL time (slice 1). If the server row's current `updatedAt` is STRICTLY after
// that base, the cloud advanced since the desktop last pulled, so the desktop
// edit was made against a stale base and a blind UPDATE would silently lose the
// cloud change (last-write-wins). Equal timestamps = unchanged since pull = safe
// to apply (no false conflict). A null / absent / unparseable base means "cannot
// check" → apply exactly as today (backward compatible with older desktop builds
// that never emit it, and with rows that were never pulled).
type StaleDesktopBase =
  | { diverged: false }
  | { diverged: true; serverUpdatedAtIso: string; baseUpdatedAt: string };

export function detectStaleDesktopBase(params: {
  baseUpdatedAt: string | null | undefined;
  serverUpdatedAt: Date | string | null | undefined;
}): StaleDesktopBase {
  const base = params.baseUpdatedAt;
  if (base === null || base === undefined) return { diverged: false };
  const baseMs = Date.parse(base);
  if (Number.isNaN(baseMs)) return { diverged: false };

  const server = params.serverUpdatedAt;
  if (server === null || server === undefined) return { diverged: false };
  const serverDate = server instanceof Date ? server : new Date(server);
  const serverMs = serverDate.getTime();
  if (Number.isNaN(serverMs)) return { diverged: false };

  // Strictly after: equal means the row is still at the pulled version.
  if (serverMs > baseMs) {
    return {
      diverged: true,
      serverUpdatedAtIso: serverDate.toISOString(),
      baseUpdatedAt: base,
    };
  }
  return { diverged: false };
}

// Build the conflict result the push handler turns into a `sync_conflicts` row
// (`conflictType` + `remotePayload`) — the SAME shape the job-execution guard
// already uses. `concurrent_update` is the version-based conflict type the
// desktop conflicts UI already labels ("Atualização concorrente"). The remote
// payload carries enough to resolve: the entity, its cloud id, the server's
// current `updatedAt`, and the base the desktop edited against.
function buildStaleDesktopBaseConflict(params: {
  entity: string;
  id: number;
  serverUpdatedAtIso: string;
  baseUpdatedAt: string;
  // REL-01 slice 3 (REQ-REL-RES-001): the CURRENT cloud row's diff-relevant
  // fields, so the desktop conflicts UI renders real cloud values instead of
  // "—" for every column. Read from the row already fetched under the caller's
  // tenant WHERE clause; the fixed keys below always win over these.
  remoteFields?: Record<string, unknown>;
}): ApplyDesktopSyncEventResult {
  return {
    ok: false,
    code: "STALE_BASE_VERSION",
    reason: `Cloud ${params.entity} advanced since the desktop pulled (base ${params.baseUpdatedAt}, server ${params.serverUpdatedAtIso}).`,
    conflict: {
      conflictType: "concurrent_update",
      remotePayload: {
        ...params.remoteFields,
        entity: params.entity,
        id: params.id,
        updatedAt: params.serverUpdatedAtIso,
        baseUpdatedAt: params.baseUpdatedAt,
      },
    },
  };
}

async function loadCloudSyncEventsSince(
  memberData: MemberData,
  since: Date,
  limit: number,
) {
  const [
    changedAssetTypes,
    changedCustomers,
    changedAssets,
    changedServices,
    changedStandards,
    changedEnvironmentalLimits,
    changedJobs,
    changedServiceOrders,
    changedMethods,
  ] = await Promise.all([
    db
      .select()
      .from(assetType)
      .where(gt(assetType.updatedAt, since))
      .orderBy(assetType.updatedAt)
      .limit(limit + 1),
    db
      .select({
        id: customer.id,
        name: customer.name,
        taxId: customer.taxId,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        compliance: customer.compliance,
        updatedAt: customer.updatedAt,
      })
      .from(customer)
      .where(
        and(
          eq(customer.labOrganizationId, memberData.organizationId),
          gt(customer.updatedAt, since),
        ),
      )
      .orderBy(customer.updatedAt)
      .limit(limit + 1),
    db
      .select({
        id: asset.id,
        organizationId: customer.labOrganizationId,
        unitId: asset.unitId,
        customerId: asset.customerId,
        assetTypeId: asset.assetTypeId,
        name: asset.name,
        serialNumber: asset.serialNumber,
        tag: asset.tag,
        manufacturer: asset.manufacturer,
        model: asset.model,
        baseMeasurementUnit: asset.baseMeasurementUnit,
        specifications: asset.specifications,
        // Track-1 dates + comments — same projection as the bootstrap select.
        lastCalibrationDate: asset.lastCalibrationDate,
        nextCalibrationDate: asset.nextCalibrationDate,
        comments: asset.comments,
        metrologyRegime: asset.metrologyRegime,
        regulatedInterval: asset.regulatedInterval,
        nextLegalVerificationDate: asset.nextLegalVerificationDate,
        installedAt: asset.installedAt,
        status: asset.status,
        updatedAt: asset.updatedAt,
      })
      .from(asset)
      .innerJoin(customer, eq(asset.customerId, customer.id))
      .where(
        and(
          eq(customer.labOrganizationId, memberData.organizationId),
          buildUnitScopeCondition(asset.unitId, memberData),
          isNull(asset.deletedAt),
          gt(asset.updatedAt, since),
        ),
      )
      .orderBy(asset.updatedAt)
      .limit(limit + 1),
    db
      .select({
        id: service.id,
        organizationId: service.organizationId,
        unitId: service.unitId,
        assetTypeId: service.assetTypeId,
        methodId: service.methodId,
        name: service.name,
        description: service.description,
        isActive: service.isActive,
        updatedAt: service.updatedAt,
      })
      .from(service)
      .where(
        and(
          eq(service.organizationId, memberData.organizationId),
          buildUnitScopeCondition(service.unitId, memberData),
          gt(service.updatedAt, since),
        ),
      )
      .orderBy(service.updatedAt)
      .limit(limit + 1),
    db
      .select({
        id: referenceStandard.id,
        organizationId: referenceStandard.organizationId,
        unitId: referenceStandard.unitId,
        name: referenceStandard.name,
        kind: referenceStandard.kind,
        type: referenceStandard.type,
        serialNumber: referenceStandard.serialNumber,
        manufacturer: referenceStandard.manufacturer,
        model: referenceStandard.model,
        certificateNumber: referenceStandard.certificateNumber,
        calibratedBy: referenceStandard.calibratedBy,
        calibrationDate: referenceStandard.calibrationDate,
        nextCalibrationDate: referenceStandard.nextCalibrationDate,
        referenceValue: referenceStandard.referenceValue,
        uncertainty: referenceStandard.uncertainty,
        uncertaintyUnit: referenceStandard.uncertaintyUnit,
        coverageFactor: referenceStandard.coverageFactor,
        distribution: referenceStandard.distribution,
        drift: referenceStandard.drift,
        certifiedValues: referenceStandard.certifiedValues,
        metrologyData: referenceStandard.metrologyData,
        status: referenceStandard.status,
        createdAt: referenceStandard.createdAt,
        updatedAt: referenceStandard.updatedAt,
      })
      .from(referenceStandard)
      .where(
        and(
          eq(referenceStandard.organizationId, memberData.organizationId),
          buildUnitScopeCondition(referenceStandard.unitId, memberData),
          isNull(referenceStandard.deletedAt),
          gt(referenceStandard.updatedAt, since),
        ),
      )
      .orderBy(referenceStandard.updatedAt)
      .limit(limit + 1),
    db
      .select()
      .from(environmentalLimits)
      .where(
        and(
          eq(environmentalLimits.organizationId, memberData.organizationId),
          buildUnitScopeCondition(environmentalLimits.unitId, memberData),
          gt(environmentalLimits.updatedAt, since),
        ),
      )
      .orderBy(environmentalLimits.updatedAt)
      .limit(limit + 1),
    db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        organizationId: calibrationJob.organizationId,
        unitId: calibrationJob.unitId,
        customerId: calibrationJob.customerId,
        assetId: calibrationJob.assetId,
        serviceId: calibrationJob.serviceId,
        technicianId: calibrationJob.technicianId,
        methodSnapshot: calibrationJob.methodSnapshot,
        assetSnapshot: calibrationJob.assetSnapshot,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        environmentalSnapshot: calibrationJob.environmentalSnapshot,
        calibrationLocationSnapshot: calibrationJob.calibrationLocationSnapshot,
        calibrationPhaseSnapshot: calibrationJob.calibrationPhaseSnapshot,
        data: calibrationJob.data,
        results: calibrationJob.results,
        status: calibrationJob.status,
        dueDate: calibrationJob.dueDate,
        createdAt: calibrationJob.createdAt,
        updatedAt: calibrationJob.updatedAt,
      })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.organizationId, memberData.organizationId),
          buildUnitScopeCondition(calibrationJob.unitId, memberData),
          gt(calibrationJob.updatedAt, since),
        ),
      )
      .orderBy(calibrationJob.updatedAt)
      .limit(limit + 1),
    db
      .select({
        id: serviceOrder.id,
        organizationId: serviceOrder.organizationId,
        unitId: serviceOrder.unitId,
        serviceOrderNumber: serviceOrder.serviceOrderNumber,
        customerId: serviceOrder.customerId,
        assetId: serviceOrder.assetId,
        clientContactId: serviceOrder.clientContactId,
        clientContactSnapshot: serviceOrder.clientContactSnapshot,
        intakeType: serviceOrder.intakeType,
        sourceServiceOrderId: serviceOrder.sourceServiceOrderId,
        status: serviceOrder.status,
        priority: serviceOrder.priority,
        responsibleTechnicianId: serviceOrder.responsibleTechnicianId,
        claimedDefect: serviceOrder.claimedDefect,
        intakeCondition: serviceOrder.intakeCondition,
        accessories: serviceOrder.accessories,
        removedSealingMarkNumber: serviceOrder.removedSealingMarkNumber,
        affixedSealingMarkNumber: serviceOrder.affixedSealingMarkNumber,
        inmetroRepairMarkNumber: serviceOrder.inmetroRepairMarkNumber,
        invoiceRemittanceNumber: serviceOrder.invoiceRemittanceNumber,
        invoiceRemittanceKey: serviceOrder.invoiceRemittanceKey,
        invoiceRemittanceIssuedAt: serviceOrder.invoiceRemittanceIssuedAt,
        carrierName: serviceOrder.carrierName,
        carrierDocument: serviceOrder.carrierDocument,
        thirdPartyName: serviceOrder.thirdPartyName,
        thirdPartyDocument: serviceOrder.thirdPartyDocument,
        thirdPartyPhone: serviceOrder.thirdPartyPhone,
        deliveryMethod: serviceOrder.deliveryMethod,
        internalNotes: serviceOrder.internalNotes,
        clientVisibleNotes: serviceOrder.clientVisibleNotes,
        evaluationFeeCents: serviceOrder.evaluationFeeCents,
        warrantyUntil: serviceOrder.warrantyUntil,
        warrantyTerms: serviceOrder.warrantyTerms,
        openedAt: serviceOrder.openedAt,
        updatedAt: serviceOrder.updatedAt,
      })
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.organizationId, memberData.organizationId),
          buildUnitScopeCondition(serviceOrder.unitId, memberData),
          gt(serviceOrder.updatedAt, since),
        ),
      )
      .orderBy(serviceOrder.updatedAt)
      .limit(limit + 1),
    db
      .select({
        id: calibrationMethod.id,
        organizationId: calibrationMethod.organizationId,
        assetTypeId: calibrationMethod.assetTypeId,
        name: calibrationMethod.name,
        version: calibrationMethod.version,
        dataFields: calibrationMethod.dataFields,
        variableBindings: calibrationMethod.variableBindings,
        formulas: calibrationMethod.formulas,
        measurementModels: calibrationMethod.measurementModels,
        validations: calibrationMethod.validations,
        uncertaintyParams: calibrationMethod.uncertaintyParams,
        certificateContent: calibrationMethod.certificateContent,
        accreditedScope: calibrationMethod.accreditedScope,
        methodFingerprint: calibrationMethod.methodFingerprint,
        methodEngine: calibrationMethod.methodEngine,
        compiledMethod: calibrationMethod.compiledMethod,
        publicationEvidence: calibrationMethod.publicationEvidence,
        publishedAt: calibrationMethod.publishedAt,
      })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.organizationId, memberData.organizationId),
          eq(calibrationMethod.status, "PUBLISHED"),
          gt(calibrationMethod.publishedAt, since),
        ),
      )
      .orderBy(calibrationMethod.publishedAt)
      .limit(limit + 1),
  ]);
  const changedStandardsWithDocuments =
    await attachReferenceStandardCertificateDocuments(changedStandards);

  const events = [
    ...toCloudEvents("asset_type", changedAssetTypes, "updatedAt", limit),
    ...toCloudEvents("customer", changedCustomers, "updatedAt", limit),
    ...toCloudEvents("asset", changedAssets, "updatedAt", limit),
    ...toCloudEvents("service", changedServices, "updatedAt", limit),
    ...toCloudEvents(
      "reference_standard",
      changedStandardsWithDocuments,
      "updatedAt",
      limit,
    ),
    ...toCloudEvents(
      "environmental_limit",
      changedEnvironmentalLimits,
      "updatedAt",
      limit,
    ),
    ...toCloudEvents("calibration_job", changedJobs, "updatedAt", limit),
    ...toCloudEvents("service_order", changedServiceOrders, "updatedAt", limit),
    ...toCloudEvents("published_method", changedMethods, "publishedAt", limit),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  return {
    events,
    cursor: events.at(-1)?.occurredAt ?? since.toISOString(),
    hasMore: [
      changedAssetTypes,
      changedCustomers,
      changedAssets,
      changedServices,
      changedStandards,
      changedEnvironmentalLimits,
      changedJobs,
      changedServiceOrders,
      changedMethods,
    ].some((rows) => rows.length > limit),
  };
}

function toCloudEvents(
  entityType:
    | "asset_type"
    | "customer"
    | "asset"
    | "service"
    | "published_method"
    | "reference_standard"
    | "environmental_limit"
    | "calibration_job"
    | "service_order",
  rows: Array<Record<string, unknown>>,
  timestampKey: string,
  limit: number,
) {
  return rows.slice(0, limit).map((row) => {
    const occurredAt = toSyncTimestamp(row[timestampKey]);
    return {
      cloudEventId: `cloud:${entityType}:${String(row.id)}:${occurredAt}`,
      entityType,
      entityId:
        typeof row.id === "number" || typeof row.id === "string"
          ? row.id
          : String(row.id),
      operation: "upsert" as const,
      occurredAt,
      payload: row,
    };
  });
}

type ReferenceStandardSyncRow = {
  id: number;
  certificateNumber: string;
};

async function attachReferenceStandardCertificateDocuments<
  TStandard extends ReferenceStandardSyncRow,
>(standards: TStandard[]) {
  if (standards.length === 0) {
    return standards.map((standard) => ({
      ...standard,
      certificateDocument: null,
    }));
  }

  const currentDocuments = await db
    .select()
    .from(referenceStandardCertificateDocument)
    .where(
      and(
        inArray(
          referenceStandardCertificateDocument.standardId,
          standards.map((standard) => standard.id),
        ),
        eq(referenceStandardCertificateDocument.isCurrent, true),
        not(like(referenceStandardCertificateDocument.r2Key, "pending/%")),
      ),
    );
  const standardsById = new Map(
    standards.map((standard) => [standard.id, standard]),
  );
  const documentsByStandardId = new Map(
    currentDocuments
      .filter((document) => {
        const standard = standardsById.get(document.standardId);
        return standard?.certificateNumber === document.certificateNumber;
      })
      .map((document) => [
        document.standardId,
        standardCertificateDocumentSnapshot(document),
      ]),
  );

  return standards.map((standard) => ({
    ...standard,
    certificateDocument: documentsByStandardId.get(standard.id) ?? null,
  }));
}

function standardCertificateDocumentSnapshot(
  document: typeof referenceStandardCertificateDocument.$inferSelect,
): ReferenceStandardCertificateDocumentSnapshot {
  return {
    documentId: document.id,
    r2Key: document.r2Key,
    fileName: document.fileName,
    fileSize: document.fileSize,
    sha256: document.sha256,
    uploadedAt: document.uploadedAt,
    certificateNumber: document.certificateNumber,
    calibrationDate: document.calibrationDate,
    nextCalibrationDate: document.nextCalibrationDate,
  };
}

async function applyDesktopCertificatePdfUpload(
  input: ApplyDesktopCertificatePdfUploadInput,
) {
  const fields = readCertificatePdfUploadFields(input.formData);
  if (!fields.ok) {
    return syncPushResponseSchema.parse({
      accepted: [],
      rejected: [
        {
          eventId: fields.eventId,
          code: fields.code,
          reason: fields.reason,
        },
      ],
      conflicts: [],
    });
  }

  const upload = fields.value;
  if (upload.organizationId !== input.memberData.organizationId) {
    return syncPushResponseSchema.parse({
      accepted: [],
      rejected: [
        {
          eventId: upload.eventId,
          code: "ORGANIZATION_SCOPE_MISMATCH",
          reason: "Certificate PDF upload organization does not match.",
        },
      ],
      conflicts: [],
    });
  }

  if (
    upload.unitId !== null &&
    !input.memberData.accessibleUnitIds.includes(upload.unitId)
  ) {
    return syncPushResponseSchema.parse({
      accepted: [],
      rejected: [
        {
          eventId: upload.eventId,
          code: "UNIT_SCOPE_MISMATCH",
          reason: "Certificate PDF upload unit is not accessible.",
        },
      ],
      conflicts: [],
    });
  }

  const actorAllowed = await validateSyncActorScope(
    getClaimedSyncActorUserId(upload.actorUserId),
    input.memberData,
    input.sessionUserId,
  );
  if (!actorAllowed) {
    return syncPushResponseSchema.parse({
      accepted: [],
      rejected: [
        {
          eventId: upload.eventId,
          code: "ACTOR_SCOPE_MISMATCH",
          reason:
            "Certificate PDF upload actor is not a member of the active organization.",
        },
      ],
      conflicts: [],
    });
  }

  try {
    const existingRemoteKey = await findDesktopSyncRemoteEntityId(
      input.memberData.organizationId,
      upload.entityId,
    );
    if (typeof existingRemoteKey === "string") {
      return syncPushResponseSchema.parse({
        accepted: [
          {
            eventId: upload.eventId,
            remoteEntityId: existingRemoteKey,
            remoteVersion: upload.localVersion + 1,
            cloudEventId: `cloud:${upload.eventId}`,
          },
        ],
        rejected: [],
        conflicts: [],
      });
    }

    const mappedRemoteJobId = await findDesktopSyncRemoteEntityId(
      input.memberData.organizationId,
      upload.localJobId,
    );
    const remoteJobId =
      typeof mappedRemoteJobId === "number"
        ? mappedRemoteJobId
        : upload.remoteJobId;
    if (typeof remoteJobId !== "number") {
      return syncPushResponseSchema.parse({
        accepted: [],
        rejected: [
          {
            eventId: upload.eventId,
            code: "REMOTE_ENTITY_MAPPING_MISSING",
            reason: "Desktop certificate PDF upload has no synced cloud job.",
          },
        ],
        conflicts: [],
      });
    }

    const [job] = await db
      .select()
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.id, remoteJobId),
          eq(calibrationJob.organizationId, input.memberData.organizationId),
          buildUnitScopeCondition(calibrationJob.unitId, input.memberData),
        ),
      )
      .limit(1);

    if (!job) {
      return syncPushResponseSchema.parse({
        accepted: [],
        rejected: [
          {
            eventId: upload.eventId,
            code: "REMOTE_ENTITY_NOT_FOUND",
            reason: "Cloud job for desktop certificate PDF was not found.",
          },
        ],
        conflicts: [],
      });
    }

    if (!["REVIEW", "GENERATING_PDF"].includes(job.status)) {
      return syncPushResponseSchema.parse({
        accepted: [],
        rejected: [
          {
            eventId: upload.eventId,
            code: "INVALID_STATUS_TRANSITION",
            reason: `Cannot publish desktop certificate PDF for job with status ${job.status}.`,
          },
        ],
        conflicts: [],
      });
    }

    if (job.certificateUrl) {
      return syncPushResponseSchema.parse({
        accepted: [],
        rejected: [
          {
            eventId: upload.eventId,
            code: "CERTIFICATE_ALREADY_PUBLISHED",
            reason: "Cloud job already has a published certificate PDF.",
          },
        ],
        conflicts: [],
      });
    }

    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("Uploaded certificate PDF is empty.");
    }

    if (bytes.byteLength > MAX_DESKTOP_CERTIFICATE_PDF_BYTES) {
      throw new Error("Uploaded certificate PDF exceeds the size limit.");
    }

    if (bytes.byteLength !== upload.sizeBytes) {
      throw new Error("Uploaded certificate PDF size does not match metadata.");
    }

    const contentHash = createHash("sha256").update(bytes).digest("hex");
    if (contentHash !== upload.contentHash) {
      throw new Error("Uploaded certificate PDF hash does not match metadata.");
    }

    const year = new Date(upload.occurredAt).getUTCFullYear();
    const remoteKey = buildDesktopCertificatePdfKey({
      organizationId: input.memberData.organizationId,
      year,
      jobId: job.jobId,
      draftId: upload.draftId,
    });
    const certificateUrl = `${CERTIFICATE_PUBLIC_BASE_URL}/${remoteKey}`;
    const r2Client = createR2Client(input.env);
    const actorUserId = getSyncActorUserId(
      buildCertificatePdfUploadSyncEvent(upload, {
        contentHash,
        remoteKey,
        sizeBytes: bytes.byteLength,
      }),
      input.sessionUserId,
    );
    const approvedAt = job.approvedAt ?? new Date();
    const storedTemplateSnapshot = asRecord(job.certificateTemplateSnapshot);
    const effectiveTemplateSnapshot =
      Object.keys(storedTemplateSnapshot).length > 0
        ? storedTemplateSnapshot
        : serializeCertificateTemplateSnapshot(
            await getEffectiveCertificateTemplateSnapshot(
              input.memberData.organizationId,
            ),
          );

    await uploadToR2(
      r2Client,
      input.env.R2_BUCKET_NAME,
      remoteKey,
      bytes,
      "application/pdf",
    );

    // AS-FOUND (pre-adjustment) reliability verdict — mirrors the cloud
    // approval route so a desktop-approved cycle feeds the ILAC-G24 / NCSL
    // RP-1 interval analysis instead of staying permanently UNKNOWN.
    // Read-only over the frozen `results`; recomputing is idempotent.
    const asFoundVerdict = buildAsFoundReliabilityVerdict({
      results: job.results,
    });

    await db
      .update(calibrationJob)
      .set({
        status: "APPROVED",
        certificateUrl,
        approvedBy: job.approvedBy ?? actorUserId,
        approvedAt,
        asFoundConformity: asFoundVerdict.conformity,
        asFoundMargins: asFoundVerdict.margins,
        certificateTemplateId:
          job.certificateTemplateId ??
          (typeof effectiveTemplateSnapshot.id === "number"
            ? effectiveTemplateSnapshot.id
            : null),
        certificateTemplateSnapshot:
          job.certificateTemplateSnapshot ?? effectiveTemplateSnapshot,
        updatedAt: new Date(),
      })
      .where(eq(calibrationJob.id, job.id));

    // Advance the asset's calibration dates from the published work — same
    // rule as the cloud approval route (forward-only, never fails the sync).
    await advanceAssetCalibrationDatesOnApproval({
      assetId: job.assetId,
      calibrationDate: job.performedAt ?? approvedAt,
      performedBy: actorUserId,
      source: "desktop_certificate_publish",
    });

    await db.insert(jobAuditLog).values({
      jobId: job.id,
      action: "certificate_published_from_desktop",
      changes: {
        source: "desktop_sync",
        status: { old: job.status, new: "APPROVED" },
        approvedBy: { old: job.approvedBy, new: job.approvedBy ?? actorUserId },
        approvedAt: {
          old: job.approvedAt?.toISOString?.() ?? job.approvedAt,
          new: approvedAt.toISOString(),
        },
        certificateUrl: { old: job.certificateUrl, new: certificateUrl },
        contentHash,
        sizeBytes: bytes.byteLength,
        remoteKey,
      },
      performedBy: actorUserId,
    });

    await writeOrganizationAuditEvent({
      organizationId: input.memberData.organizationId,
      unitId: upload.unitId,
      actorUserId,
      actorMemberId: input.memberData.id,
      action: "desktop_sync.generate_local_certificate_pdf",
      entityType: "certificate_draft",
      entityId: upload.entityId,
      details: {
        eventId: upload.eventId,
        idempotencyKey: upload.idempotencyKey,
        localVersion: upload.localVersion,
        localEntityId: upload.entityId,
        localJobId: upload.localJobId,
        remoteEntityId: remoteKey,
        remoteJobId: job.id,
        certificateUrl,
        portalVisible: true,
        contentHash,
        sizeBytes: bytes.byteLength,
        // Keep the offline-actor vs pushing-user discrepancy visible in the
        // audit trail (the actor was validated as an org member at push time).
        ...(actorUserId !== input.sessionUserId
          ? { pushedByUserId: input.sessionUserId }
          : {}),
      },
    });

    return syncPushResponseSchema.parse({
      accepted: [
        {
          eventId: upload.eventId,
          remoteEntityId: remoteKey,
          remoteEntity: {
            jobId: job.jobId,
            status: "APPROVED",
            certificateUrl,
            remoteKey,
            portalVisible: true,
            approvedAt: approvedAt.toISOString(),
          },
          remoteVersion: upload.localVersion + 1,
          cloudEventId: `cloud:${upload.eventId}`,
        },
      ],
      rejected: [],
      conflicts: [],
    });
  } catch (error) {
    return syncPushResponseSchema.parse({
      accepted: [],
      rejected: [
        {
          eventId: upload.eventId,
          code: "CERTIFICATE_PDF_UPLOAD_FAILED",
          reason:
            error instanceof Error
              ? error.message
              : "Desktop certificate PDF upload failed.",
        },
      ],
      conflicts: [],
    });
  }
}

async function applyDesktopSyncEvent(
  input: ApplyDesktopSyncEventInput,
): Promise<ApplyDesktopSyncEventResult> {
  const actorUserId = getSyncActorUserId(input.event, input.sessionUserId);

  try {
    if (
      input.event.entityType === "calibration_job" &&
      input.event.operation === "create_local_job_draft"
    ) {
      return await applyCreateLocalJobDraft(input, actorUserId);
    }

    if (
      input.event.entityType === "asset" &&
      input.event.operation === "create_local_asset"
    ) {
      return await applyCreateLocalAsset(input, actorUserId);
    }

    if (
      input.event.entityType === "asset" &&
      input.event.operation === "update_local_asset"
    ) {
      return await applyUpdateLocalAsset(input, actorUserId);
    }

    if (
      input.event.entityType === "customer" &&
      input.event.operation === "create_local_customer"
    ) {
      return await applyCreateLocalCustomer(input, actorUserId);
    }

    if (
      input.event.entityType === "customer" &&
      input.event.operation === "update_local_customer"
    ) {
      return await applyUpdateLocalCustomer(input, actorUserId);
    }

    if (
      input.event.entityType === "customer" &&
      input.event.operation === "update_local_customer_compliance"
    ) {
      return await applyUpdateLocalCustomerCompliance(input, actorUserId);
    }

    if (
      input.event.entityType === "calibration_job" &&
      (input.event.operation === "save_local_execution" ||
        input.event.operation === "submit_local_execution")
    ) {
      return await applyLocalJobExecution(input, actorUserId);
    }

    if (
      input.event.entityType === "service_order" &&
      input.event.operation === "create_local_service_order_intake"
    ) {
      return await applyCreateLocalServiceOrderIntake(input, actorUserId);
    }

    if (
      input.event.entityType === "non_conformance" &&
      input.event.operation === "create_local_non_conformance"
    ) {
      return await applyCreateLocalNonConformance(input, actorUserId);
    }

    if (
      input.event.entityType === "service_order_quote" &&
      input.event.operation === "create_local_service_order_quote_draft"
    ) {
      return await applyCreateLocalServiceOrderQuoteDraft(input, actorUserId);
    }

    if (
      input.event.entityType === "service_order_execution" &&
      input.event.operation === "save_local_service_order_execution_notes"
    ) {
      return await applyLocalServiceOrderExecutionNotes(input, actorUserId);
    }

    if (
      input.event.entityType === "service_order_delivery_document" &&
      input.event.operation ===
        "create_local_service_order_delivery_document_draft"
    ) {
      return await applyCreateLocalServiceOrderDeliveryDocumentDraft(
        input,
        actorUserId,
      );
    }

    await writeDesktopSyncAudit(input, actorUserId);
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Desktop sync event failed.";
    const code = jobCreationClientErrors.has(message)
      ? "DOMAIN_VALIDATION_FAILED"
      : "DESKTOP_SYNC_APPLY_FAILED";
    return {
      ok: false,
      code,
      reason: message,
    };
  }
}

async function applyCreateLocalJobDraft(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const assetId = getNumber(payload, "assetId");
  const serviceId = getNumber(payload, "serviceId");
  const unitId =
    input.event.unitId ??
    getNumber(payload, "unitId") ??
    input.memberData.activeUnitId;

  if (!assetId || !serviceId || !unitId) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop job draft event is missing asset, service, or unit.",
    };
  }

  const job = await createCalibrationJob({
    organizationId: input.memberData.organizationId,
    unitId,
    createdBy: actorUserId,
    assetId,
    serviceId,
    technicianId: getNullableString(payload, "technicianId"),
    dueDate: getNullableString(payload, "dueDate"),
    notifyOnAssignment: false,
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: job.id,
    remoteJobId: job.jobId,
  });

  return {
    ok: true,
    remoteEntityId: job.id,
    remoteEntity: {
      id: job.id,
      jobId: job.jobId,
      status: job.status,
      certificateName: job.certificateName,
    },
  };
}

async function applyCreateLocalAsset(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const parseResult = DesktopCreateAssetSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop asset event is invalid.",
    };
  }

  const values = parseResult.data;
  const unitId = input.event.unitId ?? input.memberData.activeUnitId;
  if (!unitId) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop asset event is missing a unit.",
    };
  }

  const [foundCustomer] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, values.customerId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);

  if (!foundCustomer) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente nao encontrado",
    };
  }

  const [foundAssetType] = await db
    .select()
    .from(assetType)
    .where(eq(assetType.id, values.assetTypeId))
    .limit(1);

  if (!foundAssetType) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Tipo de instrumento nao encontrado",
    };
  }

  const baseMeasurementUnitResult = resolveAssetBaseMeasurementUnit(
    foundAssetType,
    values.baseMeasurementUnit,
  );
  if (!baseMeasurementUnitResult.ok) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: baseMeasurementUnitResult.error,
    };
  }

  if (foundAssetType.definition && values.specifications) {
    const requiredFields = foundAssetType.definition.filter(
      (field) => field.required,
    );
    for (const field of requiredFields) {
      if (
        values.specifications[field.key] === undefined ||
        values.specifications[field.key] === null ||
        values.specifications[field.key] === ""
      ) {
        return {
          ok: false,
          code: "DOMAIN_VALIDATION_FAILED",
          reason: `Campo obrigatorio: ${field.label}`,
        };
      }
    }
  }

  // SEC-03b (#638): tag uniqueness is per lab org — scope the collision check to
  // the caller's org (join asset → customer) so a desktop-created asset whose tag
  // is used only by ANOTHER lab is not falsely rejected (and cannot read/probe
  // another tenant's tags). The DB now enforces UNIQUE(lab_organization_id, tag).
  const [existingAsset] = await db
    .select({ id: asset.id })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(
      and(
        eq(asset.tag, values.tag),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);
  if (existingAsset) {
    return {
      ok: false,
      code: "TAG_ALREADY_EXISTS",
      reason: "Tag ja esta em uso",
    };
  }

  // The desktop never authors `nextCalibrationDate` — the calibration interval /
  // next-cal date is the customer's decision, set in the portal (§7.8.4.3 +
  // ILAC-G24); the field is not in the schema, so a desktop-sent value is
  // stripped and a freshly created asset lands with no next-cal date.
  const lastCalibrationDate = parseSyncDate(values.lastCalibrationDate);
  // Legal-metrology TRACK 2 (mirrors the cloud asset-create route): resolve the regime
  // trio + derive next_legal_verification_date so a desktop-created LEGAL instrument lands
  // consistent (REQ-MLR-003/030/031 + REQ-INSTALL-002), not as a half-set state.
  const installedAt = parseSyncDate(values.installedAt);
  const regimeWrite = resolveAssetRegimeWrite({
    metrologyRegime: values.metrologyRegime,
    regulatedInterval: values.regulatedInterval,
    current: { metrologyRegime: "INDUSTRIAL", regulatedInterval: null },
  });
  const nextLegalVerificationDate = regimeWrite.regulatedInterval
    ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
        lastVerificationDate: lastCalibrationDate,
        firstVerificationDate: lastCalibrationDate,
        installDate: installedAt,
      }).date
    : null;
  const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
    specifications: values.specifications || null,
    definition: foundAssetType.definition,
    baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
  });

  const newAsset = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(asset)
      .values({
        unitId,
        customerId: values.customerId,
        // SEC-03b (#638): denormalize the lab org from the (already org-scoped)
        // customer so the desktop-synced asset satisfies UNIQUE(lab_org, tag).
        // foundCustomer was fetched WHERE labOrganizationId =
        // memberData.organizationId, so this is the device's own lab org.
        labOrganizationId: foundCustomer.labOrganizationId,
        assetTypeId: values.assetTypeId,
        name: values.name,
        manufacturer: values.manufacturer || null,
        model: values.model || null,
        serialNumber: values.serialNumber,
        tag: values.tag,
        status: values.status || "ACTIVE",
        baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
        lastCalibrationDate,
        installedAt,
        comments: values.comments || null,
        specifications: normalizedSpecifications.specifications || null,
        metrologyRegime: regimeWrite.metrologyRegime,
        regulatedInterval: regimeWrite.regulatedInterval,
        nextLegalVerificationDate,
      })
      .returning();

    if (!created) throw new Error("Erro ao criar ativo");

    await tx.insert(assetAuditLog).values({
      assetId: created.id,
      action: "create",
      changes: {
        source: "desktop_sync",
        asset: { old: null, new: created },
        unitConversions:
          normalizedSpecifications.conversions.length > 0
            ? normalizedSpecifications.conversions
            : undefined,
      },
      performedBy: actorUserId,
    });

    return created;
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: newAsset.id,
    remoteAssetTag: newAsset.tag,
  });

  return {
    ok: true,
    remoteEntityId: newAsset.id,
    remoteEntity: {
      id: newAsset.id,
      tag: newAsset.tag,
      status: newAsset.status,
    },
  };
}

async function applyUpdateLocalAsset(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const mappedRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  const remoteEntityId =
    typeof mappedRemoteEntityId === "number"
      ? mappedRemoteEntityId
      : getNumber(payload, "remoteId");

  if (remoteEntityId === null) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Ativo desktop ainda nao possui ID remoto para atualizar.",
    };
  }

  const parseResult = DesktopUpdateAssetSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop asset update event is invalid.",
    };
  }

  const values = parseResult.data;
  const [existingAsset] = await db
    .select({
      id: asset.id,
      customerId: asset.customerId,
      name: asset.name,
      manufacturer: asset.manufacturer,
      model: asset.model,
      serialNumber: asset.serialNumber,
      tag: asset.tag,
      status: asset.status,
      baseMeasurementUnit: asset.baseMeasurementUnit,
      lastCalibrationDate: asset.lastCalibrationDate,
      nextCalibrationDate: asset.nextCalibrationDate,
      calibrationIntervalMonths: asset.calibrationIntervalMonths,
      comments: asset.comments,
      specifications: asset.specifications,
      metrologyRegime: asset.metrologyRegime,
      regulatedInterval: asset.regulatedInterval,
      installedAt: asset.installedAt,
      updatedAt: asset.updatedAt,
      assetTypeDefinition: assetType.definition,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
    .where(
      and(
        eq(asset.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
        isNull(asset.deletedAt),
      ),
    )
    .limit(1);

  if (!existingAsset) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Ativo nao encontrado para atualizacao desktop.",
    };
  }

  // REL-01 slice 2: refuse to blind-overwrite a cloud asset that advanced since
  // the desktop pulled its base (REQ-REL-SYNC-201). Legacy/null base applies as
  // today (REQ-REL-SYNC-203); equal/unchanged applies (REQ-REL-SYNC-202).
  const assetStaleBase = detectStaleDesktopBase({
    baseUpdatedAt: input.event.baseUpdatedAt,
    serverUpdatedAt: existingAsset.updatedAt,
  });
  if (assetStaleBase.diverged) {
    return buildStaleDesktopBaseConflict({
      entity: "asset",
      id: existingAsset.id,
      serverUpdatedAtIso: assetStaleBase.serverUpdatedAtIso,
      baseUpdatedAt: assetStaleBase.baseUpdatedAt,
      remoteFields: {
        tag: existingAsset.tag,
        name: existingAsset.name,
        serialNumber: existingAsset.serialNumber,
        manufacturer: existingAsset.manufacturer,
        model: existingAsset.model,
        status: existingAsset.status,
      },
    });
  }

  if (values.tag && values.tag !== existingAsset.tag) {
    // SEC-03b (#638): tag uniqueness is per lab org — scope this rename check to
    // the caller's org (join asset -> customer), same pattern as
    // applyCreateLocalAsset above. Unscoped, this both over-rejected a legitimate
    // rename to a tag only ANOTHER lab holds (the DB composite unique would allow
    // it) and re-exposed the cross-tenant existence oracle on the desktop-rename
    // path.
    //
    // Race note: a same-org duplicate rename that slips past this check (a true
    // concurrent race) would hit the DB composite unique (asset_lab_org_tag_uidx)
    // and throw 23505 from the .update() below. That error propagates up to
    // applyDesktopSyncEvent's outer try/catch, which already turns ANY thrown
    // error into a structured `{ ok: false, code: "DESKTOP_SYNC_APPLY_FAILED",
    // reason }` rejected-event result -- never a 500, never a crashed batch --
    // so no additional isUniqueViolation mapping is added here. This mirrors
    // applyCreateLocalAsset, which relies on the same generic catch for its own
    // DB-level race and was not given an explicit 23505 mapping either.
    const [duplicateTag] = await db
      .select({ id: asset.id })
      .from(asset)
      .innerJoin(customer, eq(asset.customerId, customer.id))
      .where(
        and(
          eq(asset.tag, values.tag),
          eq(customer.labOrganizationId, input.memberData.organizationId),
          isNull(asset.deletedAt),
        ),
      )
      .limit(1);

    if (duplicateTag && duplicateTag.id !== existingAsset.id) {
      return {
        ok: false,
        code: "TAG_ALREADY_EXISTS",
        reason: "Tag ja esta em uso",
      };
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (values.name !== undefined) updateData.name = values.name;
  if (values.manufacturer !== undefined)
    updateData.manufacturer = values.manufacturer || null;
  if (values.model !== undefined) updateData.model = values.model || null;
  if (values.serialNumber !== undefined)
    updateData.serialNumber = values.serialNumber;
  if (values.tag !== undefined) updateData.tag = values.tag;
  if (values.status !== undefined) updateData.status = values.status;
  if (values.lastCalibrationDate !== undefined) {
    const lastCalibrationDate = parseSyncDate(values.lastCalibrationDate);
    updateData.lastCalibrationDate = lastCalibrationDate;
    // The desktop never authors `nextCalibrationDate` (customer-owned, §7.8.4.3);
    // mirror the cloud asset-update route: next = last + customer interval,
    // null when no interval has been set (REQ-INTERVAL-003).
    updateData.nextCalibrationDate =
      existingAsset.calibrationIntervalMonths === null
        ? null
        : deriveNextCalibrationDate(
            lastCalibrationDate,
            existingAsset.calibrationIntervalMonths,
          );
  }
  if (values.comments !== undefined)
    updateData.comments = values.comments || null;
  // Track-2 install anchor (only persisted when the desktop event provides it).
  const installedAtUpdate =
    values.installedAt !== undefined
      ? parseSyncDate(values.installedAt)
      : undefined;
  if (installedAtUpdate !== undefined) {
    updateData.installedAt = installedAtUpdate;
  }
  // Legal-metrology regime (mirrors the cloud asset-update route): recompute the regime +
  // next_legal_verification_date when the desktop event touches the regime, the regulated
  // interval, the install anchor, OR the last-calibration date (the stored proxy for the
  // last-verification anchor). Keeps the regime columns mutually consistent
  // (REQ-MLR-030/031/032 + REQ-INSTALL-002).
  if (
    values.metrologyRegime !== undefined ||
    values.regulatedInterval !== undefined ||
    installedAtUpdate !== undefined ||
    values.lastCalibrationDate !== undefined
  ) {
    const parsedCurrent = RegulatedIntervalSchema.safeParse(
      existingAsset.regulatedInterval,
    );
    const regimeWrite = resolveAssetRegimeWrite({
      metrologyRegime: values.metrologyRegime,
      regulatedInterval: values.regulatedInterval,
      current: {
        metrologyRegime: existingAsset.metrologyRegime,
        regulatedInterval: parsedCurrent.success ? parsedCurrent.data : null,
      },
    });
    updateData.metrologyRegime = regimeWrite.metrologyRegime;
    updateData.regulatedInterval = regimeWrite.regulatedInterval;
    const anchorDate =
      (values.lastCalibrationDate !== undefined
        ? parseSyncDate(values.lastCalibrationDate)
        : existingAsset.lastCalibrationDate) ?? null;
    const installAnchor =
      (installedAtUpdate !== undefined
        ? installedAtUpdate
        : existingAsset.installedAt) ?? null;
    updateData.nextLegalVerificationDate = regimeWrite.regulatedInterval
      ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
          lastVerificationDate: anchorDate,
          firstVerificationDate: anchorDate,
          installDate: installAnchor,
        }).date
      : null;
  }
  if (values.specifications !== undefined) {
    const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
      specifications: values.specifications || null,
      definition: existingAsset.assetTypeDefinition,
      baseMeasurementUnit: existingAsset.baseMeasurementUnit,
    });
    updateData.specifications = normalizedSpecifications.specifications || null;
    if (normalizedSpecifications.conversions.length > 0) {
      changes.unitConversions = {
        old: null,
        new: normalizedSpecifications.conversions,
      };
    }
  }

  for (const [key, value] of Object.entries(updateData)) {
    if (key === "updatedAt") continue;
    const oldValue = Reflect.get(existingAsset, key);
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      changes[key] = { old: oldValue, new: value };
    }
  }

  const [updatedAsset] = await db
    .update(asset)
    .set(updateData)
    .where(and(eq(asset.id, remoteEntityId), isNull(asset.deletedAt)))
    .returning();

  if (!updatedAsset) throw new Error("Erro ao atualizar ativo");

  if (Object.keys(changes).length > 0) {
    await db.insert(assetAuditLog).values({
      assetId: remoteEntityId,
      action: "status" in changes ? "status_change" : "update",
      changes,
      performedBy: actorUserId,
    });
  }

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: updatedAsset.id,
    remoteAssetTag: updatedAsset.tag,
  });

  return {
    ok: true,
    remoteEntityId: updatedAsset.id,
    remoteEntity: {
      id: updatedAsset.id,
      tag: updatedAsset.tag,
      status: updatedAsset.status,
      // REL-01 slice 3 (REQ-REL-RES-002): carry the persisted updatedAt so the
      // desktop refreshes remote_base_updated_at on accept (no false self-
      // conflict on the next same-device edit before the next pull).
      updatedAt:
        updatedAsset.updatedAt?.toISOString?.() ?? updatedAsset.updatedAt,
    },
  };
}

async function applyCreateLocalCustomer(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const parseResult = CreateCustomerSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop customer event is invalid.",
    };
  }

  const values = parseResult.data;
  const slug = generateDesktopCustomerSlug(values.name);
  const orgResult = await createClientOrganizationAsServiceOwner({
    name: values.name,
    slug,
  });

  if (!orgResult?.id) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Falha ao criar organizacao do cliente",
    };
  }

  const newCustomer = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customer)
      .values({
        name: values.name,
        taxId: values.taxId || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        authOrganizationId: orgResult.id,
        labOrganizationId: input.memberData.organizationId,
      })
      .returning();

    if (!created) throw new Error("Erro ao criar cliente");

    await tx.insert(customerAuditLog).values({
      customerId: created.id,
      action: "create",
      changes: {
        source: "desktop_sync",
        customer: { old: null, new: created },
      },
      performedBy: actorUserId,
    });

    return created;
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: newCustomer.id,
    remoteCustomerName: newCustomer.name,
    remoteAuthOrganizationId: newCustomer.authOrganizationId,
  });

  return {
    ok: true,
    remoteEntityId: newCustomer.id,
    remoteEntity: {
      id: newCustomer.id,
      name: newCustomer.name,
      taxId: newCustomer.taxId,
      email: newCustomer.email,
      authOrganizationId: newCustomer.authOrganizationId,
    },
  };
}

async function applyUpdateLocalCustomer(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const mappedRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  const remoteEntityId =
    typeof mappedRemoteEntityId === "number"
      ? mappedRemoteEntityId
      : getNumber(payload, "remoteId");

  if (remoteEntityId === null) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente desktop ainda nao possui ID remoto para atualizar.",
    };
  }

  const parseResult = UpdateCustomerSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop customer update event is invalid.",
    };
  }

  const values = parseResult.data;
  const [existing] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente nao encontrado para atualizacao desktop.",
    };
  }

  // REL-01 slice 2: refuse to blind-overwrite a cloud customer that advanced
  // since the desktop pulled its base (REQ-REL-SYNC-201). Legacy/null base
  // applies as today (REQ-REL-SYNC-203); equal/unchanged applies
  // (REQ-REL-SYNC-202).
  const customerStaleBase = detectStaleDesktopBase({
    baseUpdatedAt: input.event.baseUpdatedAt,
    serverUpdatedAt: existing.updatedAt,
  });
  if (customerStaleBase.diverged) {
    return buildStaleDesktopBaseConflict({
      entity: "customer",
      id: existing.id,
      serverUpdatedAtIso: customerStaleBase.serverUpdatedAtIso,
      baseUpdatedAt: customerStaleBase.baseUpdatedAt,
      remoteFields: {
        name: existing.name,
        taxId: existing.taxId,
        email: existing.email,
        phone: existing.phone,
      },
    });
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const [key, value] of Object.entries(values)) {
    const oldValue = Reflect.get(existing, key);
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      changes[key] = { old: oldValue, new: value };
    }
  }

  const updatedCustomer = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customer)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customer.id, remoteEntityId),
          eq(customer.labOrganizationId, input.memberData.organizationId),
        ),
      )
      .returning();

    if (!updated) throw new Error("Erro ao atualizar cliente");

    if (Object.keys(changes).length > 0) {
      await tx.insert(customerAuditLog).values({
        customerId: remoteEntityId,
        action: "update",
        changes: {
          source: "desktop_sync",
          fields: changes,
        },
        performedBy: actorUserId,
      });
    }

    return updated;
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: updatedCustomer.id,
    remoteCustomerName: updatedCustomer.name,
  });

  return {
    ok: true,
    remoteEntityId: updatedCustomer.id,
    remoteEntity: {
      id: updatedCustomer.id,
      name: updatedCustomer.name,
      taxId: updatedCustomer.taxId,
      email: updatedCustomer.email,
      authOrganizationId: updatedCustomer.authOrganizationId,
      // REL-01 slice 3 (REQ-REL-RES-002): carry the persisted updatedAt so the
      // desktop refreshes remote_base_updated_at on accept.
      updatedAt:
        updatedCustomer.updatedAt?.toISOString?.() ?? updatedCustomer.updatedAt,
    },
  };
}

async function applyUpdateLocalCustomerCompliance(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const mappedRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  const remoteEntityId =
    typeof mappedRemoteEntityId === "number"
      ? mappedRemoteEntityId
      : getNumber(payload, "remoteId");

  if (remoteEntityId === null) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente desktop ainda nao possui ID remoto para conformidade.",
    };
  }

  const parseResult = UpdateComplianceSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop customer compliance event is invalid.",
    };
  }

  const { compliance, reason } = parseResult.data;
  const [existing] = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Cliente nao encontrado para conformidade desktop.",
    };
  }

  const baseCompliance = existing.compliance ?? {
    qualificationStatus: "pending" as const,
    qualityRequirementsAcknowledged: false,
  };
  const mergedCompliance = {
    ...baseCompliance,
    ...compliance,
    qualificationStatus:
      compliance.qualificationStatus ??
      baseCompliance.qualificationStatus ??
      ("pending" as const),
    qualityRequirementsAcknowledged:
      compliance.qualityRequirementsAcknowledged ??
      baseCompliance.qualityRequirementsAcknowledged ??
      false,
    ...(compliance.qualityRequirementsAcknowledged &&
    !baseCompliance.qualityRequirementsAcknowledged
      ? { qualityRequirementsAcknowledgedAt: new Date().toISOString() }
      : {}),
  };
  const activeCommercialAgreement = await loadCustomerActiveCommercialAgreement(
    input.memberData.organizationId,
    remoteEntityId,
  );
  const updatedCompliance = syncComplianceWithActiveAgreement(
    mergedCompliance,
    activeCommercialAgreement,
  );

  const [updatedCustomer] = await db
    .update(customer)
    .set({
      compliance: updatedCompliance,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(customer.id, remoteEntityId),
        eq(customer.labOrganizationId, input.memberData.organizationId),
      ),
    )
    .returning();

  if (!updatedCustomer) throw new Error("Erro ao atualizar conformidade");

  await db.insert(customerAuditLog).values({
    customerId: remoteEntityId,
    action: "compliance_change",
    changes: { old: existing.compliance, new: updatedCompliance },
    performedBy: actorUserId,
    reason,
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: updatedCustomer.id,
    remoteCustomerName: updatedCustomer.name,
  });

  return {
    ok: true,
    remoteEntityId: updatedCustomer.id,
    remoteEntity: {
      id: updatedCustomer.id,
      name: updatedCustomer.name,
      taxId: updatedCustomer.taxId,
      email: updatedCustomer.email,
      compliance: updatedCustomer.compliance,
    },
  };
}

async function applyLocalJobExecution(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const mappedRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  const remoteEntityId =
    typeof mappedRemoteEntityId === "number"
      ? mappedRemoteEntityId
      : getNumber(payload, "remoteId");

  if (typeof remoteEntityId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason: "Desktop execution event has no synced cloud job mapping.",
    };
  }

  const [existing] = await db
    .select()
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, remoteEntityId),
        eq(calibrationJob.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, input.memberData),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason: "Cloud job for desktop execution event was not found.",
    };
  }

  if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
    return {
      ok: false,
      code: "INVALID_STATUS_TRANSITION",
      reason: `Cannot apply desktop execution to job with status ${existing.status}.`,
      conflict: {
        conflictType: "status_transition",
        remotePayload: {
          id: existing.id,
          jobId: existing.jobId,
          status: existing.status,
          updatedAt:
            existing.updatedAt instanceof Date
              ? existing.updatedAt.toISOString()
              : existing.updatedAt,
        },
      },
    };
  }

  const nextStatus =
    input.event.operation === "submit_local_execution"
      ? "REVIEW"
      : (getJobStatus(payload, "status") ?? "IN_PROGRESS");
  const nextData = getRecordOrNull(payload, "data") ?? {};
  const standardsSnapshotResult = hasOwn(payload, "standardsSnapshot")
    ? getStandardSnapshotsResult(payload, "standardsSnapshot")
    : { ok: true as const, value: existing.standardsSnapshot };
  if (!standardsSnapshotResult.ok) {
    return {
      ok: false,
      code: "INVALID_STANDARD_SNAPSHOT",
      reason: standardsSnapshotResult.reason,
    };
  }
  const nextStandardsSnapshot = standardsSnapshotResult.value;
  const nextEnvironmentalSnapshot = hasOwn(payload, "environmentalSnapshot")
    ? getEnvironmentalSnapshotOrNull(payload, "environmentalSnapshot")
    : existing.environmentalSnapshot;
  const nextCalibrationLocationSnapshot = hasOwn(
    payload,
    "calibrationLocationSnapshot",
  )
    ? getCalibrationLocationSnapshotOrNull(
        payload,
        "calibrationLocationSnapshot",
      )
    : existing.calibrationLocationSnapshot;
  const nextCalibrationPhaseSnapshot = hasOwn(
    payload,
    "calibrationPhaseSnapshot",
  )
    ? getCalibrationPhaseSnapshotOrNull(payload, "calibrationPhaseSnapshot")
    : existing.calibrationPhaseSnapshot;
  const standardsValidation = await validateDesktopExecutionStandardsSnapshot(
    nextStandardsSnapshot,
    nextData,
    input.memberData,
  );

  if (!standardsValidation.ok) {
    return {
      ok: false,
      code: standardsValidation.code,
      reason: standardsValidation.reason,
    };
  }

  const officialExecution = await executeOfficialDesktopSyncSnapshot({
    methodSnapshot: existing.methodSnapshot,
    data: nextData,
    assetSnapshot: existing.assetSnapshot,
    standardsSnapshot: nextStandardsSnapshot,
    environmentalSnapshot: nextEnvironmentalSnapshot,
    calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
  });

  if (!officialExecution.ok) {
    return {
      ok: false,
      code: officialExecution.code,
      reason: officialExecution.reason,
    };
  }

  const submittedResults = getRecordOrNull(payload, "results");
  const nextResults = officialExecution.results;
  const compiledExecution = asRecord(nextResults.__compiledExecution);

  const [updated] = await db
    .update(calibrationJob)
    .set({
      data: nextData,
      results: nextResults,
      standardsSnapshot: nextStandardsSnapshot,
      environmentalSnapshot: nextEnvironmentalSnapshot,
      calibrationLocationSnapshot: nextCalibrationLocationSnapshot,
      calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
      status: nextStatus,
      performedAt: nextStatus === "REVIEW" ? new Date() : existing.performedAt,
      updatedAt: new Date(),
    })
    .where(eq(calibrationJob.id, existing.id))
    .returning();

  // Reverse traceability (#426 Phase 1): mirror the frozen snapshot into the
  // indexed job_standard projection.
  await syncJobStandardLinks(
    existing.id,
    nextStandardsSnapshot,
    updated?.performedAt ?? existing.performedAt,
  );

  await db.insert(jobAuditLog).values({
    jobId: existing.id,
    action:
      input.event.operation === "submit_local_execution" ? "submit" : "execute",
    changes: {
      source: "desktop_sync",
      status: { old: existing.status, new: updated?.status ?? nextStatus },
      data: { old: existing.data, new: nextData },
      results: { old: existing.results, new: nextResults },
      desktopSubmittedResults: submittedResults,
      officialExecution: {
        methodFingerprint: compiledExecution.methodFingerprint ?? null,
        resultFingerprint: compiledExecution.resultFingerprint ?? null,
      },
      standardsSnapshot: {
        old: existing.standardsSnapshot,
        new: nextStandardsSnapshot,
      },
      environmentalSnapshot: {
        old: existing.environmentalSnapshot,
        new: nextEnvironmentalSnapshot,
      },
      calibrationLocationSnapshot: {
        old: existing.calibrationLocationSnapshot,
        new: nextCalibrationLocationSnapshot,
      },
      calibrationPhaseSnapshot: {
        old: existing.calibrationPhaseSnapshot,
        new: nextCalibrationPhaseSnapshot,
      },
    },
    performedBy: actorUserId,
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: existing.id,
    remoteJobId: existing.jobId,
  });

  return {
    ok: true,
    remoteEntityId: existing.id,
    remoteEntity: {
      id: existing.id,
      jobId: existing.jobId,
      status: updated?.status ?? nextStatus,
      performedAt:
        updated?.performedAt?.toISOString?.() ??
        existing.performedAt?.toISOString?.() ??
        null,
    },
  };
}

async function validateDesktopExecutionStandardsSnapshot(
  standardsSnapshot: StandardSnapshot[] | null,
  data: Record<string, unknown>,
  memberData: MemberData,
): Promise<
  | { ok: true }
  | {
      ok: false;
      code: string;
      reason: string;
    }
> {
  const compositionStandardIds = collectCompositionStandardIds(data);

  if (!standardsSnapshot || standardsSnapshot.length === 0) {
    if (compositionStandardIds.length > 0) {
      return {
        ok: false,
        code: "INVALID_STANDARD_SNAPSHOT",
        reason: `Desktop execution mass composition references standards missing from standardsSnapshot: ${compositionStandardIds.join(", ")}.`,
      };
    }
    return { ok: true };
  }

  const selectedStandardIds = standardsSnapshot.map((standard) => standard.id);
  const invalidIds = selectedStandardIds.filter((id) => !isIntegerNumber(id));

  if (invalidIds.length > 0) {
    return {
      ok: false,
      code: "INVALID_STANDARD_SNAPSHOT",
      reason: "Desktop execution standard snapshot contains invalid ids.",
    };
  }

  const uniqueIds = [...new Set(selectedStandardIds.filter(isIntegerNumber))];
  const snapshotsById = new Map(
    standardsSnapshot
      .filter((standard) => isIntegerNumber(standard.id))
      .map((standard) => [standard.id, standard]),
  );
  const compositionIdsMissingSnapshot = compositionStandardIds.filter(
    (standardId) => !snapshotsById.has(standardId),
  );
  if (compositionIdsMissingSnapshot.length > 0) {
    return {
      ok: false,
      code: "INVALID_STANDARD_SNAPSHOT",
      reason: `Desktop execution mass composition references standards missing from standardsSnapshot: ${compositionIdsMissingSnapshot.join(", ")}.`,
    };
  }

  const compositionIdsMissingCertifiedValues = compositionStandardIds.filter(
    (standardId) =>
      !((snapshotsById.get(standardId)?.certifiedValues?.length ?? 0) > 0),
  );
  if (compositionIdsMissingCertifiedValues.length > 0) {
    return {
      ok: false,
      code: "STANDARD_CERTIFIED_VALUES_MISSING",
      reason: `Desktop execution mass composition references standards without certified values: ${compositionIdsMissingCertifiedValues.join(", ")}.`,
    };
  }

  const standards = await db
    .select({
      id: referenceStandard.id,
      name: referenceStandard.name,
      status: referenceStandard.status,
      nextCalibrationDate: referenceStandard.nextCalibrationDate,
    })
    .from(referenceStandard)
    .where(
      and(
        inArray(referenceStandard.id, uniqueIds),
        eq(referenceStandard.organizationId, memberData.organizationId),
        buildUnitScopeCondition(referenceStandard.unitId, memberData),
        isNull(referenceStandard.deletedAt),
      ),
    );

  if (standards.length !== uniqueIds.length) {
    const foundIds = new Set(standards.map((standard) => standard.id));
    const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
    return {
      ok: false,
      code: "STANDARD_SCOPE_MISMATCH",
      reason: `Desktop execution references standards that are missing or outside scope: ${missingIds.join(", ")}.`,
    };
  }

  const inactiveStandards = standards.filter(
    (standard) => standard.status !== "ACTIVE",
  );
  if (inactiveStandards.length > 0) {
    return {
      ok: false,
      code: "STANDARD_NOT_ACTIVE",
      reason: `Desktop execution references inactive standards: ${inactiveStandards.map((standard) => standard.name).join(", ")}.`,
    };
  }

  const now = new Date();
  const expiredStandards = standards.filter((standard) => {
    const nextCalibrationDate =
      standard.nextCalibrationDate instanceof Date
        ? standard.nextCalibrationDate
        : new Date(standard.nextCalibrationDate);

    return Number.isFinite(nextCalibrationDate.getTime())
      ? nextCalibrationDate < now
      : true;
  });

  if (expiredStandards.length > 0) {
    return {
      ok: false,
      code: "STANDARD_EXPIRED",
      reason: `Desktop execution references expired standards: ${expiredStandards.map((standard) => standard.name).join(", ")}.`,
    };
  }

  return { ok: true };
}

async function applyCreateLocalServiceOrderIntake(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const parseResult = CreateServiceOrderSchema.safeParse(
    stripDesktopNullEntries(payload, DESKTOP_SERVICE_ORDER_NULLABLE_KEYS),
  );
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order intake event is invalid.",
    };
  }

  const values = parseResult.data;
  const unitId =
    input.event.unitId ??
    getNumber(payload, "unitId") ??
    input.memberData.activeUnitId ??
    input.memberData.accessibleUnitIds[0];
  if (!unitId) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop service-order intake event is missing a unit.",
    };
  }

  const [assetRow] = await db
    .select({
      id: asset.id,
      unitId: asset.unitId,
      customerId: asset.customerId,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(eq(asset.id, values.assetId))
    .limit(1);

  if (
    !assetRow ||
    assetRow.customerId !== values.customerId ||
    assetRow.labOrganizationId !== input.memberData.organizationId ||
    !input.memberData.accessibleUnitIds.includes(unitId)
  ) {
    return {
      ok: false,
      code: "DOMAIN_VALIDATION_FAILED",
      reason: "Ativo ou cliente invalido para esta OS",
    };
  }

  const created = await createInitialServiceOrderRecords({
    organizationId: input.memberData.organizationId,
    unitId,
    customerId: values.customerId,
    assetId: values.assetId,
    userId: actorUserId,
    // Desktop payloads send an absent snapshot as explicit null; the intake
    // creator expects undefined for "none".
    assetSnapshot: values.assetSnapshot ?? undefined,
    signatureData: values.signatureData ?? null,
    values: {
      clientContactId: values.clientContactId ?? null,
      clientContactSnapshot: values.clientContactSnapshot ?? null,
      intakeType: values.intakeType,
      sourceServiceOrderId: values.sourceServiceOrderId ?? null,
      priority: values.priority,
      responsibleTechnicianId: values.responsibleTechnicianId ?? null,
      claimedDefect: values.claimedDefect,
      intakeCondition: values.intakeCondition,
      accessories: values.accessories ?? null,
      removedSealingMarkNumber: values.removedSealingMarkNumber ?? null,
      affixedSealingMarkNumber: values.affixedSealingMarkNumber ?? null,
      inmetroRepairMarkNumber: values.inmetroRepairMarkNumber ?? null,
      invoiceRemittanceNumber: values.invoiceRemittanceNumber ?? null,
      invoiceRemittanceKey: values.invoiceRemittanceKey ?? null,
      invoiceRemittanceIssuedAt: parseSyncDate(
        values.invoiceRemittanceIssuedAt,
      ),
      carrierName: values.carrierName ?? null,
      carrierDocument: values.carrierDocument ?? null,
      thirdPartyName: values.thirdPartyName ?? null,
      thirdPartyDocument: values.thirdPartyDocument ?? null,
      thirdPartyPhone: values.thirdPartyPhone ?? null,
      deliveryMethod: values.deliveryMethod,
      internalNotes: values.internalNotes ?? null,
      clientVisibleNotes: values.clientVisibleNotes ?? null,
      evaluationFeeCents: values.evaluationFeeCents,
      warrantyUntil: parseSyncDate(values.warrantyUntil),
      warrantyTerms: values.warrantyTerms ?? null,
    },
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: created.id,
    remoteServiceOrderNumber: created.serviceOrderNumber,
  });

  return {
    ok: true,
    remoteEntityId: created.id,
    remoteEntity: {
      id: created.id,
      serviceOrderNumber: created.serviceOrderNumber,
      status: created.status,
      openedAt: created.openedAt?.toISOString?.() ?? created.openedAt,
    },
  };
}

// #426 Phase 0: NC captured offline on the desktop. Reuses the shared cloud
// creator so the synced NC gets the same number sequence, audit-log entry and
// admin/owner notification as an online creation. When the NC is
// out-of-tolerance-typed with a job link, the §7.10 customer notification is
// created SERVER-SIDE here (outbox row + PDF job) — the desktop outbox carries
// only the data mutation, and the email dispatches on reconnect.
async function applyCreateLocalNonConformance(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const parseResult = CreateNonConformanceSchema.safeParse(
    stripDesktopNullEntries(payload, ["jobId"]),
  );
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop non-conformance event is invalid.",
    };
  }

  const values = parseResult.data;
  const detectedAt = new Date(values.detectedAt);
  if (Number.isNaN(detectedAt.getTime())) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason: "Desktop non-conformance event has an invalid detectedAt.",
    };
  }

  if (values.jobId) {
    const [job] = await db
      .select({ id: calibrationJob.id })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.id, values.jobId),
          eq(calibrationJob.organizationId, input.memberData.organizationId),
        ),
      )
      .limit(1);
    if (!job) {
      return {
        ok: false,
        code: "DOMAIN_VALIDATION_FAILED",
        reason: "Calibracao invalida para esta nao conformidade",
      };
    }
  }

  const created = await createNonConformanceRecord({
    organizationId: input.memberData.organizationId,
    actorUserId,
    type: values.type,
    description: values.description,
    detectedAt,
    jobId: values.jobId ?? null,
    triggerSource: "manual",
    auditChanges: { initial: values, source: "desktop_sync" },
  });

  await ensureOotNotificationForNc({
    nc: created,
    organizationId: input.memberData.organizationId,
    actorUserId,
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: created.id,
    remoteNcNumber: created.ncNumber,
  });

  return {
    ok: true,
    remoteEntityId: created.id,
    remoteEntity: {
      id: created.id,
      ncNumber: created.ncNumber,
      status: created.status,
      detectedAt: created.detectedAt.toISOString(),
    },
  };
}

async function applyCreateLocalServiceOrderQuoteDraft(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const remoteServiceOrderId = await getRemoteServiceOrderIdFromPayload(
    input,
    payload,
  );
  if (typeof remoteServiceOrderId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason: "Desktop service-order quote has no synced cloud OS mapping.",
    };
  }

  const parseResult = CreateServiceOrderQuoteSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order quote event is invalid.",
    };
  }

  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, remoteServiceOrderId),
        eq(serviceOrder.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.memberData),
      ),
    )
    .limit(1);
  if (!order) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason: "Cloud service order for desktop quote was not found.",
    };
  }

  const values = parseResult.data;
  const [latest] = await db
    .select({ version: serviceOrderQuote.version })
    .from(serviceOrderQuote)
    .where(eq(serviceOrderQuote.serviceOrderId, order.id))
    .orderBy(desc(serviceOrderQuote.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const quote = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(serviceOrderQuote)
      .values({
        serviceOrderId: order.id,
        quoteNumber: `${order.serviceOrderNumber}/ORC`,
        version,
        validUntil: parseSyncDate(values.validUntil),
        paymentTerms: values.paymentTerms ?? null,
        deliveryEstimate: values.deliveryEstimate ?? null,
        warrantyTerms: values.warrantyTerms ?? null,
        clientMessage: values.clientMessage ?? null,
        internalNotes: values.internalNotes ?? null,
        createdByUserId: actorUserId,
      })
      .returning();
    if (!created) throw new Error("Falha ao criar orcamento");

    const totals = await replaceQuoteItems(
      {
        organizationId: order.organizationId,
        quoteId: created.id,
        items: values.items.map((item) => ({
          ...item,
          warrantyUntil: parseSyncDate(item.warrantyUntil),
        })),
      },
      tx,
    );
    await tx
      .update(serviceOrderQuote)
      .set({
        subtotalServicesCents: totals.subtotalServicesCents,
        subtotalPartsCents: totals.subtotalPartsCents,
        discountCents: totals.discountCents,
        freightCents: totals.freightCents,
        totalCents: totals.totalCents,
      })
      .where(eq(serviceOrderQuote.id, created.id));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: order.id,
        actorType: "lab_user",
        actorId: actorUserId,
        eventType: "service_order.quote_created",
        metadata: {
          quoteId: created.id,
          version,
          source: "desktop_sync",
        },
      },
      tx,
    );

    return { ...created, ...totals };
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: quote.id,
    remoteServiceOrderId: order.id,
    remoteQuoteNumber: quote.quoteNumber,
  });

  return {
    ok: true,
    remoteEntityId: quote.id,
    remoteEntity: {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      version: quote.version,
      status: quote.status,
      totalCents: quote.totalCents,
    },
  };
}

async function applyLocalServiceOrderExecutionNotes(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const payload = asRecord(input.event.payload);
  const remoteServiceOrderId = await getRemoteServiceOrderIdFromPayload(
    input,
    payload,
  );
  if (typeof remoteServiceOrderId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason: "Desktop service-order execution has no synced cloud OS mapping.",
    };
  }

  const parseResult =
    DesktopUpdateServiceOrderExecutionSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order execution event is invalid.",
    };
  }

  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, remoteServiceOrderId),
        eq(serviceOrder.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.memberData),
      ),
    )
    .limit(1);
  if (!order) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason: "Cloud service order for desktop execution was not found.",
    };
  }

  // REL-01 slice 2: refuse to blind-overwrite an execution row that advanced
  // since the desktop pulled its base (REQ-REL-SYNC-201). When no execution row
  // exists yet there is nothing to diverge from (this apply creates it). The
  // base is anchored to the `service_order_executions` row; legacy/null base
  // applies as today (REQ-REL-SYNC-203), equal/unchanged applies
  // (REQ-REL-SYNC-202). Checked before the write transaction so a conflict
  // leaves the row byte-unchanged.
  const [existingExecution] = await db
    .select({
      id: serviceOrderExecution.id,
      updatedAt: serviceOrderExecution.updatedAt,
      servicePerformed: serviceOrderExecution.servicePerformed,
      partsUsedSummary: serviceOrderExecution.partsUsedSummary,
      technicalNotes: serviceOrderExecution.technicalNotes,
      calibrationRequiredAfterRepair:
        serviceOrderExecution.calibrationRequiredAfterRepair,
      result: serviceOrderExecution.result,
    })
    .from(serviceOrderExecution)
    .where(eq(serviceOrderExecution.serviceOrderId, order.id))
    .limit(1);
  if (existingExecution) {
    const executionStaleBase = detectStaleDesktopBase({
      baseUpdatedAt: input.event.baseUpdatedAt,
      serverUpdatedAt: existingExecution.updatedAt,
    });
    if (executionStaleBase.diverged) {
      return buildStaleDesktopBaseConflict({
        entity: "service_order_execution",
        id: existingExecution.id,
        serverUpdatedAtIso: executionStaleBase.serverUpdatedAtIso,
        baseUpdatedAt: executionStaleBase.baseUpdatedAt,
        remoteFields: {
          servicePerformed: existingExecution.servicePerformed,
          partsUsedSummary: existingExecution.partsUsedSummary,
          technicalNotes: existingExecution.technicalNotes,
          calibrationRequiredAfterRepair:
            existingExecution.calibrationRequiredAfterRepair,
          result: existingExecution.result,
        },
      });
    }
  }

  const values = parseResult.data;
  const execution = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(serviceOrderExecution)
      .where(eq(serviceOrderExecution.serviceOrderId, order.id))
      .limit(1);
    const [current] =
      existing !== undefined
        ? [existing]
        : await tx
            .insert(serviceOrderExecution)
            .values({
              serviceOrderId: order.id,
              startedByUserId: actorUserId,
              technicalNotes: values.technicalNotes ?? null,
            })
            .returning();
    if (!current) throw new Error("Falha ao criar execucao");

    if (values.items) {
      await replaceExecutionItems(
        {
          organizationId: order.organizationId,
          executionId: current.id,
          items: values.items.map((item) => ({
            ...item,
            warrantyUntil: parseSyncDate(item.warrantyUntil),
          })),
        },
        tx,
      );
    }

    const [updated] = await tx
      .update(serviceOrderExecution)
      .set({
        servicePerformed: values.servicePerformed,
        partsUsedSummary: values.partsUsedSummary,
        technicalNotes: values.technicalNotes,
        calibrationRequiredAfterRepair: values.calibrationRequiredAfterRepair,
        result: values.result,
        updatedAt: new Date(),
      })
      .where(eq(serviceOrderExecution.id, current.id))
      .returning();
    await tx
      .update(serviceOrder)
      .set({
        status: "repair_in_progress",
        repairStartedAt: order.repairStartedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(serviceOrder.id, order.id));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: order.id,
        actorType: "lab_user",
        actorId: actorUserId,
        eventType: "service_order.repair_started",
        metadata: { source: "desktop_sync", executionId: current.id },
      },
      tx,
    );

    return updated ?? current;
  });

  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: execution.id,
    remoteServiceOrderId: order.id,
  });

  return {
    ok: true,
    remoteEntityId: execution.id,
    remoteEntity: {
      id: execution.id,
      status: "repair_in_progress",
      serviceOrderId: order.id,
      startedAt: execution.startedAt?.toISOString?.() ?? execution.startedAt,
      updatedAt: execution.updatedAt?.toISOString?.() ?? execution.updatedAt,
    },
  };
}

async function applyCreateLocalServiceOrderDeliveryDocumentDraft(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
): Promise<ApplyDesktopSyncEventResult> {
  const existingRemoteEntityId = await findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    input.event.entityId,
  );
  if (existingRemoteEntityId !== null) {
    return { ok: true, remoteEntityId: existingRemoteEntityId };
  }

  const payload = asRecord(input.event.payload);
  const remoteServiceOrderId = await getRemoteServiceOrderIdFromPayload(
    input,
    payload,
  );
  if (typeof remoteServiceOrderId !== "number") {
    return {
      ok: false,
      code: "REMOTE_ENTITY_MAPPING_MISSING",
      reason:
        "Desktop service-order delivery document has no synced cloud OS mapping.",
    };
  }

  const parseResult =
    IssueServiceOrderDeliveryDocumentSchema.safeParse(payload);
  if (!parseResult.success) {
    return {
      ok: false,
      code: "INVALID_DESKTOP_EVENT_PAYLOAD",
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop service-order delivery document event is invalid.",
    };
  }

  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, remoteServiceOrderId),
        eq(serviceOrder.organizationId, input.memberData.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.memberData),
      ),
    )
    .limit(1);
  if (!order) {
    return {
      ok: false,
      code: "REMOTE_ENTITY_NOT_FOUND",
      reason:
        "Cloud service order for desktop delivery document was not found.",
    };
  }

  const values = parseResult.data;
  const [latest] = await db
    .select({ version: serviceOrderDeliveryDocument.version })
    .from(serviceOrderDeliveryDocument)
    .where(eq(serviceOrderDeliveryDocument.serviceOrderId, order.id))
    .orderBy(desc(serviceOrderDeliveryDocument.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const [document] = await db
    .insert(serviceOrderDeliveryDocument)
    .values({
      serviceOrderId: order.id,
      documentNumber: `${order.serviceOrderNumber}/ENT`,
      version,
      issuedAt: new Date(),
      issuedByUserId: actorUserId,
      technicianSignatureData: values.technicianSignatureData ?? null,
      clientSignatureData: values.clientSignatureData ?? null,
    })
    .returning();
  if (!document) throw new Error("Falha ao criar documento de entrega");

  await recordServiceOrderEvent({
    organizationId: order.organizationId,
    unitId: order.unitId,
    serviceOrderId: order.id,
    actorType: "lab_user",
    actorId: actorUserId,
    eventType: "service_order.delivery_document_issued",
    metadata: {
      source: "desktop_sync",
      deliveryDocumentId: document.id,
      version,
    },
  });
  await writeDesktopSyncAudit(input, actorUserId, {
    remoteEntityId: document.id,
    remoteServiceOrderId: order.id,
    remoteDocumentNumber: document.documentNumber,
  });

  return {
    ok: true,
    remoteEntityId: document.id,
    remoteEntity: {
      id: document.id,
      documentNumber: document.documentNumber,
      version: document.version,
      issuedAt: document.issuedAt?.toISOString?.() ?? document.issuedAt,
    },
  };
}

async function executeOfficialDesktopSyncSnapshot(params: {
  methodSnapshot: MethodSnapshot | null;
  data: Record<string, unknown>;
  assetSnapshot: AssetSnapshot | null;
  standardsSnapshot: StandardSnapshot[] | null;
  environmentalSnapshot: EnvironmentalSnapshot | null;
  calibrationPhaseSnapshot: CalibrationPhaseSnapshot | null;
}): Promise<
  | { ok: true; results: Record<string, unknown> }
  | {
      ok: false;
      code: string;
      reason: string;
      diagnostics: MethodDiagnostic[];
    }
> {
  if (!params.methodSnapshot || !params.assetSnapshot) {
    return {
      ok: false,
      code: "COMPILED_METHOD_SNAPSHOT_REQUIRED",
      reason:
        "Desktop execution sync requires frozen method and asset snapshots.",
      diagnostics: [],
    };
  }

  const methodSnapshot = params.methodSnapshot;
  const assetSnapshot = params.assetSnapshot;
  const compiled = getCompiledMethodSnapshot(methodSnapshot);
  if (!compiled.ok) {
    return {
      ok: false,
      code: "COMPILED_METHOD_SNAPSHOT_INVALID",
      reason: compiled.reason,
      diagnostics: compiled.diagnostics,
    };
  }

  const execution = executeCompiledMethod(
    compiled.compiledMethod,
    {
      inputs: buildOfficialExecutionInputs({
        ...params,
        methodSnapshot,
        assetSnapshot,
      }),
      calibrationPhases: params.calibrationPhaseSnapshot ?? undefined,
    },
    { engine: await createMethodExecutionEngine() },
  );

  if (!execution.ok) {
    return {
      ok: false,
      code: "OFFICIAL_EXECUTION_FAILED",
      reason:
        execution.diagnostics.find((item) => item.severity === "error")
          ?.message ?? "Cloud verification of desktop execution failed.",
      diagnostics: execution.diagnostics,
    };
  }

  return {
    ok: true,
    results: {
      ...execution.outputs,
      __compiledExecution: {
        methodFingerprint: execution.methodFingerprint,
        engineVersion: execution.engineVersion,
        engineOptionsFingerprint: execution.engineOptionsFingerprint,
        inputFingerprint: execution.inputFingerprint,
        calculationFingerprint: execution.calculationFingerprint,
        resultFingerprint: execution.resultFingerprint,
        canonicalResultJson: execution.canonicalResultJson,
        formulaResults: execution.formulaResults,
        measurementModelResults: execution.measurementModelResults,
        acceptanceCriteriaResults: execution.acceptanceCriteriaResults,
        diagnostics: execution.diagnostics,
      },
    },
  };
}

function getCompiledMethodSnapshot(
  methodSnapshot: MethodSnapshot,
):
  | { ok: true; compiledMethod: CompiledMethod }
  | { ok: false; diagnostics: MethodDiagnostic[]; reason: string } {
  const compiledMethod = methodSnapshot.compiledMethod;
  if (
    !compiledMethod ||
    typeof compiledMethod !== "object" ||
    Array.isArray(compiledMethod) ||
    !methodSnapshot.methodFingerprint ||
    !methodSnapshot.engineVersion ||
    !methodSnapshot.engineOptionsFingerprint ||
    !methodSnapshot.normalizedMethodJson
  ) {
    const reason =
      "Compiled method snapshot is required for desktop execution sync.";
    return {
      ok: false,
      reason,
      diagnostics: [
        methodDiagnostic(
          "COMPILED_METHOD_SNAPSHOT_REQUIRED",
          reason,
          "methodSnapshot.compiledMethod",
        ),
      ],
    };
  }

  if (!isCompiledMethodCandidate(compiledMethod)) {
    const reason = "Compiled method snapshot has an invalid shape.";
    return {
      ok: false,
      reason,
      diagnostics: [
        methodDiagnostic(
          "COMPILED_METHOD_SNAPSHOT_INVALID",
          reason,
          "methodSnapshot.compiledMethod",
        ),
      ],
    };
  }
  const candidate = compiledMethod;

  const mismatches: MethodDiagnostic[] = [];
  if (candidate.methodFingerprint !== methodSnapshot.methodFingerprint) {
    mismatches.push(
      methodDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Compiled method fingerprint differs from the job snapshot.",
        "methodSnapshot.methodFingerprint",
      ),
    );
  }

  if (candidate.engine.version !== methodSnapshot.engineVersion) {
    mismatches.push(
      methodDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Compiled engine version differs from the job snapshot.",
        "methodSnapshot.engineVersion",
      ),
    );
  }

  if (
    candidate.engine.optionsFingerprint !==
    methodSnapshot.engineOptionsFingerprint
  ) {
    mismatches.push(
      methodDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Compiled engine options fingerprint differs from the job snapshot.",
        "methodSnapshot.engineOptionsFingerprint",
      ),
    );
  }

  if (candidate.normalizedMethodJson !== methodSnapshot.normalizedMethodJson) {
    mismatches.push(
      methodDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Compiled normalized method JSON differs from the job snapshot.",
        "methodSnapshot.normalizedMethodJson",
      ),
    );
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      reason: "Compiled method snapshot does not match job metadata.",
      diagnostics: mismatches,
    };
  }

  return { ok: true, compiledMethod: candidate };
}

function buildOfficialExecutionInputs(params: {
  methodSnapshot: MethodSnapshot;
  data: Record<string, unknown>;
  assetSnapshot: AssetSnapshot;
  standardsSnapshot: StandardSnapshot[] | null;
  environmentalSnapshot: EnvironmentalSnapshot | null;
}): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...params.data };

  for (const field of params.methodSnapshot.dataFields ?? []) {
    if (field.source !== "asset_spec" || !field.assetSpecKey) continue;
    const value = params.assetSnapshot.specifications?.[field.assetSpecKey];
    if (value !== undefined) {
      inputs[field.key] = value;
    }
  }

  if (params.environmentalSnapshot) {
    inputs.environment = {
      temperature: params.environmentalSnapshot.temperature,
      humidity: params.environmentalSnapshot.humidity,
      pressure: params.environmentalSnapshot.pressure,
    };
  }

  if (params.standardsSnapshot !== undefined) {
    inputs.standards =
      normalizeStandardsForOfficialExecution(params.standardsSnapshot) ?? [];
  }

  return inputs;
}

async function createMethodExecutionEngine(): Promise<CalculationEngineLike> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- math-engine v0.3.0 has narrower input parameter types than method-definition's adapter interface, but the runtime method surface is compatible.
  return createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
}

type CertificatePdfUploadFields = {
  eventId: string;
  entityId: string;
  operation: string;
  idempotencyKey: string;
  localVersion: number;
  occurredAt: string;
  actorUserId: string;
  organizationId: string;
  unitId: number | null;
  localJobId: string;
  remoteJobId: number | null;
  draftId: string;
  contentHash: string;
  sizeBytes: number;
  file: File;
};

function buildCertificatePdfUploadSyncEvent(
  upload: CertificatePdfUploadFields,
  payload: Record<string, unknown>,
): SyncEvent {
  return {
    eventId: upload.eventId,
    entityType: "certificate_draft",
    entityId: upload.entityId,
    operation: upload.operation,
    payload,
    occurredAt: upload.occurredAt,
    actorUserId: upload.actorUserId,
    organizationId: upload.organizationId,
    unitId: upload.unitId,
    idempotencyKey: upload.idempotencyKey,
    localVersion: upload.localVersion,
  };
}

function readCertificatePdfUploadFields(
  formData: FormData,
):
  | { ok: true; value: CertificatePdfUploadFields }
  | { ok: false; eventId: string; code: string; reason: string } {
  const eventId = formString(formData, "eventId") ?? "unknown";
  const file = formData.get("file");
  const localVersion = formNumber(formData, "localVersion");
  const sizeBytes = formNumber(formData, "sizeBytes");
  const remoteJobIdValue = formNumber(formData, "remoteJobId");
  const remoteJobId = Number.isInteger(remoteJobIdValue)
    ? remoteJobIdValue
    : null;
  const unitIdText = formString(formData, "unitId");
  const unitId =
    unitIdText === null || unitIdText === "" ? null : Number(unitIdText);

  if (!(file instanceof File)) {
    return {
      ok: false,
      eventId,
      code: "INVALID_CERTIFICATE_PDF_UPLOAD",
      reason: "Certificate PDF upload is missing the PDF file.",
    };
  }

  if (
    !Number.isInteger(localVersion) ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    (unitId !== null && (!Number.isInteger(unitId) || unitId <= 0))
  ) {
    return {
      ok: false,
      eventId,
      code: "INVALID_CERTIFICATE_PDF_UPLOAD",
      reason: "Certificate PDF upload has invalid numeric metadata.",
    };
  }

  const required = {
    entityId: formString(formData, "entityId"),
    operation: formString(formData, "operation"),
    idempotencyKey: formString(formData, "idempotencyKey"),
    occurredAt: formString(formData, "occurredAt"),
    actorUserId: formString(formData, "actorUserId"),
    organizationId: formString(formData, "organizationId"),
    localJobId: formString(formData, "localJobId"),
    draftId: formString(formData, "draftId"),
    contentHash: formString(formData, "contentHash"),
  };

  if (Object.values(required).some((value) => !value)) {
    return {
      ok: false,
      eventId,
      code: "INVALID_CERTIFICATE_PDF_UPLOAD",
      reason: "Certificate PDF upload is missing required metadata.",
    };
  }

  if (required.operation !== "generate_local_certificate_pdf") {
    return {
      ok: false,
      eventId,
      code: "INVALID_CERTIFICATE_PDF_UPLOAD_OPERATION",
      reason: "Certificate PDF upload operation is not supported.",
    };
  }

  if (!/^[a-f0-9]{64}$/.test(required.contentHash!)) {
    return {
      ok: false,
      eventId,
      code: "INVALID_CERTIFICATE_PDF_HASH",
      reason: "Certificate PDF upload hash is invalid.",
    };
  }

  if (file.type && file.type !== "application/pdf") {
    return {
      ok: false,
      eventId,
      code: "INVALID_CERTIFICATE_PDF_CONTENT_TYPE",
      reason: "Certificate PDF upload must be application/pdf.",
    };
  }

  return {
    ok: true,
    value: {
      eventId,
      entityId: required.entityId!,
      operation: required.operation!,
      idempotencyKey: required.idempotencyKey!,
      localVersion,
      occurredAt: required.occurredAt!,
      actorUserId: required.actorUserId!,
      organizationId: required.organizationId!,
      unitId,
      localJobId: required.localJobId!,
      remoteJobId,
      draftId: required.draftId!,
      contentHash: required.contentHash!,
      sizeBytes,
      file,
    },
  };
}

// Desktop-originated certs and sync attachments are part of the offline
// subsystem: they stay in the documents bucket and use the id-only org
// partition (slug omitted). The attachment key also round-trips as the opaque
// attachment id, so its byte layout must stay stable — org ids are URL-safe,
// so the shared builder produces the same string as the previous local one.
function buildDesktopCertificatePdfKey(input: {
  organizationId: string;
  year: number;
  jobId: string;
  draftId: string;
}) {
  return desktopCertificatePdfKey({
    org: { id: input.organizationId, slug: "" },
    year: input.year,
    jobId: input.jobId,
    draftId: input.draftId,
  }).key;
}

function methodDiagnostic(
  code: string,
  message: string,
  path: string,
): MethodDiagnostic {
  return {
    code,
    severity: "error",
    message,
    path,
  };
}

async function findDesktopSyncRemoteEntityId(
  organizationId: string,
  localEntityId: string,
) {
  const rows = await db
    .select({
      details: organizationEventLog.details,
    })
    .from(organizationEventLog)
    .where(
      and(
        eq(organizationEventLog.organizationId, organizationId),
        eq(organizationEventLog.entityId, localEntityId),
      ),
    )
    .limit(20);

  for (const row of rows) {
    const details = asRecord(row.details);
    const remoteEntityId = details.remoteEntityId;
    if (
      typeof remoteEntityId === "number" ||
      typeof remoteEntityId === "string"
    ) {
      return remoteEntityId;
    }
  }

  return null;
}

async function findAppliedDesktopSyncEvent(
  organizationId: string,
  event: SyncEvent,
) {
  const rows = await db
    .select({
      details: organizationEventLog.details,
    })
    .from(organizationEventLog)
    .where(
      and(
        eq(organizationEventLog.organizationId, organizationId),
        eq(organizationEventLog.entityId, event.entityId),
      ),
    )
    .limit(100);

  for (const row of rows) {
    const details = asRecord(row.details);
    if (details.eventId !== event.eventId) continue;

    const remoteEntityId = details.remoteEntityId;
    return {
      remoteEntityId:
        typeof remoteEntityId === "number" || typeof remoteEntityId === "string"
          ? remoteEntityId
          : undefined,
      remoteEntity: details.remoteEntity,
    };
  }

  return null;
}

async function getRemoteServiceOrderIdFromPayload(
  input: ApplyDesktopSyncEventInput,
  payload: Record<string, unknown>,
) {
  const localServiceOrderId = getNullableString(payload, "serviceOrderId");
  if (!localServiceOrderId) return null;

  return findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    localServiceOrderId,
  );
}

async function writeDesktopSyncAudit(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
  details: Record<string, unknown> = {},
) {
  await writeOrganizationAuditEvent({
    organizationId: input.memberData.organizationId,
    unitId: input.event.unitId,
    actorUserId,
    actorMemberId: input.memberData.id,
    action: `desktop_sync.${input.event.operation}`,
    entityType: input.event.entityType,
    entityId: input.event.entityId,
    details: {
      eventId: input.event.eventId,
      deviceId: input.deviceId,
      clientBatchId: input.clientBatchId,
      idempotencyKey: input.event.idempotencyKey,
      localVersion: input.event.localVersion,
      payload: input.event.payload,
      localEntityId: input.event.entityId,
      // Keep the offline-actor vs pushing-user discrepancy visible in the
      // audit trail (the actor was validated as an org member at push time).
      ...(actorUserId !== input.sessionUserId
        ? { pushedByUserId: input.sessionUserId }
        : {}),
      ...details,
    },
  });
}

function getSyncActorUserId(event: SyncEvent, fallbackUserId: string) {
  return event.actorUserId && event.actorUserId !== "local"
    ? event.actorUserId
    : fallbackUserId;
}

function getClaimedSyncActorUserId(actorUserId: string | null | undefined) {
  const claimed = actorUserId?.trim();
  return claimed && claimed !== "local" ? claimed : null;
}

async function isOrganizationMemberUser(
  userId: string,
  organizationId: string,
) {
  const [record] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);

  return Boolean(record);
}

/**
 * Desktop sync events carry a client-asserted actorUserId (who performed the
 * work offline). The pushing session proves org/unit scope, but the actor id
 * itself must not be taken on faith: an arbitrary value would let a tampered
 * client attribute creations/executions/approvals to someone else in the
 * audit trail. Policy: the claimed actor must be the authenticated user or a
 * member of the active organization (device-handoff case); anything else is
 * rejected. When the claimed actor differs from the pushing user, audit
 * entries additionally record pushedByUserId so the discrepancy stays
 * visible.
 */
async function validateSyncActorScope(
  claimedActorUserId: string | null,
  memberData: MemberData,
  sessionUserId: string,
  cache?: Map<string, boolean>,
) {
  if (!claimedActorUserId || claimedActorUserId === sessionUserId) {
    return true;
  }

  let isMember = cache?.get(claimedActorUserId);
  if (isMember === undefined) {
    isMember = await isOrganizationMemberUser(
      claimedActorUserId,
      memberData.organizationId,
    );
    cache?.set(claimedActorUserId, isMember);
  }

  return isMember;
}

function collectCompositionStandardIds(data: Record<string, unknown>) {
  const ids = new Set<number>();

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (Object.keys(record).length === 0) return;

    if (
      record.kind === "mass_standard_composition" &&
      Array.isArray(record.items)
    ) {
      for (const item of record.items) {
        const compositionItem = asRecord(item);
        const standardIds = Array.isArray(compositionItem.standardIds)
          ? compositionItem.standardIds
          : [];
        if (standardIds.length > 0) {
          for (const standardId of standardIds) {
            if (isPositiveInteger(standardId)) ids.add(standardId);
          }
        } else if (isPositiveInteger(compositionItem.standardId)) {
          ids.add(compositionItem.standardId);
        }
      }
      return;
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(data);
  return Array.from(ids);
}

function isCompiledMethodCandidate(value: unknown): value is CompiledMethod {
  const candidate = asRecord(value);
  const engine = asRecord(candidate.engine);

  return (
    candidate.status === "compiled" &&
    typeof candidate.methodFingerprint === "string" &&
    typeof engine.version === "string" &&
    typeof engine.optionsFingerprint === "string" &&
    Array.isArray(candidate.inputs) &&
    Array.isArray(candidate.formulas) &&
    Array.isArray(candidate.measurementModels) &&
    Array.isArray(candidate.acceptanceCriteria)
  );
}

function getStandardSnapshotsResult(
  row: Record<string, unknown>,
  key: string,
):
  | { ok: true; value: StandardSnapshot[] | null }
  | { ok: false; reason: string } {
  const value = row[key];
  if (value === null) return { ok: true, value: null };
  const parseResult = StandardSnapshotSchema.array().safeParse(value);
  if (!parseResult.success) {
    return {
      ok: false,
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop execution standardsSnapshot is invalid.",
    };
  }
  const normalized: StandardSnapshot[] = [];
  for (const standard of parseResult.data) {
    const calibrationDate = parseSnapshotDate(standard.calibrationDate);
    const nextCalibrationDate =
      standard.nextCalibrationDate == null
        ? null
        : parseSnapshotDate(standard.nextCalibrationDate);
    if (
      !calibrationDate ||
      (standard.nextCalibrationDate && !nextCalibrationDate)
    ) {
      return {
        ok: false,
        reason: "Desktop execution standardsSnapshot contains invalid dates.",
      };
    }

    normalized.push({
      ...standard,
      calibrationDate,
      nextCalibrationDate,
    });
  }
  return { ok: true, value: normalized };
}

function getEnvironmentalSnapshotOrNull(
  row: Record<string, unknown>,
  key: string,
): EnvironmentalSnapshot | null {
  const value = row[key];
  return isEnvironmentalSnapshot(value) ? value : null;
}

function getCalibrationLocationSnapshotOrNull(
  row: Record<string, unknown>,
  key: string,
): CalibrationLocationSnapshot | null {
  const value = row[key];
  return isCalibrationLocationSnapshot(value) ? value : null;
}

function getCalibrationPhaseSnapshotOrNull(
  row: Record<string, unknown>,
  key: string,
): CalibrationPhaseSnapshot | null {
  const value = row[key];
  return isCalibrationPhaseSnapshot(value) ? value : null;
}

function isEnvironmentalSnapshot(
  value: unknown,
): value is EnvironmentalSnapshot {
  const row = asRecord(value);
  return (
    ("temperature" in row || "humidity" in row || "pressure" in row) &&
    typeof row.recordedAt === "string" &&
    typeof row.recordedBy === "string"
  );
}

function isCalibrationLocationSnapshot(
  value: unknown,
): value is CalibrationLocationSnapshot {
  const row = asRecord(value);
  return (
    typeof row.type === "string" &&
    typeof row.addressText === "string" &&
    typeof row.recordedAt === "string" &&
    typeof row.recordedBy === "string"
  );
}

function isCalibrationPhaseSnapshot(
  value: unknown,
): value is CalibrationPhaseSnapshot {
  const row = asRecord(value);
  return (
    typeof row.blocks === "object" &&
    row.blocks !== null &&
    typeof row.recordedAt === "string" &&
    typeof row.recordedBy === "string"
  );
}

function hasOwn(row: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function getJobStatus(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (
    value === "DRAFT" ||
    value === "IN_PROGRESS" ||
    value === "REVIEW" ||
    value === "REJECTED"
  ) {
    return value;
  }

  return null;
}

function parseSyncDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function generateDesktopCustomerSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);

  return `${base || "cliente"}-${randomUUID().slice(0, 8)}`;
}
