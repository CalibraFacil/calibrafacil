import { describe, expect, it } from "vitest";
import {
  desktopBridge,
  desktopBridgeEventMethods,
  desktopBridgeInvokeMethods,
  desktopBridgeMethods,
} from "./desktop-bridge";

describe("desktop bridge table", () => {
  it("gives every method its own channel in the calibra namespace", () => {
    const channels = desktopBridgeMethods.map(
      (method) => desktopBridge[method].channel,
    );

    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) expect(channel).toMatch(/^calibra:/);
  });

  it("is split into invoke and event methods without overlap", () => {
    expect(
      [...desktopBridgeInvokeMethods, ...desktopBridgeEventMethods].sort(),
    ).toEqual([...desktopBridgeMethods].sort());
  });

  it("names every event method on*, so a listener is never mistaken for a call", () => {
    for (const method of desktopBridgeEventMethods) {
      expect(method).toMatch(/^on[A-Z]/);
    }
    for (const method of desktopBridgeInvokeMethods) {
      expect(method).not.toMatch(/^on[A-Z]/);
    }
  });

  it("validates request arguments and response payloads", () => {
    const authFetch = desktopBridge.authFetch;
    expect(() =>
      authFetch.args.parse([
        {
          url: "https://api.calibrafacil.com/api/sync/bootstrap",
          method: "POST",
          headers: [["content-type", "application/json"]],
          body: null,
        },
      ]),
    ).not.toThrow();
    expect(() =>
      authFetch.args.parse([
        { url: "not-a-url", method: "GET", headers: [], body: null },
      ]),
    ).toThrow();

    const update = desktopBridge.getUpdateState;
    expect(() =>
      update.response.parse({ status: "downloaded", version: "1.2.3" }),
    ).not.toThrow();
    expect(() =>
      update.response.parse({ status: "installed-without-sync-check" }),
    ).toThrow();
  });

  it("refuses the wrong number of arguments", () => {
    expect(() => desktopBridge.getAppInfo.args.parse([])).not.toThrow();
    expect(() => desktopBridge.getAppInfo.args.parse(["extra"])).toThrow();
    expect(() => desktopBridge.openExternal.args.parse([])).toThrow();
    expect(() => desktopBridge.openExternal.args.parse([""])).toThrow();
    expect(() =>
      desktopBridge.openExternal.args.parse(["https://a.test", "extra"]),
    ).toThrow();
  });

  it("carries only in-app route paths on the deep-link event", () => {
    expect(() =>
      desktopBridge.onDeepLink.payload.parse("/dashboard"),
    ).not.toThrow();
    expect(() =>
      desktopBridge.onDeepLink.payload.parse("https://evil.example"),
    ).toThrow();
  });

  it("marks only forgetOfflineAccess as optional for an older shell", () => {
    const optional = desktopBridgeInvokeMethods.filter(
      (method) => "optional" in desktopBridge[method],
    );
    expect(optional).toEqual(["forgetOfflineAccess"]);
  });
});
