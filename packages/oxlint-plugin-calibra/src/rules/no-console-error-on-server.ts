import {
  isTestFile,
  normalizedFilename,
  toRecord,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// A server error is written as ONE redacted JSON line (`createLogErrorReporter`,
// reached through `reportServerError` in apps/api/src/lib/observability.ts, or
// the shared structured logger, which scrubs an Error field the same way).
// `console.error(..., error)` prints the raw error object: its message and
// stack carry the failed statement's bound values (row data) and, from a
// provider, tokens and bodies. A caught error goes to the redacting reporter
// or logger; a warning that is not an error goes to the logger too.
//
// Scope: the API, the worker, the packages the worker runs (jobs-core,
// notifications, auth) and the database package. The loggers are the sinks
// (they write the line), and the CLIs/seeds/bins are an operator's terminal:
// those may use the console.
const IN_SCOPE =
  /(^|\/)(apps\/(api|worker)\/src|apps\/local-server\/src|packages\/(jobs-core|notifications|db|auth)\/src)\//;
const SINKS =
  /(^|\/)(apps\/api\/src\/(lib\/logger\.ts|cli\/)|apps\/local-server\/src\/bin\.ts|packages\/db\/src\/(seed[\w-]*|rls-startup)\.ts)/;

const API_MESSAGE =
  "Do not write errors with console.error/console.warn: report a caught error with reportServerError(error, { surface, tags }) (apps/api/src/lib/observability.ts), log a warning with log('warn', event, fields) (apps/api/src/lib/logger.ts).";
const SHARED_MESSAGE =
  "Do not write errors with console.error/console.warn: log through the package logger (`log.error(message, { error })` from ./log, a createLogger from @calibra-facil/shared/telemetry): an Error field is written scrubbed of bound values and secrets. Use errorMessage(error) where an error becomes stored or logged text.";

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow console.error/console.warn in server code (API, worker, jobs-core, notifications, auth, db, local-server) outside the loggers and CLIs: errors go through the redacting reporter or logger.",
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
        context.report({
          node,
          message: /(^|\/)apps\/api\//.test(filename)
            ? API_MESSAGE
            : SHARED_MESSAGE,
        });
      },
    };
  },
};

export default rule;
