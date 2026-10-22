import {
  groupMetaOf,
  varMetaOf,
  type GroupMeta,
  type RuntimeName,
  type VarMeta,
} from "./define.ts";
import { RUNTIME_SPECS } from "./runtimes.ts";

/** One variable as the documentation lists it. */
export interface CatalogEntry {
  readonly meta: VarMeta;
  /** The runtimes whose configuration includes it. */
  readonly runtimes: readonly RuntimeName[];
}

export interface CatalogSection {
  readonly group: GroupMeta;
  readonly entries: readonly CatalogEntry[];
}

/**
 * The sections of one runtime, in declaration order. A variable that several
 * groups share (NODE_ENV, VERCEL, ...) is listed once, in the first group that
 * declares it.
 */
export function catalogFor(runtime: RuntimeName): CatalogSection[] {
  const spec = RUNTIME_SPECS.find((candidate) => candidate.name === runtime);
  if (!spec) throw new Error(`Unknown runtime ${runtime}`);

  const seen = new Set<string>();
  const sections: CatalogSection[] = [];
  for (const groupSchema of Object.values(spec.groups)) {
    const group = groupMetaOf(groupSchema);
    if (!group) continue;
    const entries: CatalogEntry[] = [];
    for (const schema of Object.values(group.vars)) {
      const meta = varMetaOf(schema);
      if (!meta || seen.has(meta.env)) continue;
      seen.add(meta.env);
      entries.push({ meta, runtimes: runtimesDeclaring(meta.env) });
    }
    if (entries.length > 0) sections.push({ group, entries });
  }
  return sections;
}

function runtimesDeclaring(env: string): RuntimeName[] {
  return RUNTIME_SPECS.filter((spec) =>
    Object.values(spec.groups).some((groupSchema) =>
      Object.values(groupMetaOf(groupSchema)?.vars ?? {}).some(
        (schema) => varMetaOf(schema)?.env === env,
      ),
    ),
  ).map((spec) => spec.name);
}

/** Every variable name a runtime reads. */
export function variableNames(runtime: RuntimeName): ReadonlySet<string> {
  return new Set(
    catalogFor(runtime).flatMap((section) =>
      section.entries.map((entry) => entry.meta.env),
    ),
  );
}
