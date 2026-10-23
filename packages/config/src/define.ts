import { z } from "zod";

/**
 * The building blocks of the configuration schema.
 *
 * A *variable* is a Zod schema that reads one environment variable and carries
 * its documentation (`VarMeta`): type, default, whether production requires
 * it, a one-line description and what `.env.example` shows for it. A *group*
 * bundles the variables of one concern (database, storage, e-mail, ...). A
 * *runtime* (api, worker, local-server, web, portal) is a set of groups plus
 * the cross-variable rules of that process.
 *
 * Everything is declared once: the loaders, the generated `.env.example`
 * files and the docs all read the same metadata.
 */

export const RUNTIMES = [
  "api",
  "worker",
  "local-server",
  "web",
  "portal",
] as const;

export type RuntimeName = (typeof RUNTIMES)[number];

/** What the process reads its settings from: `process.env`, or any bag of strings. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export type VarKind =
  | "string"
  | "url"
  | "integer"
  | "boolean"
  | "enum"
  | "list";

/** How a variable appears in a generated `.env.example`. */
export type ExampleSpec =
  | { readonly state: "active"; readonly value: string }
  | { readonly state: "commented"; readonly value: string }
  /** Written as `NAME=`: the setup script fills it with a generated secret. */
  | { readonly state: "generated" };

export const example = {
  /** `NAME=value`: a working development value. */
  active: (value: string): ExampleSpec => ({ state: "active", value }),
  /** `# NAME=value`: optional, shown for reference. */
  commented: (value: string): ExampleSpec => ({ state: "commented", value }),
  /** `NAME=`: left empty for `pnpm setup:dev` to generate. */
  generated: (): ExampleSpec => ({ state: "generated" }),
} as const;

export type RequiredInProduction = boolean | readonly RuntimeName[];

export interface VarMeta {
  /** The environment variable this setting reads. */
  readonly env: string;
  readonly kind: VarKind;
  /** One line: what the variable does. */
  readonly description: string;
  /** Never printed, logged or echoed in errors. */
  readonly secret: boolean;
  /** The value used when the variable is unset. Only where it is safe. */
  readonly default?: string | number | boolean;
  /**
   * Production refuses to start without it: `true` for every runtime that
   * includes the variable, or the list of runtimes that need it.
   */
  readonly requiredInProduction: RequiredInProduction;
  /** Enum values, for `kind: "enum"`. */
  readonly values?: readonly string[];
  /** Smallest accepted length in production, for secrets. */
  readonly minLengthInProduction?: number;
  /** The value must decode to 32 bytes of base64 in production (AES-256 keys). */
  readonly base64Key?: boolean;
  /**
   * A safety switch where an unrecognised value deliberately means the safe
   * default instead of an error (documented on the variable).
   */
  readonly tolerant: boolean;
  /** Set by the platform or by the code itself; omitted from `.env.example`. */
  readonly hidden: boolean;
  readonly example?: ExampleSpec;
}

export interface VarOptions {
  readonly env: string;
  readonly description: string;
  readonly secret?: boolean;
  readonly requiredInProduction?: RequiredInProduction;
  readonly example?: ExampleSpec;
  readonly hidden?: boolean;
}

const varRegistry = new WeakMap<object, VarMeta>();

/** The documentation attached to a variable schema, if it is one. */
export function varMetaOf(schema: z.ZodType): VarMeta | undefined {
  return varRegistry.get(schema);
}

type Registration = Pick<VarMeta, "env" | "kind" | "description"> &
  Partial<Omit<VarMeta, "env" | "kind" | "description">>;

function register<S extends z.ZodType>(schema: S, meta: Registration): S {
  varRegistry.set(schema, {
    ...meta,
    secret: meta.secret ?? false,
    requiredInProduction: meta.requiredInProduction ?? false,
    hidden: meta.hidden ?? false,
    tolerant: meta.tolerant ?? false,
  });
  return schema;
}

/** Empty and whitespace-only values count as unset, like a blank `KEY=` line. */
function blankToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function lowercased(value: unknown): unknown {
  const cleaned = blankToUndefined(value);
  return typeof cleaned === "string" ? cleaned.toLowerCase() : cleaned;
}

// ---------------------------------------------------------------------------
// Variable builders
// ---------------------------------------------------------------------------

export interface TextOptions extends VarOptions {
  readonly minLengthInProduction?: number;
  readonly base64Key?: boolean;
}

export function text(
  opts: TextOptions & { default: string },
): z.ZodType<string>;
export function text(opts: TextOptions): z.ZodType<string | undefined>;
export function text(
  opts: TextOptions & { default?: string },
): z.ZodType<string | undefined> {
  const schema = z.preprocess(
    blankToUndefined,
    opts.default === undefined
      ? z.string().optional()
      : z.string().default(opts.default),
  );
  return register(schema, {
    ...opts,
    kind: "string",
    default: opts.default,
  });
}

