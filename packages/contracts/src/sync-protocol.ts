import { z } from "zod";
import { syncEventSchema } from "./sync";

/**
 * The desktop-to-cloud push protocol: what a desktop may send to
 * `POST /api/sync/push`, and how the cloud tells it to update.
 *
 * Before this file the wire format was `operation: string, payload: unknown`:
 * the producer (packages/local-db, apps/local-server) and the consumer
 * (apps/api) agreed by convention only, and a drift between them showed up as
 * a rejected regulated record in production. Now one discriminated union,
 * keyed by `operation`, with one Zod schema per member, is the contract both
 * sides compile against.
 *
 * Versioning:
 * - `SYNC_PROTOCOL_VERSION` is the version this build speaks. A push request
 *   carries it (`protocolVersion`) with the desktop app version
 *   (`desktopVersion`). A request without `protocolVersion` comes from a build
 *   that predates versioning: protocol 1, which the cloud still accepts.
 * - The members below are `current` (a desktop build of today still produces
 *   them) or `legacy` (an older build may still hold them in its outbox; the
 *   cloud applies or refuses them exactly as before, and a build of today never
 *   writes one). A legacy member is explicit so that dropping one is a
 *   deliberate act with a test to change, never a silent narrowing.
 * - An operation outside the union is not a schema failure: it is an operation
 *   this server does not support (`UNSUPPORTED_SYNC_OPERATION`).
 * - Protocol 3 adds the commit-ordered pull and the paged bootstrap
 *   (sync-change-seq.ts, docs/architecture/sync-change-seq.md). The push wire format
 *   is unchanged; protocols 1 and 2 keep the `updatedAt` pull until
 *   `SYNC_MIN_DESKTOP_VERSION` excludes them (DEPLOYMENT.md).
 * - Protocol 4 adds the attachment upload leg (sync-attachments.ts): a desktop that
 *   speaks it uploads an attachment's bytes (init-upload, PUT, complete-upload)
 *   before pushing `create_local_attachment`, and the cloud refuses that event
 *   unless the upload was completed. The push wire format and the pull are
 *   unchanged; an older desktop's attachment event is refused with the permanent
 *   `SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED` (it has no bytes to send) and waits for
 *   the update.
 */
export const SYNC_PROTOCOL_VERSION = 4;

/** The first protocol whose desktops upload attachment bytes before pushing the event. */
export const SYNC_ATTACHMENT_UPLOAD_PROTOCOL_VERSION = 4;

/** The protocol of a request that states no `protocolVersion`. */
export const LEGACY_SYNC_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Payloads. The cloud applies each one through the domain schemas of
// @calibra-facil/schemas (which are stricter and own the business rules); the
// contract here fixes the shape every producer relies on, so a payload that is
// not even the right kind of value is refused for good, up front, instead of
// being read as "empty" by an apply handler.
// ---------------------------------------------------------------------------

const jsonObjectSchema = z.record(z.string(), z.unknown());

/** An open object: the keys of the row the desktop merged into the payload. */
const rowPayloadSchema = z.looseObject({});

/**
 * `save_local_execution` / `submit_local_execution`. Only the keys the cloud
 * reads to decide are typed; the snapshots travel whole and are validated by
 * the submit command that applies them.
 */
export const syncExecutionPayloadSchema = z.looseObject({
  remoteId: z.number().int().positive().optional(),
  data: jsonObjectSchema.nullable().optional(),
  results: jsonObjectSchema.nullable().optional(),
  status: z.string().optional(),
  performedAt: z.string().nullable().optional(),
  backdateReason: z.string().nullable().optional(),
  methodDeviations: z.string().nullable().optional(),
  /** Stamped by builds that enforce the calibration record offline. */
  executionPayloadVersion: z.number().int().positive().optional(),
});

const envelopeShape = syncEventSchema.shape;

function command<
  Entity extends string,
  Operation extends string,
  Payload extends z.ZodType,
>(entityType: Entity, operation: Operation, payload: Payload) {
  return z.object({
    ...envelopeShape,
    entityType: z.literal(entityType),
    operation: z.literal(operation),
    payload,
  });
}

// ---- current members: a desktop build of today still produces these --------

/**
 * `create_local_asset`: the fields the cloud reads (`CreateAssetSchema`, which
 * owns the rules and the required ones). Typed when present, optional here so an
 * event applied by an earlier push is still recognised and acknowledged.
 */
export const syncCreateAssetPayloadSchema = z.looseObject({
  customerId: z.number().int().optional(),
  assetTypeId: z.number().int().optional(),
  name: z.string().optional(),
  serialNumber: z.string().optional(),
  tag: z.string().optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  status: z.string().optional(),
  baseMeasurementUnit: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
  metrologyRegime: z.string().optional(),
});

