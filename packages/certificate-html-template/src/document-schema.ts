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

export const CERTIFICATE_DOCUMENT_SCHEMA_VERSION = 3;

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

/**
 * Optional blocks (backlog #11): 0-or-1 occurrences, same lockedBlock node
 * type. Content renders from frozen method data and SILENTLY omits when the
 * method does not opt in — safe to leave in a template used across methods.
 */
export const OPTIONAL_BLOCK_KEYS = [
  "uncertainty_budget_annex",
  "decision_rule_statement",
] as const;

export type LockedBlockKey =
  | (typeof LOCKED_BLOCK_KEYS)[number]
  | (typeof OPTIONAL_BLOCK_KEYS)[number];

const lockedBlockKeySchema = z.enum([
  ...LOCKED_BLOCK_KEYS,
  ...OPTIONAL_BLOCK_KEYS,
]);

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

/**
 * M-C (backlog #7 lifted): merged cells are allowed in AUTHORED tables, with
 * sane print bounds. The generated results data-grid is untouched — its shape
 * stays derived from the method, never authored.
 */
const tableColspanSchema = z.int().min(1).max(8).nullish();
const tableRowspanSchema = z.int().min(1).max(20).nullish();

const tableCellAttrsSchema = z.strictObject({
  colspan: tableColspanSchema,
  rowspan: tableRowspanSchema,
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

// ---------------------------------------------------------------------------
// Bands (reframe M-B) — page furniture that repeats on EVERY page.
//
// `bandTopIdentity` compiles into the <thead> of the document-wrapping table:
// Chromium repeats it on every printed page, page 1 included (a thead cannot
// vary per page — NIE-CGCRE-009 wants the certificate identity on every page,
// so the page-1 "variant" is simply identity band + full masthead).
// `bandPageFooter` compiles into the Chromium footerTemplate (the only place
// pageNumber/totalPages exist), embedded in the html artifact as
// <template id="cf-page-footer"> and extracted by the worker.
//
// Both are LEAF nodes: their content is derived from inputData + these config
// attrs, never authored inline. Exactly-once, pinned first/last in `content`.
// ---------------------------------------------------------------------------

/**
 * M-C band element SLOTS — additive optional attrs on the v3 band nodes.
 * Absent/null slots reproduce the M-B arrangement byte-identically, so stored
 * documents compile unchanged until an admin touches a slot. Placement stays
 * slot-based (no coordinates): left/right on the identity row, line2 below.
 */
const bandRowSlotSchema = z.enum(["left", "right"]).nullish();
const bandSealSlotSchema = z.enum(["line2", "left", "right"]).nullish();

const bandTopIdentityNodeSchema = z.strictObject({
  type: z.literal("bandTopIdentity"),
  attrs: z.strictObject({
    enabled: z.boolean(),
    showLabName: z.boolean(),
    showCertificateNumber: z.boolean(),
    showTitle: z.boolean(),
    /** Accreditation-as-text on every page (the seal IMAGE stays page-1 only). */
    showSealText: z.boolean(),
    /** Slots (M-C): defaults — labName/title left, certNumber right, sealText line2. */
    labNameSlot: bandRowSlotSchema,
    titleSlot: bandRowSlotSchema,
    certificateNumberSlot: bandRowSlotSchema,
    sealTextSlot: bandSealSlotSchema,
  }),
});

const bandPageFooterNodeSchema = z.strictObject({
  type: z.literal("bandPageFooter"),
  attrs: z.strictObject({
    enabled: z.boolean(),
    showCertificateNumber: z.boolean(),
    showLabName: z.boolean(),
    showIssueDate: z.boolean(),
    // "Página X de Y" is mandatory (NIE-CGCRE-009) — always rendered.
    /** Slot (M-C): identity side; page numbers take the opposite side. */
    identitySide: bandRowSlotSchema,
  }),
});

export type BandTopIdentityNode = z.infer<typeof bandTopIdentityNodeSchema>;
export type BandPageFooterNode = z.infer<typeof bandPageFooterNodeSchema>;

export const DEFAULT_BAND_TOP_IDENTITY_ATTRS = {
  enabled: true,
  showLabName: true,
  showCertificateNumber: true,
  showTitle: false,
  showSealText: true,
} satisfies BandTopIdentityNode["attrs"];

export const DEFAULT_BAND_PAGE_FOOTER_ATTRS = {
  enabled: true,
  showCertificateNumber: true,
  showLabName: false,
  showIssueDate: false,
} satisfies BandPageFooterNode["attrs"];

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

/**
 * Template-level style tokens (roadmap item 7). Additive and optional, like
 * band slots: `accent` overrides the theme's `--accent` (curated swatches in
 * the editor; any 6-digit hex validates), `fontScale` multiplies the `--size-*`
 * tokens — the print floors (body 10pt / cell 9pt / label 8.5pt / caption 8pt)
 * are clamped by the compiler, never undercut.
 */
export const CERTIFICATE_FONT_SCALES = [0.9, 1, 1.1] as const;
export type CertificateFontScale = (typeof CERTIFICATE_FONT_SCALES)[number];

const styleTokensSchema = z.strictObject({
  accent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  fontScale: z
    .union([z.literal(0.9), z.literal(1), z.literal(1.1)])
    .optional(),
});

export type CertificateStyleTokens = z.infer<typeof styleTokensSchema>;

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
]);

