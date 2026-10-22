import { defineGroup, example, list, text, url } from "../define.ts";

export const originsGroup = defineGroup({
  name: "origins",
  title: "Addresses and origins",
  intro: [
    "Public URLs of the deployment (no trailing slash). API_URL equals APP_URL when",
    "the API is served under /api on the app's own host.",
  ],
  vars: {
    apiUrl: url({
      env: "API_URL",
      description: "Public address of the API.",
      requiredInProduction: ["api"],
      example: example.active("http://localhost:3000"),
    }),
    appUrl: url({
      env: "APP_URL",
      description: "Public address of the lab app.",
      requiredInProduction: ["api"],
      example: example.active("http://localhost:5173"),
    }),
    webUrl: url({
      env: "WEB_URL",
      description: "Older name of APP_URL; used only when APP_URL is not set.",
      hidden: true,
    }),
    portalAppUrl: url({
      env: "PORTAL_APP_URL",
      description:
        "Public address of the client portal (derived from APP_URL when unset).",
      example: example.active("http://localhost:5174"),
    }),
    portalUrl: url({
      env: "PORTAL_URL",
      description: "Older name of PORTAL_APP_URL.",
      hidden: true,
    }),
    siteUrl: url({
      env: "SITE_URL",
      description:
        "Public project site; its origin is trusted by auth and CORS.",
      example: example.commented(""),
    }),
    verifyUrl: url({
      env: "VERIFY_URL",
      description:
        "Host of the public certificate-verification page (defaults to PORTAL_APP_URL).",
      example: example.commented(""),
    }),
    corsAllowedOrigins: list({
      env: "CORS_ALLOWED_ORIGINS",
      description:
        "Extra origins allowed by CORS (comma-separated). The APP_URL, PORTAL_APP_URL, SITE_URL, API_URL and VERIFY_URL origins are always included.",
      example: example.commented(""),
    }),
    authTrustedOrigins: list({
      env: "AUTH_TRUSTED_ORIGINS",
      description:
        "Extra origins trusted by authentication (comma-separated); the same origins as above are always included.",
      example: example.commented(""),
    }),
    authCookieDomain: text({
      env: "AUTH_COOKIE_DOMAIN",
      description:
        "Share session cookies across subdomains (API on api.example.com serving frontends on example.com and portal.example.com), e.g. .example.com.",
      example: example.commented(".example.com"),
    }),
  },
});
