import { describe, expect, it } from "vitest";

import {
  PORTAL_NOTIFICATION_TYPES,
  PREFERENCE_GROUPS,
  formatBadgeCount,
  getNotificationTypeMeta,
  normalizeActionUrl,
} from "./lib";

describe("normalizeActionUrl", () => {
  // Mirrors resolveEmailActionUrl in packages/notifications: rows store
  // portal deep links as /portal/... paths.
  it("strips the /portal prefix for internal navigation", () => {
    expect(normalizeActionUrl("/portal/certificates")).toEqual({
      kind: "internal",
      to: "/certificates",
    });
    expect(normalizeActionUrl("/portal/requests/42")).toEqual({
      kind: "internal",
      to: "/requests/42",
    });
  });

  it("maps the bare /portal root to /", () => {
    expect(normalizeActionUrl("/portal")).toEqual({
      kind: "internal",
      to: "/",
    });
  });

  it("does not strip prefixes of look-alike paths", () => {
    expect(normalizeActionUrl("/portalx/foo")).toEqual({
      kind: "internal",
      to: "/portalx/foo",
    });
  });

  it("passes absolute URLs through as external", () => {
    expect(normalizeActionUrl("https://example.com/doc")).toEqual({
      kind: "external",
      href: "https://example.com/doc",
    });
  });

  it("keeps other relative paths internal and rooted", () => {
    expect(normalizeActionUrl("/certificates")).toEqual({
      kind: "internal",
      to: "/certificates",
    });
    expect(normalizeActionUrl("certificates")).toEqual({
      kind: "internal",
      to: "/certificates",
    });
  });

  it("returns null for missing values", () => {
    expect(normalizeActionUrl(null)).toBeNull();
    expect(normalizeActionUrl(undefined)).toBeNull();
    expect(normalizeActionUrl("")).toBeNull();
  });
});

describe("getNotificationTypeMeta", () => {
  it("has meta for every whitelisted type", () => {
    for (const type of PORTAL_NOTIFICATION_TYPES) {
      const meta = getNotificationTypeMeta(type);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon).toBeDefined();
    }
  });

  it("falls back to a neutral meta for unknown types", () => {
    const meta = getNotificationTypeMeta("SOMETHING_NEW");
    expect(meta.tone).toBe("neutral");
    expect(meta.label).toBe("Notificação");
  });
});

describe("PREFERENCE_GROUPS", () => {
  it("covers every whitelisted type exactly once", () => {
    const grouped = PREFERENCE_GROUPS.flatMap((group) => group.types);
    expect([...grouped].sort()).toEqual([...PORTAL_NOTIFICATION_TYPES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe("formatBadgeCount", () => {
  it("caps at 9+", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(9)).toBe("9");
    expect(formatBadgeCount(10)).toBe("9+");
    expect(formatBadgeCount(120)).toBe("9+");
  });
});
