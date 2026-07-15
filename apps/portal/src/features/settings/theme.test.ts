import { describe, expect, it } from "vitest";

import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("accepts the three valid themes", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("system")).toBe("system");
  });

  it("falls back to system for anything else", () => {
    expect(resolveTheme(null)).toBe("system");
    expect(resolveTheme("")).toBe("system");
    expect(resolveTheme("DARK")).toBe("system");
    expect(resolveTheme("solarized")).toBe("system");
  });
});