const contentNodeSchema = z.discriminatedUnion("type", [
  lockedBlockNodeSchema,
  paragraphNodeSchema,
  headingNodeSchema,
  bulletListNodeSchema,
  orderedListNodeSchema,
  tableNodeSchema,
  imageNodeSchema,
  horizontalRuleNodeSchema,
  bandTopIdentityNodeSchema,
  bandPageFooterNodeSchema,
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
      styleTokens: styleTokensSchema.nullish(),
      /** Render block titles / field labels as "PT / EN" (item 8). Labels only. */
      bilingual: z.boolean().nullish(),
    }),
    // Band nodes pinned: bandTopIdentity first, bandPageFooter last, body
    // blocks in between (>= 1). Mirrors the ProseMirror doc content
    // expression "bandTopIdentity block+ bandPageFooter".
    content: z.array(contentNodeSchema).min(3),
  })
  .superRefine((doc, ctx) => {
    const lockedCounts = new Map<string, number>();
    let topBands = 0;
    let footerBands = 0;
    for (const block of doc.content) {
      if (block.type === "lockedBlock") {
        lockedCounts.set(
          block.attrs.blockKey,
          (lockedCounts.get(block.attrs.blockKey) ?? 0) + 1,
        );
      }
      if (block.type === "bandTopIdentity") topBands += 1;
      if (block.type === "bandPageFooter") footerBands += 1;
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
    for (const key of OPTIONAL_BLOCK_KEYS) {
      const count = lockedCounts.get(key) ?? 0;
      if (count > 1) {
        ctx.addIssue({
          code: "custom",
          path: ["content"],
          message: `optional block "${key}" must appear at most once (found ${count})`,
        });
      }
    }
    if (topBands !== 1 || doc.content[0]?.type !== "bandTopIdentity") {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: `bandTopIdentity must appear exactly once, as the first node (found ${topBands})`,
      });
    }
    if (
      footerBands !== 1 ||
      doc.content[doc.content.length - 1]?.type !== "bandPageFooter"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: `bandPageFooter must appear exactly once, as the last node (found ${footerBands})`,
      });
    }
  });

export type CertificateDocument = z.infer<typeof certificateDocumentSchema>;

/**
 * Older documents upgrade losslessly on READ (compile, validation, editor
 * load), so persisted drafts keep working:
 * - v1 (pre-reframe): no doc attrs, no block layout -> default theme.
 * - v2 (M-A): no bands -> default band nodes inserted first/last; the
 *   vestigial v1/v2 `pageHeader`/`pageFooter` flow nodes (free inline text,
 *   never repeating) are converted to plain paragraphs so no authored text is
 *   lost.
 */
export function upgradeCertificateDocument(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = Object.fromEntries(Object.entries(input));
  if (record.type !== "doc") return input;
  const attrs = record.attrs;
  const version =
    attrs && typeof attrs === "object" ? Reflect.get(attrs, "schemaVersion") : undefined;
  if (version === CERTIFICATE_DOCUMENT_SCHEMA_VERSION) return input;

  const upgradedAttrs = {
    theme: "technical-form",
    ...(attrs && typeof attrs === "object" ? attrs : {}),
    schemaVersion: CERTIFICATE_DOCUMENT_SCHEMA_VERSION,
  };

  const rawContent = Array.isArray(record.content) ? record.content : [];
  const body: unknown[] = [];
  let topBand: unknown = null;
  let footerBand: unknown = null;
  for (const node of rawContent) {
    if (!node || typeof node !== "object") continue;
    const type = Reflect.get(node, "type");
    if (type === "bandTopIdentity") {
      topBand = node;
    } else if (type === "bandPageFooter") {
      footerBand = node;
    } else if (type === "pageHeader" || type === "pageFooter") {
      const content = Reflect.get(node, "content");
      if (Array.isArray(content) && content.length > 0) {
        body.push({ type: "paragraph", content });
      }
    } else {
      body.push(node);
    }
  }

  return {
    ...record,
    attrs: upgradedAttrs,
    content: [
      topBand ?? {
        type: "bandTopIdentity",
        attrs: { ...DEFAULT_BAND_TOP_IDENTITY_ATTRS },
      },
      ...body,
      footerBand ?? {
        type: "bandPageFooter",
        attrs: { ...DEFAULT_BAND_PAGE_FOOTER_ATTRS },
      },
    ],
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
