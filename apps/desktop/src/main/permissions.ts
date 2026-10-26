import { isTrustedUrl, type TrustedOrigins } from "./trusted-origins";

/**
 * Chromium permissions the renderer may use.
 *
 * Electron grants every permission request unless a handler says otherwise, so
 * a compromised or merely careless page could ask for the camera, microphone,
 * geolocation or a device and get it. The list below is what the UI actually
 * calls, found by searching `apps/web` for the browser APIs behind each
 * permission:
 *
 * - `clipboard-sanitized-write`: `navigator.clipboard.writeText`, used by the
 *   "copy link" buttons (customers, service orders, integrations).
 *
 * Everything else is denied. In particular there is no camera or microphone
 * capture, `Notification` use (native notifications are raised by the main
 * process), geolocation, or WebUSB/WebSerial (thermal printers are driven
 * through the local server on the desktop).
 */
export const allowedPermissions: ReadonlySet<string> = new Set([
  "clipboard-sanitized-write",
]);

export function isPermissionAllowed(
  permission: string,
  requestingUrl: unknown,
  trusted: TrustedOrigins,
): boolean {
  return (
    allowedPermissions.has(permission) && isTrustedUrl(requestingUrl, trusted)
  );
}

type RequestDetails = { requestingUrl?: string };

/** The slice of Electron's `Session` the permission policy uses. */
export type PermissionSession = {
  setPermissionRequestHandler(
    handler:
      | ((
          webContents: unknown,
          permission: string,
          callback: (permissionGranted: boolean) => void,
          details: RequestDetails,
        ) => void)
      | null,
  ): void;
  setPermissionCheckHandler(
    handler:
      | ((
          webContents: unknown,
          permission: string,
          requestingOrigin: string,
          details: RequestDetails,
        ) => boolean)
      | null,
  ): void;
  setDevicePermissionHandler(
    handler: ((details: unknown) => boolean) | null,
  ): void;
};

export function installPermissionPolicy(
  session: PermissionSession,
  trustedOrigins: () => TrustedOrigins,
) {
  session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(
        isPermissionAllowed(
          permission,
          details.requestingUrl,
          trustedOrigins(),
        ),
      );
    },
  );

  // Synchronous checks (`navigator.permissions.query`, and some APIs that never
  // prompt). `requestingOrigin` can be `null`-ish for opaque origins, so prefer
  // the full URL Electron passes in the details.
  session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      isPermissionAllowed(
        permission,
        details.requestingUrl ?? requestingOrigin,
        trustedOrigins(),
      ),
  );

  // USB, serial and HID grants persist across sessions; refuse them outright.
  session.setDevicePermissionHandler(() => false);
}
