import { z } from "zod";

/**
 * Zod schema for the `wysiwyg` certificate template document (spec 02 §2).
 *
 * The document is TipTap/ProseMirror JSON, but validation is OURS, not the
 * editor's: this schema is the server-side source of truth enforced on draft
 * save, publish, and render (ADR-2 rule 2 — three enforcement layers). The
 * block catalog is CLOSED: any node type not listed here is a compile error.
 */

// ---------------------------------------------------------------------------
// Locked blocks — ISO/IEC 17025 §7.8.2.1 / §7.8.4.1 mandatory content.
// Each must appear EXACTLY once, top-level only. Content is injected by the
// compiler; the template only positions them (ADR-2).
// ---------------------------------------------------------------------------

/** Register themes (reframe §G: Technical form default + Institute classic). */
export const CERTIFICATE_THEMES = ["technical-form", "institute-classic"] as const;
export type CertificateTheme = (typeof CERTIFICATE_THEMES)[number];

export const CERTIFICATE_DOCUMENT_SCHEMA_VERSION = 2;

export const LOCKED_BLOCK_KEYS = [
  "certificate_identification",
  "lab_identification",
  "customer_identification",
  "item_identification",
  "method_traceability",
  "environmental_conditions",
  "results_table",
  "uncertainty_statement",
  "signature_block",
  "accreditation_seal",
  "verification_qr",
  "end_of_document",
] as const;

export type LockedBlockKey = (typeof LOCKED_BLOCK_KEYS)[number];

const lockedBlockKeySchema = z.enum(LOCKED_BLOCK_KEYS);

/**
 * §7.8.4.3: a calibration certificate must not recommend a calibration
 * interval — the interval is customer-owned. Mirror of the hard-ban in
 * `packages/certificate-xlsx-template/src/manifest.ts`; enforced here at the
 * schema layer AND again in the placeholder catalog (defense in depth).
 */
export const BANNED_PLACEHOLDER_SEGMENTS = [
  "nextCalibrationDate",
  "calibrationIntervalMonths",
] as const;

const placeholderPathSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/, {
    message: "placeholder path must be dot-separated identifiers, e.g. customer.name",
  })
  .refine(
    (path) =>
      !path
        .split(".")
        .some((segment) =>
          BANNED_PLACEHOLDER_SEGMENTS.some((banned) => segment === banned),
        ),
    { message: "placeholder path is banned on certificates (ISO/IEC 17025 §7.8.4.3)" },
  );

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

const markSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bold") }),
  z.strictObject({ type: z.literal("italic") }),
]);

const textNodeSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(markSchema).optional(),
});

const placeholderNodeSchema = z.strictObject({
  type: z.literal("placeholder"),
  attrs: z.strictObject({
    path: placeholderPathSchema,
    label: z.string().nullish(),
  }),
});

const inlineNodeSchema = z.discriminatedUnion("type", [
  textNodeSchema,
  placeholderNodeSchema,
]);

// ---------------------------------------------------------------------------
// Editable blocks
// ---------------------------------------------------------------------------

const textAlignSchema = z.enum(["left", "center", "right", "justify"]);

const paragraphNodeSchema = z.strictObject({
  type: z.literal("paragraph"),
  attrs: z.strictObject({ textAlign: textAlignSchema.nullish() }).optional(),
  content: z.array(inlineNodeSchema).optional(),
});

const headingNodeSchema = z.strictObject({
  type: z.literal("heading"),
  attrs: z.strictObject({
    level: z.int().min(1).max(4),
    textAlign: textAlignSchema.nullish(),
  }),
  content: z.array(inlineNodeSchema).optional(),
});

const listItemNodeSchema = z.strictObject({
  type: z.literal("listItem"),
  content: z.array(paragraphNodeSchema).min(1),
});

const bulletListNodeSchema = z.strictObject({
  type: z.literal("bulletList"),
  content: z.array(listItemNodeSchema).min(1),
});

const orderedListNodeSchema = z.strictObject({
  type: z.literal("orderedList"),
  attrs: z.strictObject({ start: z.int().min(1).optional() }).optional(),
  content: z.array(listItemNodeSchema).min(1),
});

/** v1: no merged cells in AUTHORED tables (ADR-2; backlog #7). */
const tableSpanSchema = z.literal(1).nullish();

const tableCellAttrsSchema = z.strictObject({
  colspan: tableSpanSchema,
  rowspan: tableSpanSchema,
  colwidth: z.array(z.number().positive()).nullish(),
  // Emitted by TipTap v3's table cells (round-trip compatibility).
  align: textAlignSchema.nullish(),
});

const tableCellNodeSchema = z.strictObject({
  type: z.literal("tableCell"),
  attrs: tableCellAttrsSchema.optional(),
  content: z.array(paragraphNodeSchema).min(1),
});

const tableHeaderNodeSchema = z.strictObject({
  type: z.literal("tableHeader"),
  attrs: tableCellAttrsSchema.optional(),
  content: z.array(paragraphNodeSchema).min(1),
});

const tableRowNodeSchema = z.strictObject({
  type: z.literal("tableRow"),
  content: z
    .array(z.discriminatedUnion("type", [tableCellNodeSchema, tableHeaderNodeSchema]))
    .min(1),
});

const tableNodeSchema = z.strictObject({
  type: z.literal("table"),
  content: z.array(tableRowNodeSchema).min(1),
});

/**
 * Images reference org media by id — never a raw URL. The compiler resolves
 * (and tenant-checks) the id at render time; a raw src would be both a
 * tenant-isolation hole and a determinism hazard.
 */
const imageNodeSchema = z.strictObject({
  type: z.literal("image"),
  attrs: z.strictObject({
    mediaId: z.int().positive(),
    alt: z.string().nullish(),
    widthMm: z.number().positive().max(180).nullish(),
  }),
});

