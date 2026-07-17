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

export const PageHeader = Node.create({
  name: "pageHeader",
  group: "block",
  content: "inline*",
  addAttributes() {
    return {};
  },
  parseHTML() {
    return [{ tag: "header[data-page-header]" }];
  },
  renderHTML() {
    return ["header", { "data-page-header": "true", class: "cf-page-header" }, 0];
  },
});

export const PageFooter = Node.create({
  name: "pageFooter",
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: "footer[data-page-footer]" }];
  },
  renderHTML() {
    return ["footer", { "data-page-footer": "true", class: "cf-page-footer" }, 0];
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
          schemaVersion: { default: 2 },
          theme: { default: "technical-form" },
        },
      },
    ];
  },
});

export function certificateEditorExtensions(): Extensions {
  return [
    CertificateDocAttributes,
    StarterKit.configure({
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
    PageHeader,
    PageFooter,
    CertImage,
  ];
}
