import { describe, expect, it } from "vitest";
import { normalizeIntegrationBaseUrl } from "./integrations";

describe("normalizeIntegrationBaseUrl (early validation at save time)", () => {
  it("keeps a public https base URL, dropping the trailing slash", () => {
    expect(normalizeIntegrationBaseUrl(" https://erp.example.com/api/ ")).toBe(
      "https://erp.example.com/api",
    );
  });

  it.each([
    "https://localhost/",
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://172.20.1.1/",
    "https://192.168.0.1/",
    "https://169.254.169.254/",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://2130706433/",
  ])("refuses the private literal %s", (url) => {
    expect(() => normalizeIntegrationBaseUrl(url)).toThrow();
  });

  it("refuses credentials, a query string and other schemes", () => {
    expect(() =>
      normalizeIntegrationBaseUrl("https://u:p@a.example/"),
    ).toThrow();
    expect(() =>
      normalizeIntegrationBaseUrl("https://a.example/?x=1"),
    ).toThrow();
    expect(() => normalizeIntegrationBaseUrl("ftp://a.example/")).toThrow();
  });
});
