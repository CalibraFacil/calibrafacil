/**
 * Spike: TipTap (ProseMirror) as the WYSIWYG stack for certificate templates.
 *
 * Proves/measures, fully headless (no browser, no editor instance):
 *  1. Custom schema: locked block node (atom) + typed inline placeholder node.
 *  2. Locked-node robustness at the MODEL level: select-all+delete and targeted
 *     range deletion are rejected by a filterTransaction guard plugin.
 *  3. Typed placeholder catalog: unknown placeholder path => compile error.
 *  4. Deterministic JSON -> HTML via @tiptap/static-renderer (no DOM at all):
 *     5 renders, sha256-compared; hash printed for cross-runtime (Node vs Bun)
 *     comparison.
 *
 * Run:  node spike.mjs   AND   bun spike.mjs   — hashes must match.
 */
import { createHash } from "node:crypto";
import { Node, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import { EditorState, Plugin, AllSelection, TextSelection } from "@tiptap/pm/state";

// ---------------------------------------------------------------------------
// 1. Schema: placeholder (typed inline atom) + lockedBlock (block atom)
// ---------------------------------------------------------------------------

const Placeholder = Node.create({
  name: "placeholder",
  group: "inline",
  inline: true,
  atom: true, // opaque unit: cannot be partially edited/split
  addAttributes() {
    return {
      path: { default: null },
      label: { default: null },
    };
  },
  renderHTML({ node }) {
    return [
      "span",
      { "data-placeholder-path": node.attrs.path, class: "cf-placeholder" },
      `{{${node.attrs.path}}}`,
    ];
  },
});

const LockedBlock = Node.create({
  name: "lockedBlock",
  group: "block",
  atom: true,
  isolating: true,
  selectable: false,
  addAttributes() {
    return { blockKey: { default: null } };
  },
  renderHTML({ node }) {
    return ["section", { "data-locked-block": node.attrs.blockKey }];
  },
});

const extensions = [StarterKit, Placeholder, LockedBlock];
const schema = getSchema(extensions);

// ---------------------------------------------------------------------------
// Template document (what the editor would persist as documentJson)
// ---------------------------------------------------------------------------

const templateDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Certificado de Calibração" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Cliente: " },
        { type: "placeholder", attrs: { path: "customer.name", label: "Razão social" } },
      ],
    },
    { type: "lockedBlock", attrs: { blockKey: "results_table" } },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Incerteza expandida: " },
        { type: "placeholder", attrs: { path: "uncertainty.expanded", label: "U" } },
        { type: "text", text: " (k = " },
        { type: "placeholder", attrs: { path: "uncertainty.coverageFactor", label: "k" } },
        { type: "text", text: ")" },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Observações editáveis do laboratório." }],
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Locked-node guard: filterTransaction rejects any tx that drops a locked block
// ---------------------------------------------------------------------------

function countLocked(doc) {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "lockedBlock") n += 1;
  });
  return n;
}

const lockedGuard = new Plugin({
  filterTransaction(tr, state) {
    if (!tr.docChanged) return true;
    return countLocked(tr.doc) >= countLocked(state.doc);
  },
});

// ---------------------------------------------------------------------------
// 3. Typed placeholder catalog: unknown path = compile error
// ---------------------------------------------------------------------------

const CATALOG = new Set([
  "customer.name",
  "asset.tag",
  "uncertainty.expanded",
  "uncertainty.coverageFactor",
]);

function validatePlaceholders(docJson) {
  const errors = [];
  const walk = (node) => {
    if (node.type === "placeholder") {
      const path = node.attrs?.path;
      if (!path) errors.push("placeholder missing required attr `path`");
      else if (!CATALOG.has(path)) errors.push(`unknown placeholder path: ${path}`);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(docJson);
  if (errors.length) throw new Error(`template compile error:\n  ${errors.join("\n  ")}`);
}

// ---------------------------------------------------------------------------
// Run the tests
// ---------------------------------------------------------------------------

const results = {};
const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;

// T1: schema accepts the template document
const doc = schema.nodeFromJSON(templateDoc);
results.schema_parses_doc = countLocked(doc) === 1;

// T2: select-all + delete is rejected (locked block survives)
{
  let state = EditorState.create({ doc, plugins: [lockedGuard] });
  const tr = state.tr.setSelection(new AllSelection(state.tr.doc)).deleteSelection();
  const applied = state.applyTransaction(tr);
  results.select_all_delete_rejected =
    applied.state.doc.eq(state.doc) && countLocked(applied.state.doc) === 1;
}

// T3: targeted deletion of the range containing the locked block is rejected
{
  let state = EditorState.create({ doc, plugins: [lockedGuard] });
  // find locked block position
  let lockedPos = -1;
  state.doc.descendants((node, pos) => {
    if (node.type.name === "lockedBlock") lockedPos = pos;
  });
  const tr = state.tr.delete(lockedPos - 1, lockedPos + 2);
  const applied = state.applyTransaction(tr);
  results.targeted_locked_delete_rejected = countLocked(applied.state.doc) === 1;
}

// T4: normal edits (deleting editable text) still work
{
  let state = EditorState.create({ doc, plugins: [lockedGuard] });
  // delete inside the last paragraph ("Observações...")
  const end = state.doc.content.size;
  const tr = state.tr.setSelection(TextSelection.create(state.doc, end - 10, end - 2)).deleteSelection();
  const applied = state.applyTransaction(tr);
  results.editable_delete_allowed =
    !applied.state.doc.eq(state.doc) && countLocked(applied.state.doc) === 1;
}

// T5: unknown placeholder path => compile error
{
  const bad = structuredClone(templateDoc);
  bad.content[1].content[1].attrs.path = "asset.doesNotExist";
  let threw = false;
  try {
    validatePlaceholders(bad);
  } catch (e) {
    threw = /unknown placeholder path: asset\.doesNotExist/.test(e.message);
  }
  results.unknown_placeholder_is_error = threw;
  validatePlaceholders(templateDoc); // good doc must pass
}

// T6: deterministic headless JSON -> HTML (locked block content INJECTED by compiler)
const injectedResultsTable =
  "<table><thead><tr><th>Ponto</th><th>Valor</th><th>U (k=2)</th></tr></thead>" +
  "<tbody><tr><td>10 kg</td><td>10,0001 kg</td><td>0,0004 kg</td></tr></tbody></table>";

function compileToHtml(docJson) {
  validatePlaceholders(docJson);
  return renderToHTMLString({
    content: docJson,
    extensions,
    options: {
      nodeMapping: {
        lockedBlock: ({ node }) =>
          `<section data-locked-block="${node.attrs.blockKey}">${injectedResultsTable}</section>`,
        placeholder: ({ node }) =>
          `<span data-placeholder-path="${node.attrs.path}">{{${node.attrs.path}}}</span>`,
      },
    },
  });
}

{
  const hashes = new Set();
  for (let i = 0; i < 5; i++) {
    hashes.add(createHash("sha256").update(compileToHtml(templateDoc)).digest("hex"));
  }
  results.render_deterministic_5x = hashes.size === 1;
  results.html_sha256 = [...hashes][0];
}

const pass = Object.entries(results).every(([k, v]) => k === "html_sha256" || v === true);
console.log(JSON.stringify({ spike: "tiptap", runtime, pass, results }, null, 2));
if (!pass) process.exit(1);
