import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Locked-block invariant, enforced at the ProseMirror TRANSACTION level
 * (ADR-3: reject-based — one invariant covers delete key, select-all, cut,
 * paste, drag, undo/redo and any future mutation path).
 *
 * Invariant: the multiset of locked blockKeys must be IDENTICAL before and
 * after every document-changing transaction. This simultaneously forbids
 * removal (§7.8.2.1 mandatory content) and duplication (exactly-once, e.g.
 * paste of a copied locked block), while allowing repositioning
 * (delete+insert within one transaction keeps counts equal).
 */

function lockedBlockCounts(doc: PmNode): Map<string, number> {
  const counts = new Map<string, number>();
  doc.descendants((node) => {
    if (node.type.name === "lockedBlock") {
      const key = String(node.attrs.blockKey);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Bands (M-B) join the multiset: the doc content expression already pins
    // their position, this guard adds delete/duplicate protection on the same
    // seam as the locked blocks (defense in depth).
    if (node.type.name === "bandTopIdentity" || node.type.name === "bandPageFooter") {
      const key = `band:${node.type.name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return true;
  });
  return counts;
}

function countsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, count] of a) {
    if (b.get(key) !== count) return false;
  }
  return true;
}

export const lockedBlockGuardKey = new PluginKey("cfLockedBlockGuard");

const OPTIONAL_KEYS = new Set([
  "uncertainty_budget_annex",
  "decision_rule_statement",
]);

export function createLockedBlockGuardPlugin(): Plugin {
  return new Plugin({
    key: lockedBlockGuardKey,
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      const before = lockedBlockCounts(state.doc);
      const after = lockedBlockCounts(tr.doc);
      // Optional blocks may be inserted (0->1) and deleted (1->0), never
      // duplicated; everything else keeps the strict multiset equality.
      for (const key of OPTIONAL_KEYS) {
        if ((after.get(key) ?? 0) > 1) return false;
        before.delete(key);
        after.delete(key);
      }
      return countsEqual(before, after);
    },
  });
}

/** TipTap wrapper so apps/web can just add this to the editor's extensions. */
export const LockedBlockGuard = Extension.create({
  name: "lockedBlockGuard",
  addProseMirrorPlugins() {
    return [createLockedBlockGuardPlugin()];
  },
});
