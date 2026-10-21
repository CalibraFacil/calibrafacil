// Server-side error reporter backed by structured logging.
//
// Every captured exception becomes ONE JSON line on stderr, so whatever
// collects the container/process logs (journald, Docker log driver, Loki, ...)
// can index and alert on it. There is no network transport and no third-party
// service: the product is self-hosted and errors stay in the operator's logs.
//
// Design rules:
//   - capture NEVER throws and never alters control flow;
//   - lines are REDACTED: structural tags, error name, sanitized message and
//     sanitized stack — never request bodies, headers, cookies or env values;
//   - flush() resolves immediately (a log line is written synchronously), the
//     method exists so call sites that await it before a serverless function
//     freezes keep working unchanged.

export type ErrorReporter = {
  captureException(
    error: unknown,
    context?: { tags?: Record<string, string> },
  ): void;
  /** Kept for call-site compatibility; resolves immediately. */
  flush(timeoutMs?: number): Promise<void>;
};

export type LogErrorReporterOptions = {
  /** Emitting surface, e.g. "api" or "worker". */
  service?: string;
  environment?: string;
  release?: string;
  /** Injected for tests. Defaults to `console.error` (stderr). */
  write?: (line: string) => void;
};

export type ErrorLogRecord = {
  level: "error";
  message: string;
  name: string;
  stack?: string;
  tags: Record<string, string>;
  service?: string;
  environment?: string;
  release?: string;
  timestamp: string;
};

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Credentials embedded in URLs (postgres://user:pass@host, https://key@host).
  [/\/\/[^/\s@]+@/g, "//***@"],
  // Bearer/Basic tokens.
  [/\b(bearer|basic)\s+[\w.+/=-]+/gi, "$1 ***"],
  // key=value / key: value pairs for secret-ish keys.
  [
    /\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)s?\b(\s*[=:]\s*)\S+/gi,
    "$1$2***",
  ],
  // JWTs.
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}\b/g, "***"],
  // Long opaque tokens (40+ chars of base64/hex-ish material).
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, "***"],
];

function scrub(text: string, maxLength: number): string {
  let sanitized = text.slice(0, maxLength);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/** Scrub secret-shaped substrings from an error message before it is logged. */
export function sanitizeErrorMessage(message: string): string {
  return scrub(message, MAX_MESSAGE_LENGTH);
}

/** Scrub secret-shaped substrings from a stack (its first line is the message). */
export function sanitizeErrorStack(stack: string): string {
  return scrub(stack, MAX_STACK_LENGTH);
}

function describeThrowable(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name !== "" ? error.name : "Error",
      message: sanitizeErrorMessage(error.message),
      ...(error.stack ? { stack: sanitizeErrorStack(error.stack) } : {}),
    };
  }
  let message: string;
  try {
    message = String(error);
  } catch {
    message = "unserializable throwable";
  }
  return { name: "Error", message: sanitizeErrorMessage(message) };
}

export function buildErrorLogRecord(
  error: unknown,
  options: LogErrorReporterOptions & { tags?: Record<string, string> } = {},
): ErrorLogRecord {
  const { name, message, stack } = describeThrowable(error);
  return {
    level: "error",
    message,
    name,
    ...(stack ? { stack } : {}),
    tags: options.tags ?? {},
    ...(options.service ? { service: options.service } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.release ? { release: options.release } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function createLogErrorReporter(
  options: LogErrorReporterOptions = {},
): ErrorReporter {
  const write = options.write ?? ((line: string) => console.error(line));

  return {
    captureException(error, context) {
      try {
        write(
          JSON.stringify(
            buildErrorLogRecord(error, { ...options, tags: context?.tags }),
          ),
        );
      } catch {
        // Never interfere with the caller: a logging failure is dropped.
      }
    },

    async flush() {},
  };
}