export function url(opts: VarOptions & { default: string }): z.ZodType<string>;
export function url(opts: VarOptions): z.ZodType<string | undefined>;
export function url(
  opts: VarOptions & { default?: string },
): z.ZodType<string | undefined> {
  const address = z.url({ protocol: /^https?$/ });
  const schema = z.preprocess(
    blankToUndefined,
    opts.default === undefined
      ? address.optional()
      : address.default(opts.default),
  );
  return register(schema, { ...opts, kind: "url", default: opts.default });
}

export interface IntegerOptions extends VarOptions {
  readonly min?: number;
  readonly max?: number;
  readonly tolerant?: boolean;
}

const INTEGER = /^-?\d+$/;

function parseInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || !INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

export function integer(
  opts: IntegerOptions & { default: number },
): z.ZodType<number>;
export function integer(opts: IntegerOptions): z.ZodType<number | undefined>;
export function integer(
  opts: IntegerOptions & { default?: number },
): z.ZodType<number | undefined> {
  const min = opts.min ?? Number.MIN_SAFE_INTEGER;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;

  if (opts.tolerant) {
    // An unusable value means the default, by design (documented on the variable).
    const schema = z.preprocess(
      blankToUndefined,
      z
        .unknown()
        .transform((value) => parseInteger(value, min, max) ?? opts.default),
    );
    return register(schema, {
      ...opts,
      kind: "integer",
      default: opts.default,
    });
  }

  const whole = z
    .string()
    .regex(INTEGER, "must be a whole number")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
  const strict =
    opts.default === undefined ? whole.optional() : whole.default(opts.default);
  const schema = z.preprocess(blankToUndefined, strict);
  return register(schema, { ...opts, kind: "integer", default: opts.default });
}

export interface FlagOptions extends VarOptions {
  readonly default: boolean;
  readonly tolerant?: boolean;
}

/** `true` or `false`, case-insensitive. */
export function flag(opts: FlagOptions): z.ZodType<boolean> {
  if (opts.tolerant) {
    const schema = z.preprocess(
      lowercased,
      z
        .unknown()
        .transform((value) =>
          value === undefined ? opts.default : value === "true",
        ),
    );
    return register(schema, {
      ...opts,
      kind: "boolean",
      default: opts.default,
    });
  }
  const schema = z.preprocess(
    lowercased,
    z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(opts.default),
  );
  return register(schema, { ...opts, kind: "boolean", default: opts.default });
}

export interface ChoiceOptions<V extends string> extends VarOptions {
  readonly values: readonly [V, ...V[]];
  readonly tolerant?: boolean;
}

/** One of a fixed set of words, case-insensitive. */
export function choice<const V extends string>(
  opts: ChoiceOptions<V> & { default: NoInfer<V> },
): z.ZodType<V>;
export function choice<const V extends string>(
  opts: ChoiceOptions<V>,
): z.ZodType<V | undefined>;
export function choice<const V extends string>(
  opts: ChoiceOptions<V> & { default?: V },
): z.ZodType<V | undefined> {
  if (opts.tolerant) {
    const schema = z.preprocess(
      lowercased,
      z.unknown().transform((value) => {
        const match = opts.values.find((candidate) => candidate === value);
        return match ?? opts.default;
      }),
    );
    return register(schema, { ...opts, kind: "enum", default: opts.default });
  }
  const allowed = z.enum(opts.values);
  const schema = z.preprocess(
    lowercased,
    opts.default === undefined
      ? allowed.optional()
      : allowed.default(opts.default),
  );
  return register(schema, { ...opts, kind: "enum", default: opts.default });
}

/** A comma-separated list: trimmed, empty entries dropped, `[]` when unset. */
export function list(opts: VarOptions): z.ZodType<readonly string[]> {
  const schema = z.preprocess(
    blankToUndefined,
    z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
  );
  return register(schema, { ...opts, kind: "list" });
}

// ---------------------------------------------------------------------------
// Groups: the variables of one concern
// ---------------------------------------------------------------------------

export interface GroupMeta {
  readonly name: string;
  /** Heading of the section in generated documentation. */
  readonly title: string;
  /** Lines printed under the heading. */
  readonly intro: readonly string[];
  readonly vars: Readonly<Record<string, z.ZodType>>;
}

const groupRegistry = new WeakMap<object, GroupMeta>();

export function groupMetaOf(schema: z.ZodType): GroupMeta | undefined {
  return groupRegistry.get(schema);
}