const horizontalRuleNodeSchema = z.strictObject({
  type: z.literal("horizontalRule"),
});

const pageHeaderNodeSchema = z.strictObject({
  type: z.literal("pageHeader"),
  content: z.array(inlineNodeSchema).min(1),
});

const pageFooterNodeSchema = z.strictObject({
  type: z.literal("pageFooter"),
  content: z.array(inlineNodeSchema).min(1),
});

/**
 * Block-layout envelope (reframe M-A): per-block presentation choices. The
 * permitted presets per blockKey are enforced by the renderers (T22/T23);
 * the schema keeps the envelope closed and typed.
 */
const blockLayoutSchema = z.strictObject({
  preset: z.string().min(1).max(40).optional(),
  columns: z.int().min(1).max(3).optional(),
  density: z.enum(["normal", "compact"]).optional(),
  borders: z.enum(["grid", "rules"]).optional(),
  /** Template-level column overrides for the results grid (keys hidden). */
  hiddenColumns: z.array(z.string().min(1).max(60)).max(40).optional(),
});

export type CertificateBlockLayout = z.infer<typeof blockLayoutSchema>;

const lockedBlockNodeSchema = z.strictObject({
  type: z.literal("lockedBlock"),
  attrs: z.strictObject({
    blockKey: lockedBlockKeySchema,
    layout: blockLayoutSchema.nullish(),
  }),
});

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const topLevelBlockSchema = z.discriminatedUnion("type", [
  lockedBlockNodeSchema,
  paragraphNodeSchema,
  headingNodeSchema,
  bulletListNodeSchema,
  orderedListNodeSchema,
  tableNodeSchema,
  imageNodeSchema,
  horizontalRuleNodeSchema,
  pageHeaderNodeSchema,
  pageFooterNodeSchema,
]);

export type CertificateDocumentBlock = z.infer<typeof topLevelBlockSchema>;
export type PlaceholderNode = z.infer<typeof placeholderNodeSchema>;
export type LockedBlockNode = z.infer<typeof lockedBlockNodeSchema>;

export const certificateDocumentSchema = z
  .strictObject({
    type: z.literal("doc"),
    attrs: z.strictObject({
      schemaVersion: z.literal(CERTIFICATE_DOCUMENT_SCHEMA_VERSION),
      theme: z.enum(CERTIFICATE_THEMES),
    }),
    content: z.array(topLevelBlockSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const lockedCounts = new Map<string, number>();
    let headers = 0;
    let footers = 0;
    for (const block of doc.content) {
      if (block.type === "lockedBlock") {
        lockedCounts.set(
          block.attrs.blockKey,
          (lockedCounts.get(block.attrs.blockKey) ?? 0) + 1,
        );
      }
      if (block.type === "pageHeader") headers += 1;
      if (block.type === "pageFooter") footers += 1;
    }
    for (const key of LOCKED_BLOCK_KEYS) {
      const count = lockedCounts.get(key) ?? 0;
      if (count !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["content"],
          message: `mandatory locked block "${key}" must appear exactly once (found ${count})`,
        });
      }
    }
    if (headers > 1) {
      ctx.addIssue({ code: "custom", path: ["content"], message: "at most one pageHeader" });
    }
    if (footers > 1) {
      ctx.addIssue({ code: "custom", path: ["content"], message: "at most one pageFooter" });
    }
  });

export type CertificateDocument = z.infer<typeof certificateDocumentSchema>;

/**
 * v1 documents (pre-reframe: no doc attrs, no block layout) upgrade losslessly
 * to v2: default theme, empty layout envelopes. Applied on READ everywhere
 * (compile, validation, editor load) so persisted v1 drafts keep working.
 */
export function upgradeCertificateDocument(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = Object.fromEntries(Object.entries(input));
  if (record.type !== "doc") return input;
  const attrs = record.attrs;
  const hasVersion =
    attrs &&
    typeof attrs === "object" &&
    Reflect.get(attrs, "schemaVersion") === CERTIFICATE_DOCUMENT_SCHEMA_VERSION;
  if (hasVersion) return input;
  return {
    ...record,
    attrs: {
      schemaVersion: CERTIFICATE_DOCUMENT_SCHEMA_VERSION,
      theme: "technical-form",
      ...(attrs && typeof attrs === "object" ? attrs : {}),
    },
  };
}

export function parseCertificateDocument(input: unknown): CertificateDocument {
  return certificateDocumentSchema.parse(upgradeCertificateDocument(input));
}

export type CertificateDocumentIssue = { path: string; message: string };

export function validateCertificateDocument(
  input: unknown,
):
  | { ok: true; document: CertificateDocument }
  | { ok: false; issues: CertificateDocumentIssue[] } {
  const result = certificateDocumentSchema.safeParse(upgradeCertificateDocument(input));
  if (result.success) return { ok: true, document: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}

/** All placeholder paths used in a document (for catalog validation, T2+). */
export function collectPlaceholderPaths(document: CertificateDocument): string[] {
  const paths: string[] = [];
  const visitInline = (nodes: readonly z.infer<typeof inlineNodeSchema>[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "placeholder") paths.push(node.attrs.path);
    }
  };
  for (const block of document.content) {
    switch (block.type) {
      case "paragraph":
      case "heading":
      case "pageHeader":
      case "pageFooter":
        visitInline(block.content);
        break;
      case "bulletList":
      case "orderedList":
        for (const item of block.content) {
          for (const paragraph of item.content) visitInline(paragraph.content);
        }
        break;
      case "table":
        for (const row of block.content) {
          for (const cell of row.content) {
            for (const paragraph of cell.content) visitInline(paragraph.content);
          }
        }
        break;
      default:
        break;
    }
  }
  return paths;
}
