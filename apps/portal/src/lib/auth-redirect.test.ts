import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authenticatedRoutePrefixes,
  sanitizePortalRedirect,
} from "./auth-redirect";

const AUTHENTICATED_DIR = join(__dirname, "../routes/_authenticated");

function topLevelRouteSegments(): string[] {
  return readdirSync(AUTHENTICATED_DIR)
    .filter((entry) => !/^(index|route)\.tsx$/.test(entry))
    .map((entry) => entry.replace(/\.tsx$/, ""));
}

describe("sanitizePortalRedirect", () => {
  it("keeps every top-level authenticated route, whatever the route folder holds", () => {
    const segments = topLevelRouteSegments();
    expect(segments.length).toBeGreaterThan(5);
    for (const segment of segments) {
      expect(sanitizePortalRedirect(`/${segment}`)).toBe(`/${segment}`);
      expect(sanitizePortalRedirect(`/${segment}?page=2#top`)).toBe(
        `/${segment}?page=2#top`,
      );
    }
  });

  it.each(["/calendar", "/reliability", "/out-of-tolerance", "/notifications"])(
    "keeps %s (a session that expires there signs back in there)",
    (path) => {
      expect(sanitizePortalRedirect(path)).toBe(path);
    },
  );

  it("falls back for other origins, blocked and unknown paths", () => {
    expect(sanitizePortalRedirect(undefined)).toBe("/");
    expect(sanitizePortalRedirect("//evil.example/assets")).toBe("/");
    expect(sanitizePortalRedirect("https://evil.example/assets")).toBe("/");
    expect(sanitizePortalRedirect("/sign-in")).toBe("/");
    expect(sanitizePortalRedirect("/not-a-route")).toBe("/");
  });
});

describe("authenticatedRoutePrefixes", () => {
  it("takes the first segment of each route file and skips the layout files", () => {
    expect(
      authenticatedRoutePrefixes([
        "../routes/_authenticated/index.tsx",
        "../routes/_authenticated/route.tsx",
        "../routes/_authenticated/assets/$id.tsx",
        "../routes/_authenticated/assets/index.tsx",
        "../routes/_authenticated/calendar/index.tsx",
        "../routes/_authenticated/settings.tsx",
      ]),
    ).toEqual(["/assets", "/calendar", "/settings"]);
  });
});