/** `create_local_service_order_intake` (`CreateServiceOrderSchema` owns the rules). */
export const syncServiceOrderIntakePayloadSchema = z.looseObject({
  customerId: z.number().int().optional(),
  assetId: z.number().int().optional(),
  claimedDefect: z.string().optional(),
  intakeCondition: z.string().optional(),
  intakeType: z.string().optional(),
  priority: z.string().optional(),
  responsibleTechnicianId: z.string().nullable().optional(),
  sourceServiceOrderId: z.number().int().nullable().optional(),
});

/**
 * `create_local_attachment`: the cloud records it only once the bytes it names
 * (`contentHash`, `mimeType`, `sizeBytes`) were uploaded and completed through the
 * attachment endpoints (sync-attachments.ts).
 */
export const syncAttachmentPayloadSchema = z.looseObject({
  attachmentId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  localPath: z.string().optional(),
  contentHash: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
});

export const createLocalAssetCommandSchema = command(
  "asset",
  "create_local_asset",
  syncCreateAssetPayloadSchema,
);
export const saveLocalExecutionCommandSchema = command(
  "calibration_job",
  "save_local_execution",
  syncExecutionPayloadSchema,
);
export const submitLocalExecutionCommandSchema = command(
  "calibration_job",
  "submit_local_execution",
  syncExecutionPayloadSchema,
);
export const createLocalServiceOrderIntakeCommandSchema = command(
  "service_order",
  "create_local_service_order_intake",
  syncServiceOrderIntakePayloadSchema,
);
export const createLocalAttachmentCommandSchema = command(
  "attachment",
  "create_local_attachment",
  syncAttachmentPayloadSchema,
);

// ---- legacy members: only an older build's outbox can still hold these -----

export const updateLocalAssetCommandSchema = command(
  "asset",
  "update_local_asset",
  rowPayloadSchema,
);
export const createLocalCustomerCommandSchema = command(
  "customer",
  "create_local_customer",
  rowPayloadSchema,
);
export const updateLocalCustomerCommandSchema = command(
  "customer",
  "update_local_customer",
  rowPayloadSchema,
);
export const updateLocalCustomerComplianceCommandSchema = command(
  "customer",
  "update_local_customer_compliance",
  rowPayloadSchema,
);
export const createLocalJobDraftCommandSchema = command(
  "calibration_job",
  "create_local_job_draft",
  rowPayloadSchema,
);
export const createLocalNonConformanceCommandSchema = command(
  "non_conformance",
  "create_local_non_conformance",
  rowPayloadSchema,
);
export const createLocalServiceOrderQuoteDraftCommandSchema = command(
  "service_order_quote",
  "create_local_service_order_quote_draft",
  rowPayloadSchema,
);
export const saveLocalServiceOrderExecutionNotesCommandSchema = command(
  "service_order_execution",
  "save_local_service_order_execution_notes",
  rowPayloadSchema,
);
export const createLocalServiceOrderDeliveryDocumentDraftCommandSchema =
  command(
    "service_order_delivery_document",
    "create_local_service_order_delivery_document_draft",
    rowPayloadSchema,
  );
export const createLocalCertificateDraftCommandSchema = command(
  "certificate_draft",
  "create_local_certificate_draft",
  rowPayloadSchema,
);
/**
 * A client-rendered certificate PDF, from a build that published offline. The
 * cloud refuses it for good (certificates are issued online only), so it is a
 * member only to be refused with its own code. Older builds wrote its entity
 * type inconsistently, so any is accepted.
 */
export const generateLocalCertificatePdfCommandSchema = z.object({
  ...envelopeShape,
  operation: z.literal("generate_local_certificate_pdf"),
  payload: z.unknown(),
});

/**
 * Every operation of the push protocol, keyed by `operation`. Order is the
 * documentation order: current members first.
 */
export const syncCommandSchema = z.discriminatedUnion("operation", [
  createLocalAssetCommandSchema,
  saveLocalExecutionCommandSchema,
  submitLocalExecutionCommandSchema,
  createLocalServiceOrderIntakeCommandSchema,
  createLocalAttachmentCommandSchema,
  updateLocalAssetCommandSchema,
  createLocalCustomerCommandSchema,
  updateLocalCustomerCommandSchema,
  updateLocalCustomerComplianceCommandSchema,
  createLocalJobDraftCommandSchema,
  createLocalNonConformanceCommandSchema,
  createLocalServiceOrderQuoteDraftCommandSchema,
  saveLocalServiceOrderExecutionNotesCommandSchema,
  createLocalServiceOrderDeliveryDocumentDraftCommandSchema,
  createLocalCertificateDraftCommandSchema,
  generateLocalCertificatePdfCommandSchema,
]);

