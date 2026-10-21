// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: "tracing" })),
}));

vi.mock("@sentry/react", () => ({
  init: mocks.init,
  captureException: mocks.captureException,
  browserTracingIntegration: mocks.browserTracingIntegration,
}));

async function loadModule() {
  vi.resetModules();
  return import("./sentry");
}

describe("portal route error reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_SENTRY_DSN", "https://key@o0.ingest.sentry.io/2");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("REQ-FE-BOUNDARY-020: captures a render crash in Sentry with its component stack", async () => {
    const { reportRouteError } = await loadModule();
    const error = new Error("falha de renderização");

    await reportRouteError(error, { componentStack: "\n  at Broken" });

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        contexts: { react: { componentStack: "\n  at Broken" } },
      }),
    );
  });

  it("REQ-FE-BOUNDARY-021: initializes with PII and session replay off", async () => {
    const { reportRouteError } = await loadModule();

    await reportRouteError(new Error("x"), {});

    expect(mocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o0.ingest.sentry.io/2",
        sendDefaultPii: false,
      }),
    );
    const [options] = mocks.init.mock.calls[0] ?? [];
    expect(options.replaysSessionSampleRate ?? 0).toBe(0);
    expect(options.replaysOnErrorSampleRate ?? 0).toBe(0);
  });

  it("REQ-FE-BOUNDARY-022: stays silent without a DSN or outside production", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const withoutDsn = await loadModule();
    await withoutDsn.reportRouteError(new Error("no dsn"), {});

    vi.stubEnv("VITE_SENTRY_DSN", "https://key@o0.ingest.sentry.io/2");
    vi.stubEnv("PROD", false);
    const inDev = await loadModule();
    await inDev.reportRouteError(new Error("dev"), {});

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("REQ-FE-BOUNDARY-023: initializes Sentry once however many errors are reported", async () => {
    const { reportRouteError } = await loadModule();

    await reportRouteError(new Error("a"), {});
    await reportRouteError(new Error("b"), {});

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).toHaveBeenCalledTimes(2);
  });
});
