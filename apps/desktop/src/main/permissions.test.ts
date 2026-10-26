import { describe, expect, it } from "vitest";
import {
  allowedPermissions,
  installPermissionPolicy,
  isPermissionAllowed,
  type PermissionSession,
} from "./permissions";
import { resolveTrustedOrigins } from "./trusted-origins";

const trusted = resolveTrustedOrigins({
  appScheme: "app",
  appHost: "calibra-facil",
  isPackaged: true,
});
const appUrl = "app://calibra-facil/dashboard";

function installed() {
  let request: Parameters<PermissionSession["setPermissionRequestHandler"]>[0];
  let check: Parameters<PermissionSession["setPermissionCheckHandler"]>[0];
  let device: Parameters<PermissionSession["setDevicePermissionHandler"]>[0];

  installPermissionPolicy(
    {
      setPermissionRequestHandler: (handler) => {
        request = handler;
      },
      setPermissionCheckHandler: (handler) => {
        check = handler;
      },
      setDevicePermissionHandler: (handler) => {
        device = handler;
      },
    },
    () => trusted,
  );

  return {
    request(permission: string, requestingUrl: string) {
      let granted: boolean | undefined;
      request?.(null, permission, (value) => (granted = value), {
        requestingUrl,
      });
      return granted;
    },
    check(permission: string, origin: string, requestingUrl?: string) {
      return check?.(null, permission, origin, { requestingUrl });
    },
    device: () => device?.({}),
  };
}

describe("permission policy", () => {
  it("allows exactly the clipboard write the UI uses", () => {
    expect([...allowedPermissions]).toEqual(["clipboard-sanitized-write"]);
  });

  it("grants it to the app only", () => {
    const policy = installed();

    expect(policy.request("clipboard-sanitized-write", appUrl)).toBe(true);
    expect(
      policy.check("clipboard-sanitized-write", "app://calibra-facil/", appUrl),
    ).toBe(true);
    expect(
      policy.check("clipboard-sanitized-write", "app://calibra-facil/"),
    ).toBe(true);

    for (const url of [
      "https://evil.example/",
      "app://calibra-facil@evil.example/",
      "http://localhost:5173/",
      "",
    ]) {
      expect(policy.request("clipboard-sanitized-write", url), url).toBe(false);
      expect(policy.check("clipboard-sanitized-write", url, url), url).toBe(
        false,
      );
    }
  });

  it.each([
    "media",
    "mediaKeySystem",
    "geolocation",
    "notifications",
    "midi",
    "midiSysex",
    "pointerLock",
    "fullscreen",
    "openExternal",
    "clipboard-read",
    "display-capture",
    "idle-detection",
    "window-management",
    "unknown",
    "usb",
    "serial",
    "hid",
    "",
  ])("denies %s even for the app", (permission) => {
    const policy = installed();

    expect(isPermissionAllowed(permission, appUrl, trusted)).toBe(false);
    expect(policy.request(permission, appUrl)).toBe(false);
    expect(policy.check(permission, "app://calibra-facil/", appUrl)).toBe(
      false,
    );
  });

  it("refuses device grants", () => {
    expect(installed().device()).toBe(false);
  });
});
