// Dependency-free Sentry error reporter for the server surfaces.
//
// Why not @sentry/node or @sentry/bun: the deployed API/cron/queue functions
// run on Vercel's UNPINNABLE managed Bun ("1.x"), whose rolls have boot-crashed
// prod twice; @sentry/node's OpenTelemetry auto-instrumentation is unsupported
// under Bun, and @sentry/bun would break the Node-based document-worker
// container and the Node test tier. This reporter is ~200 lines of plain
// `fetch` against Sentry's stable envelope API — identical behavior on every
// runtime, zero boot risk in the esbuild bundle, trivially unit-testable. If
// the runtime situation stabilizes, it can be swapped for the official SDK
// behind the same ErrorReporter interface.
//
// Design rules (the reference project's "non-interfering telemetry"):
//   - capture NEVER throws and never alters control flow;
//   - payloads are REDACTED: structural tags, error type, sanitized message,
//     stack frames — never request bodies, headers, cookies or env values;
//   - transport is bounded (3s timeout, capped in-flight queue) and awaited
//     only via an explicit flush() before a serverless function freezes.

export type ErrorReporter = {
  captureException(
    error: unknown,
    context?: { tags?: Record<string, string> },
  ): void;
  /** Await in-flight deliveries (bounded) — call before a function returns. */
  flush(timeoutMs?: number): Promise<void>;
};

export type ErrorReporterOptions = {
  /** Sentry DSN; absent/empty -> no-op reporter. */
  dsn?: string | null;
  environment?: string;
  release?: string;
  serverName?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

const MAX_IN_FLIGHT = 20;
const TRANSPORT_TIMEOUT_MS = 3_000;
const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;

type ParsedDsn = {
  endpoint: string;
  publicKey: string;
};

export function parseSentryDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

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

/** Scrub secret-shaped substrings from an error message before it leaves. */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message.slice(0, 2_000);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

type StackFrame = {
  function: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
};

const FRAME_PATTERN =
  /^\s*at\s+(?:(?<fn>.+?)\s+\()?(?<file>[^()]+?):(?<line>\d+):(?<col>\d+)\)?\s*$/;

/** Parse a V8-style stack into Sentry frames (oldest first). */
export function parseStackFrames(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = FRAME_PATTERN.exec(line);
    const groups = match?.groups;
    if (!groups?.file) continue;
    frames.push({
      function: groups.fn ?? "<anonymous>",
      filename: groups.file,
      lineno: Number(groups.line),
      colno: Number(groups.col),
      in_app:
        !groups.file.includes("node_modules") &&
        !groups.file.includes("/.bun/"),
    });
  }
  return frames.reverse();
}

function randomEventId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export type SentryEvent = {
  event_id: string;
  timestamp: number;
  platform: "javascript";
  level: "error";
  environment?: string;
  release?: string;
  server_name?: string;
  tags: Record<string, string>;
  exception: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: StackFrame[] };
    }>;
  };
};

export function buildErrorEvent(
  error: unknown,
  options: {
    tags?: Record<string, string>;
    environment?: string;
    release?: string;
    serverName?: string;
  } = {},
): SentryEvent {
  const isError = error instanceof Error;
  const type = isError && error.name !== "" ? error.name : "Error";
  const rawMessage = isError ? error.message : String(error);
  const frames = isError && error.stack ? parseStackFrames(error.stack) : [];

  return {
    event_id: randomEventId(),
    timestamp: Date.now() / 1_000,
    platform: "javascript",
    level: "error",
    environment: options.environment,
    release: options.release,
    server_name: options.serverName,
    tags: options.tags ?? {},
    exception: {
      values: [
        {
          type,
          value: sanitizeErrorMessage(rawMessage),
          ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
        },
      ],
    },
  };
}

function buildEnvelope(event: SentryEvent, dsn: string): string {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    dsn,
  });
  const itemHeader = JSON.stringify({ type: "event" });
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}\n`;
}

const NOOP_REPORTER: ErrorReporter = {
  captureException() {},
  async flush() {},
};

export function createErrorReporter(
  options: ErrorReporterOptions,
): ErrorReporter {
  const dsn = options.dsn?.trim();
  const parsed = dsn ? parseSentryDsn(dsn) : null;
  if (!dsn || !parsed) return NOOP_REPORTER;

  const fetchImpl = options.fetchImpl ?? fetch;
  const pending = new Set<Promise<void>>();

  return {
    captureException(error, context) {
      try {
        if (pending.size >= MAX_IN_FLIGHT) return; // shed, never queue unbounded
        const event = buildErrorEvent(error, {
          tags: context?.tags,
          environment: options.environment,
          release: options.release,
          serverName: options.serverName,
        });
        const delivery = Promise.resolve(
          fetchImpl(parsed.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-sentry-envelope",
              "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=calibra-server-reporter/1.0, sentry_key=${parsed.publicKey}`,
            },
            body: buildEnvelope(event, dsn),
            signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
          }),
        )
          .then(() => undefined)
          .catch((transportError) => {
            // Non-interfering: delivery failures are log-only.
            console.error(
              "[ErrorReporter] failed to deliver event",
              transportError instanceof Error
                ? transportError.message
                : transportError,
            );
          })
          .finally(() => {
            pending.delete(delivery);
          });
        pending.add(delivery);
      } catch (captureError) {
        console.error("[ErrorReporter] capture failed", captureError);
      }
    },

    async flush(timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS) {
      if (pending.size === 0) return;
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
  };
}
