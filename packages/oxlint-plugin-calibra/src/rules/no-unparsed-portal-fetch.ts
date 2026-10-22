import {
  createRatchet,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// The client portal reads every API answer through ONE module,
// apps/portal/src/lib/api-fetch.ts (`fetchPortalJson`, `fetchPortalResponse` +
// `readPortalJson`/`readPortalJsonResult`, `fetchExternalJson`). It checks the
// JSON body against a @calibra-facil/contracts schema (strict in development
// and tests, warn in production), so a server/portal shape mismatch fails where
// it is introduced instead of showing up as `undefined` in a page.
//
// A raw `fetch(...)` or a `<response>.json()` anywhere else under
// apps/portal/src is an unparsed (`any`) read: it is what the ~55 pre-contract
// call sites were. This rule keeps new ones out. The helper module itself and
// tests are exempt; any legacy site would be grandfathered as an exact
// per-file count (LEGACY_BASELINE, the same ratchet as the other calibra
// rules) that may only go down. The baseline is empty: every site is migrated.

const PORTAL_SRC_PATTERN = /(^|\/)apps\/portal\/src\//;
const HELPER_PATTERN = /(^|\/)apps\/portal\/src\/lib\/api-fetch\.ts$/;

const LEGACY_BASELINE: Baseline = new Map<string, number>([]);

const MESSAGE =
  "Do not call fetch() or read .json() directly in the portal. Use fetchPortalJson(path, schema, { errorMessage }) from @/lib/api-fetch (or fetchPortalResponse + readPortalJson / readPortalJsonResult when the HTTP status decides what to render) with a schema from @calibra-facil/contracts, so the response is validated.";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

/** `fetch(...)` / `globalThis.fetch(...)` / `window.fetch(...)`. */
function isFetchCall(callee: UnknownRecord | null): boolean {
  if (!callee) return false;
  if (callee.type === "Identifier") return callee.name === "fetch";
  if (callee.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  const object = toRecord(callee.object);
  const property = toRecord(callee.property);
  return (
    object?.type === "Identifier" &&
    (object.name === "globalThis" || object.name === "window") &&
    property?.name === "fetch"
  );
}

/** `<anything>.json()`, with no arguments (a Response body read). */
function isBodyJsonCall(callee: UnknownRecord | null, args: unknown): boolean {
  if (callee?.type !== "MemberExpression" || callee.computed === true) {
    return false;
  }
  if (Array.isArray(args) && args.length > 0) return false;
  return toRecord(callee.property)?.name === "json";
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw fetch() / .json() in apps/portal/src outside lib/api-fetch.ts; parse responses with a contract schema.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (
      !PORTAL_SRC_PATTERN.test(filename) ||
      HELPER_PATTERN.test(filename) ||
      isTestFile(filename)
    ) {
      return {};
    }

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    return {
      CallExpression(node: unknown) {
        const call = toRecord(node);
        const callee = toRecord(call?.callee);
        if (!isFetchCall(callee) && !isBodyJsonCall(callee, call?.arguments)) {
          return;
        }
        if (!ratchet.exceeds()) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
