import {
  isTestFile,
  normalizedFilename,
  toRecord,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// A server error is written as ONE redacted JSON line (`createLogErrorReporter`,
// reached through `reportServerError` in apps/api/src/lib/observability.ts).
// `console.error(..., error)` prints the raw error object: its message and
// stack carry the failed statement's bound values (row data) and, from a
// provider, tokens and bodies. A caught error goes to `reportServerError`; a
// warning that is not an error goes to `log` (apps/api/src/lib/logger.ts).
//
// The API's logger is the sink (it writes the line), and the CLI is an operator's
// terminal: both may use the console.
const IN_SCOPE = /(^|\/)apps\/api\/src\//;
const SINKS = /(^|\/)apps\/api\/src\/(lib\/logger\.ts|cli\/)/;

const MESSAGE =
  "Do not write errors with console.error/console.warn: report a caught error with reportServerError(error, { surface, tags }) (apps/api/src/lib/observability.ts), log a warning with log('warn', event, fields) (apps/api/src/lib/logger.ts).";

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow console.error/console.warn in the API outside its logger and the CLI: errors go through the redacting reporter.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (!IN_SCOPE.test(filename) || SINKS.test(filename)) return {};
    if (isTestFile(filename)) return {};

    return {
      MemberExpression(node: unknown) {
        const member = toRecord(node);
        if (!member || member.computed === true) return;
        const object = toRecord(member.object);
        const property = toRecord(member.property);
        if (object?.type !== "Identifier" || object.name !== "console") return;
        if (property?.name !== "error" && property?.name !== "warn") return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
