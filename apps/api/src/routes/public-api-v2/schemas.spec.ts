import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookSubscriptionSchema } from "./schemas";

const base = { name: "Integração ERP", events: ["request.created"] };

function accepts(targetUrl: string) {
  return WebhookSubscriptionSchema.safeParse({ ...base, targetUrl }).success;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("WebhookSubscriptionSchema.targetUrl", () => {
  it("accepts a public https URL in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(accepts("https://hooks.example.com/calibra?x=1")).toBe(true);
  });

  it("requires https in production, and allows http outside it", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(accepts("http://hooks.example.com/calibra")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(accepts("http://hooks.example.com/calibra")).toBe(true);
  });

  it("lets an operator reopen plain http in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OUTBOUND_ALLOW_INSECURE_HTTP", "true");
    expect(accepts("http://hooks.example.com/calibra")).toBe(true);
  });

  it.each([
    "https://127.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://172.17.0.2:5432/",
    "https://192.168.1.10/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/",
    "https://[::1]/hook",
    "https://[fd00::1]/hook",
    "https://[::ffff:10.0.0.1]/hook",
    "https://localhost/hook",
    "https://user:secret@hooks.example.com/",
    "ftp://hooks.example.com/",
    "not a url",
  ])("refuses %s", (url) => {
    vi.stubEnv("NODE_ENV", "production");
    expect(accepts(url)).toBe(false);
  });

  it("lets the operator allow-list a LAN host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OUTBOUND_ALLOW_PRIVATE_HOSTS", "10.20.0.0/24");
    expect(accepts("https://10.20.0.7/hook")).toBe(true);
    expect(accepts("https://10.21.0.7/hook")).toBe(false);
  });

  it("is also enforced on a partial update", () => {
    vi.stubEnv("NODE_ENV", "production");
    const partial = WebhookSubscriptionSchema.partial();
    expect(partial.safeParse({ targetUrl: "https://10.0.0.5/" }).success).toBe(
      false,
    );
    expect(partial.safeParse({ name: "Novo nome" }).success).toBe(true);
  });
});
