# Spike: WYSIWYG editor stack finalists (epic: wysiwyg, Phase 1)

Proof-of-concept for `docs/epics/wysiwyg/01-adr-editor-stack.md`. Two finalists
(TipTap, Plate — Lexical was eliminated on research evidence: its only headless
HTML path hard-requires JSDOM via global monkey-patching). Each spike proves,
fully headless (no browser, no DOM):

1. Custom schema: locked block node + typed inline placeholder node.
2. Locked-node survives select-all+delete and targeted deletion at the model level.
3. Unknown placeholder path ⇒ compile error (typed catalog).
4. Deterministic JSON→HTML: 5 renders sha256-identical, **and identical across
   Node 22 and Bun 1.4** (the API/worker runtime).

Run (each dir is npm-isolated, outside the pnpm workspace):

```bash
cd tiptap && npm install && node spike.mjs && bun spike.mjs
cd plate  && npm install && node spike.mjs && bun spike.mjs
```

Results 2026-07-06 (see the ADR for the full comparison):

| | TipTap 3.27.2 | Plate 53.2.4 |
|---|---|---|
| All 6 assertions | PASS (node+bun) | PASS (node+bun) |
| HTML sha256 (node == bun) | `e70b5b1f…` | `9d3a2b43…` |
| Guard mechanism | `filterTransaction` — rejects the whole invalid transaction (true reject-based) | monkey-patched `editor.apply` dropping per-op types (`remove_node`, `merge_node`, `set_node`) — enumeration is on us |
| Server deps for compile | none beyond @tiptap/* (sync, no React) | React + react-dom required server-side; `serializeHtml` is async |
| Determinism footgun found | none | default `NodeIdPlugin` injects RANDOM nanoid block ids → nondeterministic HTML until `override: { enabled: { nodeId: false } }` |
| Output cleanliness | exactly what `renderHTML`/`nodeMapping` emits | wrapped in `slate-editor` divs + `data-slate-*` attributes + inline `style="position:relative"` noise |

This directory is throwaway evidence, not production code.
