/**
 * Spike: Plate (Slate) as the WYSIWYG stack for certificate templates.
 * Mirror of ../tiptap/spike.mjs — same 6 assertions, headless (no browser).
 *
 *  1. Custom plugins: locked block (void element) + typed inline-void placeholder.
 *  2. Locked-node robustness at the MODEL level: select-all+delete and targeted
 *     removal must not drop the locked block (guard = overridden editor.apply,
 *     Slate has no reject-based schema).
 *  3. Typed placeholder catalog: unknown path => compile error.
 *  4. Deterministic JSON -> HTML via `serializeHtml` from platejs/static
 *     (documented DOM-free path); 5 renders sha256-compared; hash printed for
 *     cross-runtime (Node vs Bun) comparison.
 *
 * Run:  node spike.mjs   AND   bun spike.mjs   — hashes must match.
 */
import { createHash } from "node:crypto";
import React from "react";
import { createSlateEditor, createSlatePlugin, BaseParagraphPlugin } from "platejs";
import { serializeHtml } from "platejs/static";

// ---------------------------------------------------------------------------
// 1. Plugins: placeholder (inline void) + locked_block (block void)
// ---------------------------------------------------------------------------

const injectedResultsTable =
  "<table><thead><tr><th>Ponto</th><th>Valor</th><th>U (k=2)</th></tr></thead>" +
  "<tbody><tr><td>10 kg</td><td>10,0001 kg</td><td>0,0004 kg</td></tr></tbody></table>";

function PlaceholderStatic(props) {
  return React.createElement(
    "span",
    { "data-placeholder-path": props.element.path },
    `{{${props.element.path}}}`,
    props.children,
  );
}

function LockedBlockStatic(props) {
  return React.createElement("section", {
    "data-locked-block": props.element.blockKey,
    dangerouslySetInnerHTML: { __html: injectedResultsTable },
  });
}

const PlaceholderPlugin = createSlatePlugin({
  key: "placeholder",
  node: { isElement: true, isInline: true, isVoid: true },
});

const LockedBlockPlugin = createSlatePlugin({
  key: "locked_block",
  node: { isElement: true, isVoid: true },
});

// ---------------------------------------------------------------------------
// Template document (Slate value)
// ---------------------------------------------------------------------------

const templateValue = [
  { type: "p", children: [{ text: "Certificado de Calibração" }] },
  {
    type: "p",
    children: [
      { text: "Cliente: " },
      { type: "placeholder", path: "customer.name", label: "Razão social", children: [{ text: "" }] },
    ],
  },
  { type: "locked_block", blockKey: "results_table", children: [{ text: "" }] },
  {
    type: "p",
    children: [
      { text: "Incerteza expandida: " },
      { type: "placeholder", path: "uncertainty.expanded", label: "U", children: [{ text: "" }] },
      { text: " (k = " },
      { type: "placeholder", path: "uncertainty.coverageFactor", label: "k", children: [{ text: "" }] },
      { text: ")" },
    ],
  },
  { type: "p", children: [{ text: "Observações editáveis do laboratório." }] },
];

function makeEditor() {
  return createSlateEditor({
    plugins: [BaseParagraphPlugin, PlaceholderPlugin, LockedBlockPlugin],
    value: structuredClone(templateValue),
    // FINDING: without this, Plate's default NodeIdPlugin injects RANDOM nanoid
    // block ids (data-block-id / data-slate-id) into the value at editor
    // creation, making serializeHtml output non-deterministic run-to-run.
    override: { enabled: { nodeId: false } },
    components: {
      placeholder: PlaceholderStatic,
      locked_block: LockedBlockStatic,
    },
  });
}

// ---------------------------------------------------------------------------
// 2. Locked-node guard: Slate has no reject-based schema; the known pattern is
//    overriding editor.apply to drop operations that would remove the node.
// ---------------------------------------------------------------------------

function countLocked(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "locked_block") n += 1;
    if (Array.isArray(node.children)) n += countLocked(node.children);
  }
  return n;
}

function withLockedGuard(editor) {
  const origApply = editor.apply;
  editor.apply = (op) => {
    if (op.type === "remove_node" && op.node?.type === "locked_block") return;
    if (op.type === "merge_node" && op.properties?.type === "locked_block") return;
    if (op.type === "set_node" && editor.children[op.path?.[0]]?.type === "locked_block") return;
    origApply(op);
  };
  return editor;
}

// ---------------------------------------------------------------------------
// 3. Typed placeholder catalog: unknown path = compile error
// ---------------------------------------------------------------------------

const CATALOG = new Set([
  "customer.name",
  "asset.tag",
  "uncertainty.expanded",
  "uncertainty.coverageFactor",
]);

function validatePlaceholders(nodes) {
  const errors = [];
  const walk = (list) => {
    for (const node of list) {
      if (node.type === "placeholder") {
        if (!node.path) errors.push("placeholder missing required prop `path`");
        else if (!CATALOG.has(node.path)) errors.push(`unknown placeholder path: ${node.path}`);
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(nodes);
  if (errors.length) throw new Error(`template compile error:\n  ${errors.join("\n  ")}`);
}

// ---------------------------------------------------------------------------
// Run the tests
// ---------------------------------------------------------------------------

const results = {};
const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;

// T1: editor accepts the template value
{
  const editor = makeEditor();
  results.schema_parses_doc = countLocked(editor.children) === 1;
}

// T2: select-all + delete — locked block must survive
{
  const editor = withLockedGuard(makeEditor());
  editor.tf.delete({
    at: { anchor: editor.api.start([]), focus: editor.api.end([]) },
  });
  results.select_all_delete_rejected = countLocked(editor.children) === 1;
}

// T3: targeted removal of the locked block node — must survive
{
  const editor = withLockedGuard(makeEditor());
  editor.tf.removeNodes({ at: [2] }); // locked_block index in templateValue
  results.targeted_locked_delete_rejected = countLocked(editor.children) === 1;
}

// T4: normal edits (deleting editable text) still work
{
  const editor = withLockedGuard(makeEditor());
  const before = JSON.stringify(editor.children);
  editor.tf.delete({
    at: {
      anchor: { path: [4, 0], offset: 0 },
      focus: { path: [4, 0], offset: 12 },
    },
  });
  results.editable_delete_allowed =
    JSON.stringify(editor.children) !== before && countLocked(editor.children) === 1;
}

// T5: unknown placeholder path => compile error
{
  const bad = structuredClone(templateValue);
  bad[1].children[1].path = "asset.doesNotExist";
  let threw = false;
  try {
    validatePlaceholders(bad);
  } catch (e) {
    threw = /unknown placeholder path: asset\.doesNotExist/.test(e.message);
  }
  results.unknown_placeholder_is_error = threw;
  validatePlaceholders(templateValue); // good doc must pass
}

// T6: deterministic headless JSON -> HTML
async function compileToHtml() {
  validatePlaceholders(templateValue);
  const editor = makeEditor();
  return serializeHtml(editor, { stripClassNames: true, stripDataAttributes: false });
}

{
  const hashes = new Set();
  for (let i = 0; i < 5; i++) {
    hashes.add(createHash("sha256").update(await compileToHtml()).digest("hex"));
  }
  results.render_deterministic_5x = hashes.size === 1;
  results.html_sha256 = [...hashes][0];
}

const pass = Object.entries(results).every(([k, v]) => k === "html_sha256" || v === true);
console.log(JSON.stringify({ spike: "plate", runtime, pass, results }, null, 2));
if (!pass) process.exit(1);
