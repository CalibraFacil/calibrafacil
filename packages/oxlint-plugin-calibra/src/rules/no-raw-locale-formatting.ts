import {
  createRatchet,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// Dates, times, money and numbers are formatted by ONE layer,
// packages/shared/src/format.ts (`formatInstant`, `formatCalendarDate`,
// `formatMoneyBRL`, `formatNumber`, `formatPercent`). It names the laboratory's
// time zone (America/Sao_Paulo) explicitly and caches its `Intl` formatters, so
// a value reads the same in a browser anywhere, in the API/worker (UTC) and in
// a PDF. A raw `toLocaleDateString()` silently uses the PROCESS time zone (a
// date typed for the 15th printed as the 14th for a UTC server), and each
// hand-rolled `new Intl.DateTimeFormat("pt-BR")` forks the format again.
//
// Flags: `.toLocaleDateString()`, `.toLocaleTimeString()`, `.toLocaleString()`
// (on dates AND numbers: both have a shared function), and
// `new Intl.DateTimeFormat(...)` / `new Intl.NumberFormat(...)`.
// Allowed inside the shared formatting modules and in tests.

const ALLOWED_PATTERN =
  /(^|\/)packages\/shared\/src\/(format|calendar-date)\.ts$/;

// Grandfathered violations in files this change could not touch (another
// branch owns apps/api/src/routes/*); exact per-file counts, net-new fail.
const LEGACY_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/src/routes/signing.ts", 1],
]);

const BANNED_METHODS = new Set([
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleString",
]);

const BANNED_INTL = new Set(["DateTimeFormat", "NumberFormat"]);

const HINT =
  "Use the shared formatting layer instead: formatInstant / formatCalendarDate / formatMoneyBRL / formatNumber / formatPercent from @calibra-facil/shared/format.";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

/** `obj.name` / `obj["name"]`: the property name when it is a plain key. */
function propertyNameOf(member: UnknownRecord): string | null {
  const property = toRecord(member.property);
  if (!property) return null;
  if (member.computed !== true) {
    return typeof property.name === "string" ? property.name : null;
  }
  return typeof property.value === "string" ? property.value : null;
}

function isMemberExpression(node: UnknownRecord | null): node is UnknownRecord {
  return node?.type === "MemberExpression";
}

/** The method name of `x.toLocaleDateString(...)`, or null. */
function bannedLocaleMethod(callee: UnknownRecord | null): string | null {
  if (!isMemberExpression(callee)) return null;
  const name = propertyNameOf(callee);
  return name !== null && BANNED_METHODS.has(name) ? name : null;
}

/** "DateTimeFormat" for `Intl.DateTimeFormat` / `globalThis.Intl.NumberFormat`. */
function bannedIntlConstructor(callee: UnknownRecord | null): string | null {
  if (!isMemberExpression(callee)) return null;
  const name = propertyNameOf(callee);
  if (name === null || !BANNED_INTL.has(name)) return null;
  const object = toRecord(callee.object);
  if (object?.type === "Identifier" && object.name === "Intl") return name;
  if (isMemberExpression(object) && propertyNameOf(object) === "Intl") {
    return name;
  }
  return null;
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban raw toLocale*String and Intl.DateTimeFormat/NumberFormat outside the shared format module.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (ALLOWED_PATTERN.test(filename) || isTestFile(filename)) return {};

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    const report = (node: unknown, what: string) => {
      if (!ratchet.exceeds()) return;
      context.report({ node, message: `${what} is banned. ${HINT}` });
    };

    return {
      CallExpression(node: unknown) {
        const callee = toRecord(toRecord(node)?.callee);
        const method = bannedLocaleMethod(callee);
        if (method !== null) return report(node, `\`.${method}()\``);
        const intl = bannedIntlConstructor(callee);
        if (intl !== null) report(node, `\`Intl.${intl}(...)\``);
      },
      NewExpression(node: unknown) {
        const intl = bannedIntlConstructor(toRecord(toRecord(node)?.callee));
        if (intl !== null) report(node, `\`new Intl.${intl}(...)\``);
      },
    };
  },
};

export default rule;
