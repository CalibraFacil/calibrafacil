import { createLogErrorReporter } from "@calibra-facil/shared/telemetry";

const reporter = createLogErrorReporter({ service: "email-sender" });

/**
 * Report an e-mail delivery or resolution problem as one redacted JSON line on
 * stderr (the same reporter the API and the worker use). Never throws; the
 * caller continues, which is the contract of every site that calls it.
 */
export function reportEmailError(
  message: string,
  cause?: unknown,
  tags: Record<string, string> = {},
): void {
  const detail =
    cause === undefined
      ? ""
      : `: ${cause instanceof Error ? cause.message : String(cause)}`;
  reporter.captureException(new Error(`${message}${detail}`), {
    tags: { surface: "email-sender", ...tags },
  });
}
