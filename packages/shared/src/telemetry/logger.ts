// Tiny structured logger. Wraps the `[Worker]`/`[JOB]`/`[Cron]`
// tag-prefix convention in single-line JSON so the Vercel log drain (and any
// future aggregator) can parse level/tag/fields instead of grepping free text.
// No dependencies, no transports, no levels config — console is the sink on
// every runtime we deploy to (Vercel functions, CF container, local Bun/Node).

export type LogFields = Record<string, unknown>;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** New logger with extra fields stamped on every line. */
  with(fields: LogFields): StructuredLogger;
}

// Resolved at call time (not module load) so console patching — test spies,
// runtime wrappers — is honored.
function consoleFor(level: LogLevel): (line: string) => void {
  switch (level) {
    case "debug":
      return console.debug;
    case "warn":
      return console.warn;
    case "error":
      return console.error;
    default:
      return console.log;
  }
}

/** JSON.stringify replacer that keeps Error values useful and never throws. */
function safeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function serializeLine(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record, (_key, value) => safeValue(value));
  } catch {
    // Circular fields etc. — degrade to the shape we can always emit.
    return JSON.stringify({
      ts: record.ts,
      level: record.level,
      tag: record.tag,
      msg: record.msg,
      serialization: "failed",
    });
  }
}

export function createLogger(
  tag: string,
  baseFields: LogFields = {},
): StructuredLogger {
  const emit = (level: LogLevel, message: string, fields?: LogFields) => {
    consoleFor(level)(
      serializeLine({
        ts: new Date().toISOString(),
        level,
        tag,
        msg: message,
        ...baseFields,
        ...fields,
      }),
    );
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    with: (fields) => createLogger(tag, { ...baseFields, ...fields }),
  };
}