/** A problem found while loading a configuration. Never carries a value. */
export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

export interface DeriveContext {
  /** Record a problem with one or more variables. */
  issue(variable: string, message: string): void;
}

interface GroupDefinition<Shape extends Record<string, z.ZodType>, Derived> {
  name: string;
  title: string;
  intro?: readonly string[];
  vars: Shape;
  derive?: (
    values: z.output<z.ZodObject<Shape>>,
    ctx: DeriveContext,
  ) => Derived;
}

/**
 * The variables of one concern. `vars` maps each key of the resulting object
 * to the variable schema that fills it; `derive` adds computed values (and may
 * report cross-variable problems through `ctx.issue`).
 */
export function defineGroup<
  const Shape extends Record<string, z.ZodType>,
  Derived extends object,
>(
  def: GroupDefinition<Shape, Derived> & {
    derive: (
      values: z.output<z.ZodObject<Shape>>,
      ctx: DeriveContext,
    ) => Derived;
  },
): z.ZodType<z.output<z.ZodObject<Shape>> & Derived, unknown>;
export function defineGroup<const Shape extends Record<string, z.ZodType>>(
  def: Omit<GroupDefinition<Shape, never>, "derive">,
): z.ZodType<z.output<z.ZodObject<Shape>>, unknown>;
export function defineGroup(
  def: GroupDefinition<Record<string, z.ZodType>, object>,
): z.ZodType<unknown, unknown> {
  const entries = Object.entries(def.vars);
  const envNames = entries.map(([key, schema]) => [
    key,
    varMetaOf(schema)?.env,
  ]);

  // The input is the flat environment: pick each variable under its key.
  const pick = (input: unknown) => {
    const env = typeof input === "object" && input !== null ? input : {};
    const picked: Record<string, unknown> = {};
    for (const [key, envName] of envNames) {
      if (typeof key === "string" && typeof envName === "string") {
        picked[key] = Reflect.get(env, envName);
      }
    }
    return picked;
  };

  const schema = z.preprocess(
    pick,
    z.object(def.vars).transform((values, ctx) => {
      const derived = def.derive?.(values, {
        issue(variable, message) {
          ctx.issues.push({
            code: "custom",
            message,
            input: undefined,
            path: [variable],
          });
        },
      });
      return { ...values, ...derived };
    }),
  );

  groupRegistry.set(schema, {
    name: def.name,
    title: def.title,
    intro: def.intro ?? [],
    vars: def.vars,
  });
  return schema;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  readonly runtime: string;
  readonly issues: readonly ConfigIssue[];

  constructor(runtime: string, issues: readonly ConfigIssue[]) {
    const lines = issues.map(
      (issue) => `  - ${issue.variable}: ${issue.message}`,
    );
    super(
      [
        `Invalid ${runtime} configuration (${issues.length} ${issues.length === 1 ? "problem" : "problems"}):`,
        ...lines,
        "Every variable, its type and default is listed in packages/config (and in the generated .env.example).",
      ].join("\n"),
    );
    this.name = "ConfigError";
    this.runtime = runtime;
    this.issues = issues;
  }
}

