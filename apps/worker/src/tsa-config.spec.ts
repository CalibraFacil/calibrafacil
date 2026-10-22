import { describe, it, expect } from "vitest";

import { resolveTsaConfig } from "./tsa-config";

describe("resolveTsaConfig (#646 / CMP-03)", () => {
  it("returns null when SIGNING_TSA_URL is unset/blank (AD-RB baseline)", () => {
    expect(resolveTsaConfig({})).toBeNull();
    expect(resolveTsaConfig({ SIGNING_TSA_URL: "  " })).toBeNull();
  });

  it("builds the config with the Authorization header for a contracted ACT", () => {
    const config = resolveTsaConfig({
      SIGNING_TSA_URL: "https://act.example/tsa",
      SIGNING_TSA_AUTH: "Basic abc123",
      SIGNING_TSA_ICP_CONFORMANT: "true",
    });
    expect(config).toMatchObject({
      tsaUrl: "https://act.example/tsa",
      headers: { Authorization: "Basic abc123" },
      icpBrasilConformant: true,
    });
  });

  it("REQ-TSA-1: passes SIGNING_TSA_TIMEOUT_MS on as the request timeout, ignoring an unusable value", () => {
    const url = "https://act.example/tsa";
    expect(
      resolveTsaConfig({
        SIGNING_TSA_URL: url,
        SIGNING_TSA_TIMEOUT_MS: "15000",
      })?.timeoutMs,
    ).toBe(15000);
    for (const unusable of ["", "soon", "-5", "0", "1.5"]) {
      expect(
        resolveTsaConfig({
          SIGNING_TSA_URL: url,
          SIGNING_TSA_TIMEOUT_MS: unusable,
        })?.timeoutMs,
      ).toBeUndefined();
    }
  });

  it("defaults icpBrasilConformant to FALSE — honest labeling for generic TSAs", () => {
    const generic = resolveTsaConfig({
      SIGNING_TSA_URL: "https://freetsa.example",
    });
    expect(generic?.icpBrasilConformant).toBe(false);
    expect(generic?.headers).toBeUndefined();

    // Anything but the literal "true" stays false.
    const almost = resolveTsaConfig({
      SIGNING_TSA_URL: "https://act.example",
      SIGNING_TSA_ICP_CONFORMANT: "TRUE ",
    });
    expect(almost?.icpBrasilConformant).toBe(false);
  });
});