export type SyncCommand = z.infer<typeof syncCommandSchema>;
export type SyncCommandOperation = SyncCommand["operation"];

/** Whether a build of today still writes the operation. */
export type SyncCommandSupport = "current" | "legacy";

/**
 * The membership table: which operations exist and whether a desktop of today
 * still produces them. A spec ties it to the union (every member listed, none
 * twice) and another to the writers of packages/local-db.
 */
export const SYNC_COMMAND_SUPPORT = {
  create_local_asset: "current",
  save_local_execution: "current",
  submit_local_execution: "current",
  create_local_service_order_intake: "current",
  create_local_attachment: "current",
  update_local_asset: "legacy",
  create_local_customer: "legacy",
  update_local_customer: "legacy",
  update_local_customer_compliance: "legacy",
  create_local_job_draft: "legacy",
  create_local_non_conformance: "legacy",
  create_local_service_order_quote_draft: "legacy",
  save_local_service_order_execution_notes: "legacy",
  create_local_service_order_delivery_document_draft: "legacy",
  create_local_certificate_draft: "legacy",
  generate_local_certificate_pdf: "legacy",
} as const satisfies Record<SyncCommandOperation, SyncCommandSupport>;

export const SYNC_COMMAND_OPERATIONS: readonly SyncCommandOperation[] =
  syncCommandSchema.options.map((member) => member.shape.operation.value);

function isSyncCommandOperation(value: string): value is SyncCommandOperation {
  return Object.hasOwn(SYNC_COMMAND_SUPPORT, value);
}

export function syncCommandSupport(
  operation: string,
): SyncCommandSupport | null {
  return isSyncCommandOperation(operation)
    ? SYNC_COMMAND_SUPPORT[operation]
    : null;
}

export type SyncCommandParseResult =
  | { ok: true; command: SyncCommand }
  | {
      ok: false;
      /**
       * `unsupported_operation`: no member has this operation (or not for this
       * entity type); `invalid`: a member does, and the event does not fit it
       * (envelope or payload).
       */
      kind: "unsupported_operation" | "invalid";
      reason: string;
    };

/**
 * One event against the protocol. Reasons name the offending paths, never the
 * values: a payload carries calibration readings and customer data.
 */
