import { zValidator } from "@hono/zod-validator";
import type { Context, Env, Hono, MiddlewareHandler } from "hono";
import {
  endpointLabel,
  type EndpointDef,
  type EndpointHandlerInput,
  type EndpointResponse,
  type ServerShape,
} from "@calibra-facil/contracts";
import { withLabPermission } from "../middleware/permission";
import { isPermissionCheck } from "./permission-check";
import { shouldCheckResponses } from "./endpoint-response-check";

/**
 * What a handler answers: the definition's response, as a value the server
 * holds before `c.json()` serialises it (`ServerShape`: a `Date` may stand where
 * the wire has an ISO string), or a ready `Response` for the rare status the
 * definition does not describe (the CNPJ registry's 502). A handler that drifts
 * from its response schema fails `pnpm check-types`.
 */
type EndpointResult<TDef extends EndpointDef> =
  | ServerShape<EndpointResponse<TDef>>
  | Response;

type EndpointHandler<TEnv extends Env, TDef extends EndpointDef> = (
  c: Context<TEnv>,
  input: EndpointHandlerInput<TDef>,
) => Promise<EndpointResult<TDef>>;

/**
 * Registers `def` on `router` (mounted at `prefix`, so `def.path` must start
 * with it): the method and path come from the definition, the path params
 * (when the definition has a `params` schema), the query and the body are
 * validated with the definition's schemas (`zValidator`, so a failure
 * answers exactly as every other validated route and the app-wide shape hook
 * rewrites it), and the handler receives them typed. When the definition has a
 * `permission`, `withLabPermission(def.permission)` (lab session, organization,
 * LAB type, the permission check) runs first; then `middleware`, for what is not
 * a permission (a role, a fresh session, the portal's guards). A route without
 * either takes the 4-argument form.
 *
 * In development and tests (see `checkEndpointResponses` in `endpoint-response-check.ts`) the success body is also parsed with the response
 * schema (after a JSON round trip, so it is the wire value): drift fails the
 * request where it is introduced. Production does not re-parse.
 */
export function mount<TEnv extends Env, TDef extends EndpointDef>(
  router: Hono<TEnv>,
  prefix: string,
  def: TDef,
  handler: EndpointHandler<TEnv, TDef>,
): void;
export function mount<TEnv extends Env, TDef extends EndpointDef>(
  router: Hono<TEnv>,
  prefix: string,
  def: TDef,
  middleware: readonly MiddlewareHandler[],
  handler: EndpointHandler<TEnv, TDef>,
): void;
export function mount<TEnv extends Env, TDef extends EndpointDef>(
  router: Hono<TEnv>,
  prefix: string,
  def: TDef,
  ...rest:
    | [handler: EndpointHandler<TEnv, TDef>]
    | [
        middleware: readonly MiddlewareHandler[],
        handler: EndpointHandler<TEnv, TDef>,
      ]
): void {
  const [middleware, handler] =
    rest.length === 1 ? [[], rest[0]] : [rest[0], rest[1]];
  if (!def.path.startsWith(prefix)) {
    throw new Error(
      `${endpointLabel(def)} cannot be mounted under ${prefix}: its path does not start with it`,
    );
  }
  const path = def.path.slice(prefix.length) || "/";

  const guards = permissionGuards(def);

  const validators: MiddlewareHandler[] = [];
  if (def.params) validators.push(zValidator("param", def.params));
  if (def.query) validators.push(zValidator("query", def.query));
  if (def.body) validators.push(zValidator("json", def.body));

  const respond: MiddlewareHandler = async (c) => {
    const result = await handler(c, handlerInput<TDef>(c, def));
    if (result instanceof Response) return result;
    assertMatchesResponseSchema(c, def, result);
    if (def.status === 204) return c.body(null, 204);
    return c.json(result, def.status ?? 200);
  };

  // The array form of `path` takes the handlers as a plain list.
  router.on(
    def.method.toUpperCase(),
    [path],
    ...guards,
    ...middleware,
    ...validators,
    respond,
  );
}

/**
 * The definition's `permission` as the guard the lab routes use. An unknown
 * resource or action throws when the route is registered, not at the first
 * request.
 */
function permissionGuards(def: EndpointDef): readonly MiddlewareHandler[] {
  if (def.permission === undefined) return [];
  if (!isPermissionCheck(def.permission)) {
    throw new Error(
      `${endpointLabel(def)} declares a permission that is not an access-control statement: ${JSON.stringify(def.permission)}`,
    );
  }
  return withLabPermission(def.permission);
}

function handlerInput<TDef extends EndpointDef>(
  c: Context,
  def: TDef,
): EndpointHandlerInput<TDef> {
  const input: Record<string, unknown> = { params: c.req.param() };
  const request: unknown = c.req;
  if (hasValidatedData(request)) {
    if (def.params) input.params = request.valid("param");
    if (def.query) input.query = request.valid("query");
    if (def.body) input.body = request.valid("json");
  }
  return typedInput<TDef>(input);
}

function hasValidatedData(
  request: unknown,
): request is { valid(target: string): unknown } {
  return (
    typeof request === "object" &&
    request !== null &&
    typeof Reflect.get(request, "valid") === "function"
  );
}

function typedInput<TDef extends EndpointDef>(
  input: Record<string, unknown>,
): EndpointHandlerInput<TDef> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the single trust point of the mount helper: `input` is built above from the definition's own parts (params always, parsed when the definition has a `params` schema; query/body exactly when the definition declares them; all validated by its schemas), which is what `EndpointHandlerInput` computes from the definition.
  return input as EndpointHandlerInput<TDef>;
}

function assertMatchesResponseSchema(
  c: Context,
  def: EndpointDef,
  body: unknown,
) {
  if (!shouldCheckResponses(c)) return;
  // A 204 answers no body (`noContent`): there is nothing to round-trip.
  const wire =
    body === undefined ? undefined : JSON.parse(JSON.stringify(body));
  const result = def.response.safeParse(wire);
  if (result.success) return;
  const issues = result.error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(
    `The response of ${endpointLabel(def)} does not match its contract: ${issues}`,
  );
}