/** Whether the environment describes a production deployment (NODE_ENV). */
export function isProductionEnv(env: EnvSource): boolean {
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/**
 * The variable an issue is about. A field issue is keyed by the field's name
 * (the schema knows its variable); an issue raised by a group's `derive` step
 * already carries the variable name. Only the path and Zod's own message are
 * ever used: never the input value.
 */
function variableFor(
  vars: Readonly<Record<string, z.ZodType>> | undefined,
  key: unknown,
  fallback: string,
): string {
  if (typeof key !== "string") return fallback;
  const schema = vars?.[key];
  return (schema ? varMetaOf(schema)?.env : undefined) ?? key;
}

// ---------------------------------------------------------------------------
// Runtimes
// ---------------------------------------------------------------------------

export interface RuleContext {
  readonly isProduction: boolean;
}

export interface Runtime<Config> {
  readonly name: RuntimeName;
  readonly groups: Readonly<Record<string, z.ZodType>>;
  /** Parse and check `env`; throws one aggregated `ConfigError`. */
  readonly load: (env: EnvSource) => Readonly<Config>;
}

export function defineRuntime<
  const Groups extends Record<string, z.ZodType>,
>(def: {
  name: RuntimeName;
  groups: Groups;
  /**
   * Variables the process cannot run without whatever the environment (the
   * worker has no use for a half-configured database, in development too).
   */
  alwaysRequired?: readonly string[];
  /** Cross-variable rules, evaluated once every group parsed. */
  rules?: (
    config: z.output<z.ZodObject<Groups>>,
    ctx: RuleContext,
  ) => readonly ConfigIssue[];
}): Runtime<z.output<z.ZodObject<Groups>>> {
  const groupKeys = Object.keys(def.groups);
  const schema = z.preprocess(
    (env) => Object.fromEntries(groupKeys.map((key) => [key, env])),
    z.object(def.groups),
  );

  return {
    name: def.name,
    groups: def.groups,
    load(env) {
      const production = isProductionEnv(env);
      const issues: ConfigIssue[] = [];

      const parsed = schema.safeParse(env);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const [groupKey, key] = issue.path;
          const group =
            typeof groupKey === "string" ? def.groups[groupKey] : undefined;
          issues.push({
            variable: variableFor(
              group ? groupMetaOf(group)?.vars : undefined,
              key,
              String(groupKey ?? "configuration"),
            ),
            message: issue.message,
          });
        }
      }

      // Required variables are checked against the raw environment, so they
      // are reported even when an unrelated variable failed to parse.
      for (const group of Object.values(def.groups)) {
        const meta = groupMetaOf(group);
        for (const schemaOfVar of Object.values(meta?.vars ?? {})) {
          const varMeta = varMetaOf(schemaOfVar);
          if (!varMeta) continue;
          const raw = env[varMeta.env]?.trim();
          const required =
            def.alwaysRequired?.includes(varMeta.env) === true ||
            (production && isRequired(varMeta.requiredInProduction, def.name));
          if (required && !raw) {
            issues.push({
              variable: varMeta.env,
              message: `is required${
                def.alwaysRequired?.includes(varMeta.env) === true
                  ? ""
                  : " in production"
              } (${varMeta.description.replace(/\.$/, "")})`,
            });
          } else if (production && raw) {
            const shape = checkProductionShape(varMeta, raw);
            if (shape) issues.push({ variable: varMeta.env, message: shape });
          }
        }
      }

      if (parsed.success) {
        issues.push(
          ...(def.rules?.(parsed.data, { isProduction: production }) ?? []),
        );
      }

      if (issues.length > 0 || !parsed.success) {
        throw new ConfigError(def.name, issues);
      }
      return deepFreeze(parsed.data);
    },
  };
}

function isRequired(flagValue: RequiredInProduction, runtime: RuntimeName) {
  return (
    flagValue === true ||
    (Array.isArray(flagValue) && flagValue.includes(runtime))
  );
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function checkProductionShape(meta: VarMeta, raw: string): string | null {
  if (
    meta.minLengthInProduction !== undefined &&
    raw.length < meta.minLengthInProduction
  ) {
    return `must be at least ${meta.minLengthInProduction} characters in production`;
  }
  if (meta.base64Key) {
    if (!BASE64.test(raw) || atob(raw).length !== 32) {
      return "must be 32 random bytes, base64 encoded (openssl rand -base64 32)";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Concern readers: one group, for the libraries shared by several runtimes
// ---------------------------------------------------------------------------

export type ConcernReader<T> = (env?: EnvSource) => Readonly<T>;

function processEnvSource(): EnvSource {
  return typeof process === "undefined" ? {} : process.env;
}

/**
 * A reader for one group of variables. A library that several runtimes share
 * (the database client, the e-mail sender, ...) reads its own concern with
 * this instead of the whole runtime configuration. It validates types only:
 * required-in-production is the start-up check's job.
 *
 * The result is cached against the raw values it was built from, so reading it
 * on a hot path costs a handful of property reads, and a test that changes
 * `process.env` still sees the change.
 */
export function defineReader<T>(
  group: z.ZodType<T, unknown>,
): ConcernReader<T> {
  const meta = groupMetaOf(group);
  const names = Object.values(meta?.vars ?? {}).flatMap((schema) => {
    const env = varMetaOf(schema)?.env;
    return env ? [env] : [];
  });

  let last: {
    inputs: readonly (string | undefined)[];
    value: Readonly<T>;
  } | null = null;

  return (env = processEnvSource()) => {
    const inputs = names.map((name) => env[name]);
    if (last && inputs.every((value, index) => value === last?.inputs[index])) {
      return last.value;
    }

    const parsed = group.safeParse(env);
    if (!parsed.success) {
      const name = meta?.name ?? "configuration";
      throw new ConfigError(
        name,
        parsed.error.issues.map((issue) => ({
          variable: variableFor(meta?.vars, issue.path[0], name),
          message: issue.message,
        })),
      );
    }
    const value = deepFreeze(parsed.data);
    last = { inputs, value };
    return value;
  };
}

/** The process environment, for the few callers that forward the whole bag. */
export function currentEnv(): EnvSource {
  return processEnvSource();
}
