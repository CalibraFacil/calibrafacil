import type { z } from "zod";

/**
 * One client-facing endpoint, declared once. The API mounts its handler against
 * the definition (`mount` in `apps/api`), the SDK builds its typed method from it
 * (`endpointClient` in `client-runtime`), and the data-policy registry, the
 * desktop stubs and the `AppType` route list are read from it. Nothing here
 * imports a server or a client module: a definition is data plus Zod schemas.
 *
 * Rules for the schemas are the ones of the response contracts (see
 * `reference-data.ts`): the response schema validates only (no defaults,
 * transforms or coercion), unknown keys allowed; `query` and `body` are the
 * same schemas the server validates the request with.
 */

/** Where a client method runs on the desktop (audit decision Q13; see `data-policy.ts` in client-runtime). */
export type DataPolicy =
  | "cloud-only"
  | "cloud-first-read-fallback"
  | "local-first-read-through-sync"
  | "local-command-sync"
  | "local-only";

export type EndpointMethod = "get" | "post" | "put" | "patch" | "delete";

/** Wording of the desktop's "not available offline" error (`<label> requer ...`). */
export type DesktopUnsupportedFlavor = "web-api" | "cloud-sync";

type EndpointBase = {
  method: EndpointMethod;
  /** The full path, `:name` for a path parameter (`/api/customers/:id`). */
  path: string;
  /** Validated against the query string (flat object of scalars). */
  query?: z.ZodType;
  /** Validated against the JSON request body. */
  body?: z.ZodType;
  /** The success body, as it is on the wire (what the handler returns). */
  response: z.ZodType;
  /** The success status (default 200). */
  status?: 200 | 201;
  /** pt-BR message of the `CalibraApiError` when the body carries no `error`. */
  failure: string;
};

type EndpointPolicy =
  | {
      policy: "cloud-only";
      /** The feature as the desktop names it: "<desktopLabel> requer a API web/nuvem neste momento." */
      desktopLabel: string;
      desktopFlavor?: DesktopUnsupportedFlavor;
    }
  | {
      policy: Exclude<DataPolicy, "cloud-only">;
      desktopLabel?: never;
      desktopFlavor?: never;
    };

export type EndpointDef = EndpointBase & EndpointPolicy;

/** A domain's endpoints keyed by the SDK method name. */
export type EndpointGroup = Record<string, EndpointDef>;

/**
 * Types and returns the definition (it normalises nothing): the `const`
 * parameter keeps the literal path, method and policy, which the route list,
 * the policy registry and the handler types are computed from.
 */
export function endpoint<const TDef extends EndpointDef>(def: TDef): TDef {
  return def;
}

// ---------------------------------------------------------------------------
// Types computed from a definition
// ---------------------------------------------------------------------------

/** `{ id: V; invId: V }` for `/x/:id/y/:invId`; empty for a path without parameters. */
export type PathParams<
  TPath extends string,
  TValue = string,
> = TPath extends `${string}:${infer Param}/${infer Rest}`
  ? { [Key in Param | keyof PathParams<Rest, TValue>]: TValue }
  : TPath extends `${string}:${infer Param}`
    ? { [Key in Param]: TValue }
    : Record<never, never>;

type HasParams<TPath extends string> = keyof PathParams<TPath> extends never
  ? false
  : true;

type Optional<TObject> = { [Key in keyof TObject]?: TObject[Key] };

/**
 * What a caller may put in the query: the schema's output type per key (a
 * `number` for a coerced `page`), required only where the schema's input
 * requires it. Scalars only; the client serialises them with `String()`.
 */
type QueryInput<TSchema extends z.ZodType> = {
  [Key in keyof z.input<TSchema> as undefined extends z.input<TSchema>[Key]
    ? never
    : Key]: Key extends keyof z.output<TSchema>
    ? z.output<TSchema>[Key]
    : never;
} & Optional<{
  [Key in keyof z.input<TSchema> as undefined extends z.input<TSchema>[Key]
    ? Key
    : never]: Key extends keyof z.output<TSchema>
    ? z.output<TSchema>[Key]
    : never;
}>;

/** The single object a client method takes; each key exists only when the endpoint has that part. */
export type EndpointClientInput<TDef extends EndpointDef> = (HasParams<
  TDef["path"]
> extends true
  ? { params: PathParams<TDef["path"], string | number> }
  : unknown) &
  (TDef extends { query: infer TQuery extends z.ZodType }
    ? Record<never, never> extends QueryInput<TQuery>
      ? { query?: QueryInput<TQuery> }
      : { query: QueryInput<TQuery> }
    : unknown) &
  (TDef extends { body: infer TBody extends z.ZodType }
    ? { body: z.input<TBody> }
    : unknown);

/** What a handler receives, already validated: `params` (strings), `query` and `body` (schema output). */
export type EndpointHandlerInput<TDef extends EndpointDef> = (HasParams<
  TDef["path"]
> extends true
  ? { params: PathParams<TDef["path"]> }
  : unknown) &
  (TDef extends { query: infer TQuery extends z.ZodType }
    ? { query: z.output<TQuery> }
    : unknown) &
  (TDef extends { body: infer TBody extends z.ZodType }
    ? { body: z.output<TBody> }
    : unknown);

/** The wire body of a success response. */
export type EndpointResponse<TDef extends EndpointDef> = z.output<
  TDef["response"]
>;

/** `"GET /api/customers/:id"`: the label used in contract errors and drift checks. */
export function endpointLabel(def: Pick<EndpointDef, "method" | "path">) {
  return `${def.method.toUpperCase()} ${def.path}`;
}

/** The paths of a set of groups, as a literal union (feeds `AppType`). */
export type EndpointPaths<TGroups extends Record<string, EndpointGroup>> = {
  [Namespace in keyof TGroups]: TGroups[Namespace][keyof TGroups[Namespace]]["path"];
}[keyof TGroups];

/** `{ method: policy }` of a group, keeping the literal policy of each entry. */
export type EndpointPolicies<TGroup extends EndpointGroup> = {
  [Method in keyof TGroup]: TGroup[Method]["policy"];
};

export function endpointPolicies<const TGroup extends EndpointGroup>(
  group: TGroup,
): EndpointPolicies<TGroup> {
  const policies: Record<string, DataPolicy> = {};
  for (const [name, def] of Object.entries(group)) {
    policies[name] = def.policy;
  }
  return fromEntriesTyped<EndpointPolicies<TGroup>>(policies);
}

function fromEntriesTyped<TOut>(value: Record<string, DataPolicy>): TOut {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the keys are exactly the group's, and the values are each definition's own policy; this is the single trust point tying the runtime map to `EndpointPolicies`.
  return value as TOut;
}
