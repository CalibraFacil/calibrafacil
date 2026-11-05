import { defineGroup, example, text, url } from "../define";

/**
 * The `VITE_*` settings of the lab app and the client portal. Vite bakes them
 * into the bundle at build time; a prebuilt Docker image also reads them when
 * the container starts (the static server answers /runtime-env.js with them).
 */
export const webGroup = defineGroup({
  name: "web",
  title: "Lab app (apps/web)",
  vars: {
    apiUrl: url({
      env: "VITE_API_URL",
      description:
        "Address of the API when it is not served under /api on the app's own origin. A build argument for Docker images.",
      example: example.commented(""),
    }),
    portalAppUrl: url({
      env: "VITE_PORTAL_APP_URL",
      description: "Address of the client portal, for links shown in the app.",
    }),
    localApiUrl: url({
      env: "VITE_LOCAL_API_URL",
      description: "Desktop only: address of the local server.",
    }),
    desktopAuthApiUrl: url({
      env: "VITE_DESKTOP_AUTH_API_URL",
      description: "Desktop only: cloud API the sign-in flow talks to.",
    }),
    desktopAuthOrigin: url({
      env: "VITE_DESKTOP_AUTH_ORIGIN",
      description: "Desktop only: origin of the cloud sign-in pages.",
    }),
    responseValidation: text({
      env: "VITE_RESPONSE_VALIDATION",
      description:
        "`warn` logs API responses that do not match their contract.",
    }),
  },
});

export const portalGroup = defineGroup({
  name: "portal",
  title: "Client portal (apps/portal)",
  vars: {
    apiUrl: url({
      env: "VITE_API_URL",
      description:
        "Address of the API when it is not served under /api on the portal's own origin.",
    }),
    webUrl: url({
      env: "VITE_WEB_URL",
      description: "Address of the lab app, for links shown in the portal.",
    }),
  },
});
