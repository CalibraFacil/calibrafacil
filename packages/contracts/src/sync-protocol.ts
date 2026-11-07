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
 * - Every member below is an operation a desktop build of today writes. The operations
 *   older builds wrote (customers, instrument edits, job drafts, non-conformances, quote,
 *   delivery and execution-notes documents, certificate drafts and PDFs) were retired in
 *   Q69 (`RETIRED_SYNC_OPERATIONS`): the cloud no longer applies them, and an event of
 *   one left in an upgraded outbox is refused for good like any operation outside the
 *   union (`UNSUPPORTED_SYNC_OPERATION`), readable in the desktop's refused list.
 * - An operation outside the union is not a schema failure: it is an operation
 *   this server does not support (`UNSUPPORTED_SYNC_OPERATION`).
 * - Protocol 3 adds the commit-ordered pull and the paged bootstrap
 *   (sync-change-seq.ts, docs/architecture/sync-change-seq.md). The push wire format
 *   is unchanged. Protocols 1 and 2 (the `updatedAt` pull and the unpaged bootstrap)
 *   are gone: the cloud answers a pull, a bootstrap or a push of a desktop below
 *   `SYNC_DESKTOP_VERSION_FLOOR` with the "update required" refusal (HTTP 426).
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

/**
 * The oldest protocol the cloud still serves: the commit-ordered pull and the paged
 * bootstrap. A request of an older protocol (or one that states none) is answered
 * `DESKTOP_UPDATE_REQUIRED`.
 */
export const SYNC_MIN_PROTOCOL_VERSION = 3;

/**
 * The oldest desktop build the cloud takes sync requests from, whatever
 * `SYNC_MIN_DESKTOP_VERSION` says (that variable can only raise it). 0.3.0 is the
 * first release that reports its own version, speaks protocol 3, stamps the
 * calibration record on its execution events and no longer writes the retired
 * operations (offline mode narrowed to field capture, intake and reference reads).
 */
export const SYNC_DESKTOP_VERSION_FLOOR = "0.3.0";

// ---------------------------------------------------------------------------
// Payloads. The cloud applies each one through the domain schemas of
// @calibra-facil/schemas (which are stricter and own the business rules); the
// contract here fixes the shape every producer relies on, so a payload that is
// not even the right kind of value is refused for good, up front, instead of
// being read as "empty" by an apply handler.
// ---------------------------------------------------------------------------

const jsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * `save_local_execution` / `submit_local_execution`. Only the keys the cloud
 * reads to decide are typed; the snapshots travel whole and are validated by
 * the submit command that applies them.
 */
