import { Extension, Node, mergeAttributes } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { StarterKit } from "@tiptap/starter-kit";

/**
 * TipTap schema layer for the certificate template document (spec 02 §0).
 * Pure @tiptap/core — no React. Shared by the editor (apps/web) and the
 * compiler/static renderer, so both always agree with `document-schema.ts`
 * (the round-trip is pinned by extensions.spec.ts).
 *
 * The block catalog is CLOSED (ADR-2): starter-kit extras are disabled, and
 * ProseMirror's reject-based schema strips anything not defined here.
 */

/** Inline typed placeholder — an atom: never partially editable/splittable. */
export const CertPlaceholder = Node.create({
  name: "placeholder",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      path: { default: null },
      label: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-placeholder-path]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-placeholder-path": node.attrs.path,
        class: "cf-placeholder",
      }),
      `{{${node.attrs.path}}}`,
    ];
  },
});

/**
 * Locked mandatory block (§7.8.2.1 content). Atom + isolating; content is
 * compiler-injected, never editable. Draggable so the admin can REPOSITION it
 * (a move is delete+insert in ONE transaction — the guard allows it because
 * the per-key count is unchanged).
 */
export const LockedBlock = Node.create({
  name: "lockedBlock",
  group: "block",
  atom: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return { blockKey: { default: null }, layout: { default: null } };
  },
  parseHTML() {
    return [{ tag: "section[data-locked-block]" }];
  },
  renderHTML({ node }) {
    return [
      "section",
      { "data-locked-block": node.attrs.blockKey, class: "cf-locked-block" },
    ];
  },
});

/**
 * Certificate doc node (M-B): bands are pinned structurally — the content
 * expression makes bandTopIdentity the first and bandPageFooter the last child
 * of every document, so no editing gesture can remove, duplicate or move them.
 */
export const CertificateDoc = Node.create({
  name: "doc",
  topNode: true,
  content: "bandTopIdentity block+ bandPageFooter",
});

/**
 * Page bands (M-B): LEAF nodes — their rendered content is derived from the
 * certificate input data + config attrs, never authored inline. Deliberately
 * no `group: "block"` (they cannot be inserted into the body) and not
 * draggable (position is fixed by the doc content expression).
 */
export const BandTopIdentity = Node.create({
  name: "bandTopIdentity",
  atom: true,
  isolating: true,
  selectable: true,
  addAttributes() {
    return {
      enabled: { default: true },
      showLabName: { default: true },
      showCertificateNumber: { default: true },
      showTitle: { default: false },
      showSealText: { default: true },
      labNameSlot: { default: null },
      titleSlot: { default: null },
      certificateNumberSlot: { default: null },
      sealTextSlot: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-band-top-identity]" }];
  },
  renderHTML() {
    return ["div", { "data-band-top-identity": "true", class: "cf-band-top-identity" }];
  },
});

export const BandPageFooter = Node.create({
  name: "bandPageFooter",
  atom: true,
  isolating: true,
  selectable: true,
  addAttributes() {
    return {
      enabled: { default: true },
      showCertificateNumber: { default: true },
      showLabName: { default: false },
      showIssueDate: { default: false },
      identitySide: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-band-page-footer]" }];
  },
  renderHTML() {
    return ["div", { "data-band-page-footer": "true", class: "cf-band-page-footer" }];
  },
});

/** Org-media image — referenced by mediaId, never a raw URL (spec 02 §2). */
export const CertImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      mediaId: { default: null },
      alt: { default: null },
      widthMm: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-media-id]" }];
  },
  renderHTML({ node }) {
    return [
      "figure",
      {
        "data-media-id": node.attrs.mediaId,
        class: "cf-image",
      },
    ];
  },
});

/**
 * The full extension set for certificate templates. Everything outside the
 * closed catalog is disabled; heading levels match the Zod schema (1-4).
 */
/** Carries schemaVersion/theme on the doc node so getJSON round-trips them. */
const CertificateDocAttributes = Extension.create({
  name: "certificateDocAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          schemaVersion: { default: 3 },
          theme: { default: "technical-form" },
        },
      },
    ];
  },
});

export function certificateEditorExtensions(): Extensions {
  return [
    CertificateDocAttributes,
    CertificateDoc,
    StarterKit.configure({
      document: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      hardBreak: false,
      strike: false,
      link: false,
      underline: false,
      horizontalRule: {},
      heading: { levels: [1, 2, 3, 4] },
    }),
    Table,
    TableRow,
    TableCell,
    TableHeader,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    LockedBlock,
    CertPlaceholder,
    BandTopIdentity,
    BandPageFooter,
    CertImage,
  ];
}