export function parseSyncCommand(event: unknown): SyncCommandParseResult {
  const parsed = syncCommandSchema.safeParse(event);
  if (parsed.success) return { ok: true, command: parsed.data };

  const envelope = syncEventSchema.safeParse(event);
  if (!envelope.success) {
    return {
      ok: false,
      kind: "invalid",
      reason: `Sync event envelope is invalid: ${describeIssues(envelope.error)}.`,
    };
  }

  const { operation, entityType } = envelope.data;
  const member = syncCommandSchema.options.find(
    (candidate) => candidate.shape.operation.value === operation,
  );
  const expectedEntityType =
    member && member.shape.entityType instanceof z.ZodLiteral
      ? member.shape.entityType.value
      : null;
  if (
    !member ||
    (expectedEntityType !== null && expectedEntityType !== entityType)
  ) {
    return {
      ok: false,
      kind: "unsupported_operation",
      reason: `Sync operation ${operation} on ${entityType} is not supported by this server.`,
    };
  }

  return {
    ok: false,
    kind: "invalid",
    reason: `Sync event ${operation} does not match its schema: ${describeIssues(parsed.error)}.`,
  };
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

const pushRequestHeaderShape = {
  deviceId: z.string(),
  clientBatchId: z.string(),
  baseCursor: z.string().nullable(),
  /**
   * The protocol the desktop speaks. Absent in builds that predate
   * versioning: read as `LEGACY_SYNC_PROTOCOL_VERSION`.
   */
  protocolVersion: z.number().int().positive().optional(),
  /** The desktop app version (`app.getVersion()`), compared with the cloud's minimum. */
  desktopVersion: z.string().min(1).optional(),
};

/** The push request as a producer builds it: every event is a wire event. */
export const syncPushRequestSchema = z.object({
  ...pushRequestHeaderShape,
  events: z.array(syncEventSchema),
});

/**
 * The push request as the cloud first reads it: the header is validated, each
 * event is not. One malformed event must be refused on its own (and for good),
 * not fail the whole batch and be retried forever with its neighbours.
 */
export const syncPushRequestEnvelopeSchema = z.object({
  ...pushRequestHeaderShape,
  events: z.array(z.unknown()),
});

export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncPushRequestEnvelope = z.infer<
  typeof syncPushRequestEnvelopeSchema
>;

// ---------------------------------------------------------------------------
// Minimum desktop version (Q28)
// ---------------------------------------------------------------------------

/**
 * Answer to a push from a desktop older than the cloud's minimum
 * (`SYNC_MIN_DESKTOP_VERSION`), with HTTP 426. Nothing in the request was
 * looked at or applied: the desktop keeps every queued event untouched, shows
 * the message and waits for the update.
 */
export const DESKTOP_UPDATE_REQUIRED_CODE = "DESKTOP_UPDATE_REQUIRED";

export const syncUpdateRequiredResponseSchema = z.object({
  code: z.literal(DESKTOP_UPDATE_REQUIRED_CODE),
  minimumVersion: z.string(),
  /** What the desktop reported; null when it reported nothing (a build before versioning). */
  desktopVersion: z.string().nullable(),
  message: z.string(),
});

export type SyncUpdateRequiredResponse = z.infer<
  typeof syncUpdateRequiredResponseSchema
>;

/** pt-BR text shown by the desktop: its own, whatever the server wrote. */
export function desktopUpdateRequiredMessage(minimumVersion: string): string {
  return `Esta versão do Calibra Fácil Desktop não pode mais sincronizar. Atualize para a versão ${minimumVersion} ou posterior. Suas alterações pendentes foram mantidas e serão enviadas depois da atualização.`;
}

export function buildSyncUpdateRequiredResponse(input: {
  minimumVersion: string;
  desktopVersion: string | null;
}): SyncUpdateRequiredResponse {
  return {
    code: DESKTOP_UPDATE_REQUIRED_CODE,
    minimumVersion: input.minimumVersion,
    desktopVersion: input.desktopVersion,
    message: desktopUpdateRequiredMessage(input.minimumVersion),
  };
}

/**
 * Answer (HTTP 400) to a push that speaks a newer protocol than this cloud
 * understands. The desktop treats it like any failed request: its events stay
 * queued and are retried, so they survive until the cloud is updated.
 */
export const SYNC_PROTOCOL_UNSUPPORTED_CODE = "SYNC_PROTOCOL_UNSUPPORTED";

export const syncProtocolUnsupportedResponseSchema = z.object({
  code: z.literal(SYNC_PROTOCOL_UNSUPPORTED_CODE),
  supportedProtocolVersion: z.number().int().positive(),
  message: z.string(),
});

export function buildSyncProtocolUnsupportedResponse(requested: number) {
  return {
    code: SYNC_PROTOCOL_UNSUPPORTED_CODE,
    supportedProtocolVersion: SYNC_PROTOCOL_VERSION,
    message: `Sync protocol ${requested} is newer than the cloud supports (${SYNC_PROTOCOL_VERSION}).`,
  } satisfies z.infer<typeof syncProtocolUnsupportedResponseSchema>;
}

type ParsedVersion = {
  numbers: readonly [number, number, number];
  prerelease: string | null;
};

const VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }
  return {
    numbers: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease ?? null,
  };
}

/** Whether `value` is a `MAJOR.MINOR.PATCH[-prerelease]` version. */
export function isDesktopVersion(value: string): boolean {
  return parseVersion(value) !== null;
}

/**
 * Orders two desktop versions (semver precedence: a prerelease sorts before its
 * release). Null when either is not a version.
 */
export function compareDesktopVersions(
  left: string,
  right: string,
): -1 | 0 | 1 | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  for (let index = 0; index < 3; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Semver 2.0 precedence of two prerelease strings: identifiers (split on `.`)
 * left to right; numeric ones compare as numbers (`rc.9 < rc.10`) and sort below
 * alphanumeric ones; when all shared identifiers are equal the shorter list is
 * the lower.
 */
function comparePrerelease(left: string, right: string): -1 | 0 | 1 {
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index] ?? "";
    const y = b[index] ?? "";
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      return BigInt(x) < BigInt(y) ? -1 : 1;
    }
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    return x < y ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

export type DesktopVersionGate =
  | { ok: true }
  | { ok: false; minimumVersion: string; desktopVersion: string | null };

/**
 * Whether a desktop may push. No minimum configured: always. With one, a
 * desktop that reports no version (it predates versioning) or one that is not a
 * version is older than any minimum.
 */
export function evaluateDesktopVersionGate(input: {
  minimumVersion: string | undefined;
  desktopVersion: string | undefined;
}): DesktopVersionGate {
  const { minimumVersion, desktopVersion } = input;
  if (minimumVersion === undefined) return { ok: true };
  if (
    desktopVersion !== undefined &&
    (compareDesktopVersions(desktopVersion, minimumVersion) ?? -1) >= 0
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    minimumVersion,
    desktopVersion: desktopVersion ?? null,
  };
}
