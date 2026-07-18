import { getSchema } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { AllSelection, EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { certificateEditorExtensions } from "./extensions.js";
import { createLockedBlockGuardPlugin } from "./locked-guard.js";
import { completeWysiwygDocument } from "./starter-document.js";

const schema = getSchema(certificateEditorExtensions());

function countLocked(doc: PmNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "lockedBlock") count += 1;
    return true;
  });
  return count;
}

function makeState(): EditorState {
  const doc = schema.nodeFromJSON(completeWysiwygDocument());
  return EditorState.create({ doc, plugins: [createLockedBlockGuardPlugin()] });
}

function findLockedPositions(doc: PmNode): { pos: number; blockKey: string }[] {
  const found: { pos: number; blockKey: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "lockedBlock") {
      found.push({ pos, blockKey: String(node.attrs.blockKey) });
    }
    return true;
  });
  return found;
}

function countBands(doc: PmNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "bandTopIdentity" || node.type.name === "bandPageFooter") {
      count += 1;
    }
    return true;
  });
  return count;
}

describe("locked-block guard (headless ProseMirror)", () => {
  it("parses the starter document into the TipTap schema with all 12 locked blocks", () => {
    const state = makeState();
    expect(countLocked(state.doc)).toBe(12);
    expect(countBands(state.doc)).toBe(2);
  });

  it("free canvas: deleting a band is ALLOWED (bands optional)", () => {
    const state = makeState();
    const top = state.doc.child(0);
    expect(top.type.name).toBe("bandTopIdentity");
    const tr = state.tr.delete(0, top.nodeSize);
    const applied = state.applyTransaction(tr);
    expect(countBands(applied.state.doc)).toBe(1);
  });

  it("free canvas: a targeted block deletion is ALLOWED", () => {
    const state = makeState();
    const target = findLockedPositions(state.doc)[0];
    expect(target).toBeDefined();
    if (!target) return;
    const tr = state.tr.delete(target.pos, target.pos + 2);
    const applied = state.applyTransaction(tr);
    expect(countLocked(applied.state.doc)).toBe(11);
  });

  it("rejects pasting/inserting a DUPLICATE locked block (exactly-once)", () => {
    const state = makeState();
    const lockedBlockType = schema.nodes.lockedBlock;
    expect(lockedBlockType).toBeDefined();
    if (!lockedBlockType) return;
    const duplicate = lockedBlockType.create({ blockKey: "results_table" });
    const tr = state.tr.insert(state.doc.content.size, duplicate);
    const applied = state.applyTransaction(tr);
    expect(countLocked(applied.state.doc)).toBe(12);
  });

  it("allows REPOSITIONING a locked block (delete+insert in one transaction)", () => {
    const state = makeState();
    const target = findLockedPositions(state.doc)[0];
    expect(target).toBeDefined();
    if (!target) return;
    const node = state.doc.nodeAt(target.pos);
    expect(node?.type.name).toBe("lockedBlock");
    if (!node) return;
    const tr = state.tr.delete(target.pos, target.pos + node.nodeSize);
    // Re-insert at the end of the BODY (before the trailing bandPageFooter —
    // the doc content expression forbids blocks after it).
    const footer = tr.doc.child(tr.doc.childCount - 1);
    expect(footer.type.name).toBe("bandPageFooter");
    tr.insert(tr.doc.content.size - footer.nodeSize, node);
    const applied = state.applyTransaction(tr);
    expect(applied.state.doc.eq(state.doc)).toBe(false);
    expect(countLocked(applied.state.doc)).toBe(12);
    const moved = findLockedPositions(applied.state.doc);
    expect(moved.at(-1)?.blockKey).toBe(target.blockKey);
  });

  it("allows editing and deleting editable text", () => {
    const state = makeState();
    // Find the H1 title (the starter opens with the masthead locked block).
    let titlePos = -1;
    let titleSize = 0;
    state.doc.descendants((node, pos) => {
      if (titlePos === -1 && node.type.name === "heading") {
        titlePos = pos;
        titleSize = node.content.size;
      }
      return titlePos === -1;
    });
    expect(titlePos).toBeGreaterThan(-1);
    const tr = state.tr
      .setSelection(TextSelection.create(state.doc, titlePos + 1, titlePos + 1 + titleSize))
      .deleteSelection()
      .insertText("Certificado de Ensaio");
    const applied = state.applyTransaction(tr);
    expect(applied.state.doc.eq(state.doc)).toBe(false);
    let editedTitle = "";
    applied.state.doc.descendants((node) => {
      if (editedTitle === "" && node.type.name === "heading") {
        editedTitle = node.textContent;
      }
      return editedTitle === "";
    });
    expect(editedTitle).toBe("Certificado de Ensaio");
    expect(countLocked(applied.state.doc)).toBe(12);
  });

  it("non-doc-changing transactions (selection only) pass through", () => {
    const state = makeState();
    const tr = state.tr.setSelection(new AllSelection(state.tr.doc));
    const applied = state.applyTransaction(tr);
    expect(applied.state.selection.from).toBe(0);
  });
});
