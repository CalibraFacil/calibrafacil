/**
 * Renders the generated part of docs/architecture/records-retention.md from the
 * schema (see records-retention.ts). The document keeps its prose by hand; only
 * the block between the markers below is rewritten, by
 * `pnpm --dir packages/db retention:inventory`, and a test fails when the block
 * on disk differs from what the schema says today.
 */
import {
  EVIDENCE_CATEGORIES,
  EVIDENCE_CATEGORY_LABELS,
  PLATFORM_EVIDENCE_TABLES,
  buildRetentionInventory,
  edgeLabel,
  evidenceCategory,
  listForeignKeys,
  listTables,
  scopeSourcesOf,
  type EvidenceImpact,
  type ForeignKeyEdge,
  type RetentionInventory,
} from "./records-retention";

export const INVENTORY_BEGIN = "<!-- BEGIN GENERATED: records-retention -->";
export const INVENTORY_END = "<!-- END GENERATED: records-retention -->";

const ACTION_LABEL: Record<ForeignKeyEdge["onDelete"], string> = {
  cascade: "CASCADE",
  restrict: "RESTRICT",
  "no action": "NO ACTION",
  "set null": "SET NULL",
  "set default": "SET DEFAULT",
};

function code(text: string): string {
  return `\`${text}\``;
}

function outgoingClass(edge: ForeignKeyEdge, owned: ReadonlySet<string>) {
  switch (edge.onDelete) {
    case "cascade":
      return owned.has(edgeLabel(edge))
        ? "owned part: removed only with its owner"
        : "VIOLATION";
    case "restrict":
    case "no action":
      return "blocks the delete of the parent";
    case "set null":
    case "set default":
      return edge.parent === "user" || edge.parent === "member"
        ? "actor column: the row stays, the actor reference is cleared"
        : "pointer column: the row stays, the pointer is cleared";
  }
}

function renderEvidenceTables(inventory: RetentionInventory): string[] {
  const edges = listForeignKeys();
  const owned = new Set(
    inventory.ownedPartEdges.map((edge) => `${edge.table}.${edge.column}`),
  );
  const lines: string[] = [];
  for (const category of EVIDENCE_CATEGORIES) {
    const tables = inventory.evidenceTables.filter(
      (entry) => entry.category === category,
    );
    if (tables.length === 0) continue;
    lines.push(
      `### ${EVIDENCE_CATEGORY_LABELS[category]} (${tables.length})`,
      "",
    );
    for (const { table } of tables) {
      const outgoing = edges.filter((edge) => edge.table === table);
      const suffix = PLATFORM_EVIDENCE_TABLES.includes(table)
        ? " Platform-level: never purged with an organization."
        : "";
      if (outgoing.length === 0) {
        lines.push(
          `- ${code(table)}: no foreign keys (soft references only).${suffix}`,
        );
        continue;
      }
      lines.push(`- ${code(table)}${suffix}`);
      for (const edge of outgoing) {
        lines.push(
          `  - ${code(edge.columns.join("+"))} to ${code(edge.parent)}: ${ACTION_LABEL[edge.onDelete]}. ${outgoingClass(edge, owned)}.`,
        );
      }
    }
    lines.push("");
  }
  return lines;
}

function chainText(root: string, impact: EvidenceImpact): string {
  const steps = impact.chain.map(
    (edge) => `${code(edge.table)} (${code(edge.columns.join("+"))})`,
  );
  return [code(root), ...steps].join(" → ");
}

function renderRoots(inventory: RetentionInventory): string[] {
  const lines: string[] = [];
  for (const { root, impacts, cascadeClosure } of inventory.roots) {
    const deletes = impacts.filter((impact) => impact.effect === "deletes");
    const nulls = impacts.filter((impact) => impact.effect === "nulls");
    const blocks = impacts.filter((impact) => impact.effect === "blocks");
    lines.push(
      `### Deleting a ${code(root)} row`,
      "",
      `Rows Postgres deletes along with it (${cascadeClosure.length} tables by CASCADE): ${cascadeClosure.map(code).join(", ") || "none"}.`,
      "",
      `- Evidence deleted by CASCADE: **${deletes.length}**${deletes.length === 0 ? "" : " (violation)"}.`,
      `- Evidence columns nulled by SET NULL: **${nulls.length}**.`,
      `- Evidence tables that make Postgres refuse the delete (RESTRICT / NO ACTION): **${blocks.length}**.`,
      "",
    );
    for (const impact of deletes) {
      lines.push(
        `- VIOLATION: ${chainText(root, impact)} ⇒ ${code(edgeLabel(impact.edge))} deletes ${code(impact.evidence)}`,
      );
    }
    if (nulls.length > 0) {
      lines.push("Nulled:", "");
      for (const impact of nulls) {
        lines.push(
          `- ${chainText(root, impact)} ⇒ ${code(edgeLabel(impact.edge))} (${code(impact.evidence)})`,
        );
      }
      lines.push("");
    }
    if (blocks.length > 0) {
      lines.push("Refused by:", "");
      for (const impact of blocks) {
        lines.push(
          `- ${chainText(root, impact)} ⇒ ${code(edgeLabel(impact.edge))} ${ACTION_LABEL[impact.edge.onDelete]} (${code(impact.evidence)})`,
        );
      }
      lines.push("");
    }
  }
  return lines;
}

function renderOwnership(): string[] {
  const unscoped = listTables()
    .filter((table) => scopeSourcesOf(table.name).length === 0)
    .map((table) => table.name);
  const evidenceUnscoped = unscoped.filter(
    (table) => evidenceCategory(table) !== null,
  );
  return [
    `Tables with no organization footprint (${unscoped.length}): ${unscoped.map(code).join(", ")}.`,
    "",
    `Evidence outside the footprint: ${evidenceUnscoped.map(code).join(", ") || "none"}.`,
    "",
  ];
}

export function renderInventoryBlock(): string {
  const inventory = buildRetentionInventory();
  const evidenceCount = inventory.evidenceTables.length;
  const totalEdges = listForeignKeys().length;
  const cascadeEdges = listForeignKeys().filter(
    (edge) => edge.onDelete === "cascade",
  ).length;
  const lines: string[] = [
    INVENTORY_BEGIN,
    "",
    "<!-- Generated by `pnpm --dir packages/db retention:inventory`; do not edit by hand. -->",
    "",
    "## Evidence tables",
    "",
    `${evidenceCount} evidence tables out of ${listTables().length}; ${totalEdges} foreign keys in schema.ts, ${cascadeEdges} of them ON DELETE CASCADE.`,
    "Each entry lists the foreign keys the table itself carries, which are the only way a parent's deletion reaches it.",
    "",
    ...renderEvidenceTables(inventory),
    "## Delete paths from the roots",
    "",
    "For each root, the CASCADE closure is followed (what Postgres removes with the row), and every foreign key from that closure into an evidence table is classified by what it does to the evidence.",
    "",
    ...renderRoots(inventory),
    "## Organization footprint",
    "",
    ...renderOwnership(),
    INVENTORY_END,
  ];
  return lines.join("\n");
}

/** Replaces the generated block of `document`; throws when the markers are missing. */
export function replaceInventoryBlock(document: string): string {
  const start = document.indexOf(INVENTORY_BEGIN);
  const end = document.indexOf(INVENTORY_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("records-retention.md has no generated block markers");
  }
  return (
    document.slice(0, start) +
    renderInventoryBlock() +
    document.slice(end + INVENTORY_END.length)
  );
}
