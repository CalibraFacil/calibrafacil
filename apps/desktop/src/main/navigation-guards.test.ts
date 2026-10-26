import { describe, expect, it, vi } from "vitest";
import {
  decideNavigation,
  externalUrlToOpen,
  installNavigationGuards,
  type GuardedWebContents,
} from "./navigation-guards";
import { resolveTrustedOrigins } from "./trusted-origins";

const base = { appScheme: "app", appHost: "calibra-facil" };
const packaged = resolveTrustedOrigins({ ...base, isPackaged: true });
const unpackaged = resolveTrustedOrigins({ ...base, isPackaged: false });

type Listener = (event: {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}) => void;

function fakeContents() {
  const listeners = new Map<string, Listener[]>();
  let attachWebview:
    | Listener
    | ((event: { preventDefault(): void }) => void)
    | undefined;
  let openHandler:
    | ((details: { url: string }) => { action: "deny" })
    | undefined;

  const contents: GuardedWebContents = {
    on(
      eventName: string,
      listener: Listener | ((event: { preventDefault(): void }) => void),
    ) {
      if (eventName === "will-attach-webview") {
        attachWebview = listener;
        return;
      }
      listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener]);
    },
    setWindowOpenHandler(handler) {
      openHandler = handler;
    },
  };

  return {
    contents,
    navigate(eventName: string, url: string, isMainFrame = true) {
      const event = { url, isMainFrame, preventDefault: vi.fn() };
      for (const listener of listeners.get(eventName) ?? []) listener(event);
      return event;
    },
    attachWebview() {
      const event = { url: "", isMainFrame: true, preventDefault: vi.fn() };
      attachWebview?.(event);
      return event;
    },
    openWindow(url: string) {
      return openHandler?.({ url });
    },
  };
}

describe("externalUrlToOpen", () => {
  it("passes http and https links through", () => {
    expect(externalUrlToOpen("https://example.com/a?b=1")).toBe(
      "https://example.com/a?b=1",
    );
    expect(externalUrlToOpen("http://example.com")).toBe("http://example.com/");
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "calibrafacil://open/x",
    "ms-msdt:/id PCWDiagnostic",
    "smb://host/share",
    "https://user:pw@example.com/",
    "not a url",
    "",
  ])("refuses %s", (url) => {
    expect(externalUrlToOpen(url)).toBeNull();
  });

  it("refuses non-strings", () => {
    expect(externalUrlToOpen(undefined)).toBeNull();
    expect(externalUrlToOpen({})).toBeNull();
  });
});

describe("decideNavigation", () => {
  it("allows the app and, unpackaged, the dev server", () => {
    expect(decideNavigation("app://calibra-facil/dashboard", packaged)).toEqual(
      { action: "allow" },
    );
    expect(decideNavigation("http://localhost:5173/x", unpackaged)).toEqual({
      action: "allow",
    });
  });

  it("blocks the dev server in a packaged build", () => {
    expect(decideNavigation("http://localhost:5173/x", packaged)).toEqual({
      action: "block",
      openExternally: "http://localhost:5173/x",
    });
  });

  it("blocks and forwards a foreign https link", () => {
    expect(decideNavigation("https://evil.example/", packaged)).toEqual({
      action: "block",
      openExternally: "https://evil.example/",
    });
  });

  it("blocks without forwarding anything that is not a web link", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "app://calibra-facil.evil/",
      "app://calibra-facil@evil.example/",
    ]) {
      expect(decideNavigation(url, packaged), url).toMatchObject({
        action: "block",
      });
    }
    expect(decideNavigation("file:///etc/passwd", packaged)).toEqual({
      action: "block",
      openExternally: null,
    });
  });
});

describe("installNavigationGuards", () => {
  function setup(trusted = packaged) {
    const fake = fakeContents();
    const openExternal = vi.fn();
    installNavigationGuards(fake.contents, {
      trustedOrigins: () => trusted,
      openExternal,
    });
    return { ...fake, openExternal };
  }

  it.each(["will-navigate", "will-redirect", "will-frame-navigate"])(
    "lets %s stay on the app",
    (eventName) => {
      const { navigate, openExternal } = setup();
      const event = navigate(eventName, "app://calibra-facil/dashboard/jobs");

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it.each(["will-navigate", "will-redirect", "will-frame-navigate"])(
    "cancels %s to a foreign page and opens https links externally",
    (eventName) => {
      const { navigate, openExternal } = setup();
      const event = navigate(eventName, "https://evil.example/phish");

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(openExternal).toHaveBeenCalledWith("https://evil.example/phish");
    },
  );

  it.each(["will-navigate", "will-redirect", "will-frame-navigate"])(
    "cancels %s to the userinfo bypass without opening it",
    (eventName) => {
      const { navigate, openExternal } = setup(unpackaged);
      const event = navigate(eventName, "http://localhost:5173@evil.example/");

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it("opens a link once when both will-frame-navigate and will-navigate report it", () => {
    const { navigate, openExternal } = setup();
    navigate("will-frame-navigate", "https://example.com/docs");
    navigate("will-navigate", "https://example.com/docs");

    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("leaves subframe navigations to the CSP", () => {
    const { navigate, openExternal } = setup();
    const event = navigate(
      "will-frame-navigate",
      "https://files.example/c.pdf",
      false,
    );

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("refuses webview attachment", () => {
    const { attachWebview } = setup();
    expect(attachWebview().preventDefault).toHaveBeenCalledTimes(1);
  });

  it("denies every window.open and forwards only web links", () => {
    const { openWindow, openExternal } = setup();

    expect(openWindow("https://example.com/x")).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/x");

    openExternal.mockClear();
    expect(openWindow("file:///etc/passwd")).toEqual({ action: "deny" });
    expect(openWindow("")).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
