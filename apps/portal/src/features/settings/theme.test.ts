import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_STORAGE_KEY } from "@calibra-facil/shared/client-storage-keys";
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

describe("theme bootstrap", () => {
  it("index.html reads the stored theme from the key the app writes it to", () => {
    const html = readFileSync(join(__dirname, "../../../index.html"), "utf8");

    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });
});