const syncExecutionPayloadSchema = z.looseObject({
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

/**
 * The entity types the push protocol's commands are written against (the
 * `aggregate_kind` of the desktop's outbox events). The web's labels for them are typed
 * against this list, so a new kind cannot ship without one.
 */
export const SYNC_COMMAND_ENTITY_TYPES = [
  "asset",
  "attachment",
  "calibration_job",
  "service_order",
] as const;

export type SyncCommandEntityType = (typeof SYNC_COMMAND_ENTITY_TYPES)[number];

function command<
  Entity extends SyncCommandEntityType,
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

/**
 * `create_local_asset`: the fields the cloud reads (`CreateAssetSchema`, which
 * owns the rules and the required ones). Typed when present, optional here so an
 * event applied by an earlier push is still recognised and acknowledged.
 */
const syncCreateAssetPayloadSchema = z.looseObject({
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
const syncServiceOrderIntakePayloadSchema = z.looseObject({
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

const createLocalAssetCommandSchema = command(
  "asset",
  "create_local_asset",
  syncCreateAssetPayloadSchema,
);
const saveLocalExecutionCommandSchema = command(
  "calibration_job",
  "save_local_execution",
  syncExecutionPayloadSchema,
);
const submitLocalExecutionCommandSchema = command(
  "calibration_job",
  "submit_local_execution",
  syncExecutionPayloadSchema,
);
const createLocalServiceOrderIntakeCommandSchema = command(
  "service_order",
  "create_local_service_order_intake",
  syncServiceOrderIntakePayloadSchema,
);
const createLocalAttachmentCommandSchema = command(
  "attachment",
  "create_local_attachment",
  syncAttachmentPayloadSchema,
);

/**
 * Every operation of the push protocol, keyed by `operation`.
 */
const syncCommandSchema = z.discriminatedUnion("operation", [
  createLocalAssetCommandSchema,
  saveLocalExecutionCommandSchema,
  submitLocalExecutionCommandSchema,
  createLocalServiceOrderIntakeCommandSchema,
  createLocalAttachmentCommandSchema,
]);

export type SyncCommand = z.infer<typeof syncCommandSchema>;
export type SyncCommandOperation = SyncCommand["operation"];

/**
 * The rights an operation needs, as the online route that does the same thing states
 * them (`withLabPermission({...})`): resource -> actions. The API checks the names
 * against its access-control statements when it loads the table.
 */
export type SyncOperationPermission = {
  readonly [resource: string]: readonly string[];
};

/**
 * - `create`: the event makes a record (or a record's child) that the cloud may not have
 *   yet. A later event of the same record, or one that points at it, waits behind it
 *   while it is in trouble, and a creation that was discarded before the cloud ever got
 *   the record blocks what depended on it.
 * - `follow`: the event acts on a record that already exists (an edit, an execution
 *   save, an audit marker).
 *
 * This was the naming convention `create_local_*`; it is a field so a rename cannot
 * change the ordering.
 */
export type SyncOperationOrdering = "create" | "follow";

export type SyncOperationDefinition = {
  /** What the person looking at the outbox reads (pt-BR). */
  readonly label: string;
  /** The event carries regulated calibration readings. */
  readonly regulated: boolean;
  readonly ordering: SyncOperationOrdering;
  /** Who may push it. */
  readonly permission: SyncOperationPermission;
  /** The online route (or guard) the permission was taken from. */
  readonly onlineRoute: string;
  /**
   * The first push protocol that carries it. A desktop pushing to an older cloud keeps
   * the event out of the request (still pending), so the cloud is never handed an
   * operation it would acknowledge without being able to honour.
   */
  readonly minProtocolVersion: number;
  /**
   * The event's file goes to the cloud before the event (init-upload, PUT,
   * complete-upload: sync-attachments.ts); the event follows only once it is there.
   */
  readonly uploadsFile: boolean;
};

/**
 * The one table of the push protocol's operations, exhaustive by type: adding a member to
 * the union fails to compile here until someone says what it is called, whether it carries regulated readings, how it is ordered
 * and who may send it. The API's handler switch (`apply-event.ts`) is the other
 * exhaustive place. A spec ties the table to the union (every member listed, none twice)
 * and another to the writers of packages/local-db.
 */
export const SYNC_OPERATIONS = {
  create_local_asset: {
    label: "Cadastro de instrumento",
    regulated: false,
    ordering: "create",
    permission: { equipment: ["create"] },
    onlineRoute: "POST /api/assets",
    minProtocolVersion: LEGACY_SYNC_PROTOCOL_VERSION,
    uploadsFile: false,
  },
  save_local_execution: {
    label: "Rascunho da execução",
    regulated: true,
    ordering: "follow",
    permission: { calibration: ["execute"] },
    onlineRoute: "POST /api/jobs/:id/execute",
    minProtocolVersion: LEGACY_SYNC_PROTOCOL_VERSION,
    uploadsFile: false,
  },
  submit_local_execution: {
    label: "Envio da execução para aprovação",
    regulated: true,
    ordering: "follow",
    permission: { calibration: ["submit"] },
    onlineRoute: "POST /api/jobs/:id/submit",
    minProtocolVersion: LEGACY_SYNC_PROTOCOL_VERSION,
    uploadsFile: false,
  },
  create_local_service_order_intake: {
    label: "Recebimento de ordem de serviço",
    regulated: false,
    ordering: "create",
    permission: { service_order: ["create"] },
    onlineRoute: "POST /api/service-orders",
    minProtocolVersion: LEGACY_SYNC_PROTOCOL_VERSION,
    uploadsFile: false,
  },
  create_local_attachment: {
    label: "Anexo",
    regulated: false,
    ordering: "create",
    // The attachment endpoints (`/api/sync/attachments/*`) and the event share this
    // permission: an attachment is field evidence captured by whoever may start work on
    // the lab's records.
    permission: { calibration: ["create"] },
    onlineRoute: "POST /api/sync/attachments/init-upload",
    minProtocolVersion: SYNC_ATTACHMENT_UPLOAD_PROTOCOL_VERSION,
    uploadsFile: true,
  },
} as const satisfies Record<SyncCommandOperation, SyncOperationDefinition>;

const SYNC_OPERATION_DEFINITIONS: ReadonlyMap<string, SyncOperationDefinition> =
  new Map(Object.entries(SYNC_OPERATIONS));

/**
 * Whether an event of `operation` may travel in a push of `protocolVersion`. An operation
 * outside the table (a retired one left in an upgraded outbox) always may: the cloud
 * refuses it with a precise code, which is what the person reading the refused list needs.
 */
export function isSyncOperationCarriedBy(
  operation: string,
  protocolVersion: number,
): boolean {
  const definition = SYNC_OPERATION_DEFINITIONS.get(operation);
  return !definition || protocolVersion >= definition.minProtocolVersion;
}

/** Whether the file of an `operation` event goes to the cloud before the event does. */
export function syncOperationUploadsFile(operation: string): boolean {
  return SYNC_OPERATION_DEFINITIONS.get(operation)?.uploadsFile ?? false;
}

/**
 * The operations older builds wrote and the cloud no longer applies (Q69), with the label
 * the desktop shows when one of them, left in an upgraded outbox, is refused, and how it is
 * ordered there (a refused creation still holds back the events that refer to it). They are
 * not members of the protocol: an event of one is `UNSUPPORTED_SYNC_OPERATION`.
 */
export const RETIRED_SYNC_OPERATIONS = {
  update_local_asset: { label: "Edição de instrumento", ordering: "follow" },
  create_local_customer: { label: "Cadastro de cliente", ordering: "create" },
  update_local_customer: { label: "Edição de cliente", ordering: "follow" },
  update_local_customer_compliance: {
    label: "Conformidade do cliente",
    ordering: "follow",
  },
  create_local_job_draft: {
    label: "Abertura de calibração",
    ordering: "create",
  },
  create_local_non_conformance: {
    label: "Registro de não conformidade",
    ordering: "create",
  },
  create_local_service_order_quote_draft: {
    label: "Orçamento da ordem de serviço",
    ordering: "create",
  },
  save_local_service_order_execution_notes: {
    label: "Notas da execução da OS",
    ordering: "follow",
  },
  create_local_service_order_delivery_document_draft: {
    label: "Documento de entrega",
    ordering: "create",
  },
  create_local_certificate_draft: {
    label: "Rascunho de certificado",
    ordering: "create",
  },
  generate_local_certificate_pdf: {
    label: "Publicação de certificado",
    ordering: "follow",
  },
} as const satisfies Record<
  string,
  { readonly label: string; readonly ordering: SyncOperationOrdering }
>;

/** The entity types of the retired operations (for the labels of a refused event). */
export const RETIRED_SYNC_ENTITY_TYPES = [
  "customer",
  "non_conformance",
  "service_order_execution",
  "service_order_quote",
  "service_order_delivery_document",
  "certificate_draft",
] as const;

export type RetiredSyncEntityType = (typeof RETIRED_SYNC_ENTITY_TYPES)[number];

export const SYNC_COMMAND_OPERATIONS: readonly SyncCommandOperation[] =
  syncCommandSchema.options.map((member) => member.shape.operation.value);

export function isSyncCommandOperation(
  value: string,
): value is SyncCommandOperation {
  return Object.hasOwn(SYNC_OPERATIONS, value);
}

/** The pt-BR label of an operation, or undefined for one this build does not know. */
export function syncOperationLabel(
  operation: string | null,
): string | undefined {
  if (operation === null) return undefined;
  if (isSyncCommandOperation(operation))
    return SYNC_OPERATIONS[operation].label;
  return Object.entries(RETIRED_SYNC_OPERATIONS).find(
    ([candidate]) => candidate === operation,
  )?.[1].label;
}

/** Whether the operation's events carry regulated calibration readings. */
export function isRegulatedSyncOperation(operation: string): boolean {
  return (
    isSyncCommandOperation(operation) && SYNC_OPERATIONS[operation].regulated
  );
}

/**
 * Whether the operation creates a record the cloud may not have yet (`SyncOperationOrdering`).
 * A retired creation counts: one left in an upgraded outbox and refused still holds back the
 * events that refer to its record.
 */
export function isCreateSyncOperation(operation: string): boolean {
  if (isSyncCommandOperation(operation)) {
    return SYNC_OPERATIONS[operation].ordering === "create";
  }
  return Object.entries(RETIRED_SYNC_OPERATIONS).some(
    ([candidate, definition]) =>
      candidate === operation && definition.ordering === "create",
  );
}

/** The operations that create a record, for the places that need the list (SQL `IN (...)`). */
export const SYNC_CREATE_OPERATIONS: readonly string[] = [
  ...SYNC_COMMAND_OPERATIONS,
  ...Object.keys(RETIRED_SYNC_OPERATIONS),
].filter(isCreateSyncOperation);

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
  /**
   * The device clock when the push was sent (roadmap 2 E2). The cloud compares
   * it with its own clock and records the skew with what the push changes; the
   * device clock still never moves an instant past the server's.
   */
  sentAt: z.string().datetime().optional(),
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

/**
 * The minimum the cloud enforces: the operator's `SYNC_MIN_DESKTOP_VERSION` when it is
 * higher than `SYNC_DESKTOP_VERSION_FLOOR`, the floor otherwise.
 */
export function effectiveMinimumDesktopVersion(
  configured: string | undefined,
): string {
  if (configured === undefined) return SYNC_DESKTOP_VERSION_FLOOR;
  return (compareDesktopVersions(configured, SYNC_DESKTOP_VERSION_FLOOR) ??
    -1) >= 0
    ? configured
    : SYNC_DESKTOP_VERSION_FLOOR;
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
