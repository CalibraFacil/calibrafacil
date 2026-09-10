import { describe, expect, it } from "vitest";

import { describeUnreadOverlay, resolveUnreadBadge } from "./unread-badge";

describe("resolveUnreadBadge", () => {
  it("sets a dock count on macOS", () => {
    expect(resolveUnreadBadge(3, "darwin")).toEqual({
      kind: "count",
      count: 3,
    });
  });

  it("sets a launcher count on Linux", () => {
    expect(resolveUnreadBadge(3, "linux")).toEqual({ kind: "count", count: 3 });
  });

  it("clears the count at zero rather than doing nothing", () => {
    // Electron treats 0 as "hide the badge", so the effect still has to fire.
    expect(resolveUnreadBadge(0, "darwin")).toEqual({
      kind: "count",
      count: 0,
    });
  });

  it("uses a taskbar overlay on Windows, which has no count badge", () => {
    expect(resolveUnreadBadge(3, "win32")).toEqual({
      kind: "overlay",
      visible: true,
      description: "3 notificações não lidas",
    });
  });

  it("clears the Windows overlay at zero", () => {
    expect(resolveUnreadBadge(0, "win32")).toEqual({
      kind: "overlay",
      visible: false,
    });
  });

  it("does nothing on a platform with no badge concept", () => {
    expect(resolveUnreadBadge(3, "freebsd")).toEqual({ kind: "none" });
  });

  it("never renders a negative or fractional count", () => {
    // An upstream bug must not put something strange on the user's dock.
    expect(resolveUnreadBadge(-4, "darwin")).toEqual({
      kind: "count",
      count: 0,
    });
    expect(resolveUnreadBadge(2.7, "darwin")).toEqual({
      kind: "count",
      count: 2,
    });
    expect(resolveUnreadBadge(Number.NaN, "darwin")).toEqual({
      kind: "count",
      count: 0,
    });
    expect(resolveUnreadBadge(Number.POSITIVE_INFINITY, "win32")).toEqual({
      kind: "overlay",
      visible: false,
    });
  });
});

describe("describeUnreadOverlay", () => {
  it("agrees in number", () => {
    expect(describeUnreadOverlay(1)).toBe("1 notificação não lida");
    expect(describeUnreadOverlay(4)).toBe("4 notificações não lidas");
  });
});
