import { defineGroup, presence, text } from "../define";

/**
 * The Electron desktop host (apps/desktop). The cloud API and web origin it
 * talks to are baked in at build time; these variables override them for
 * development and for the packaged smoke runs. The variables the host hands to
 * the local server are under "Local server".
 */
export const desktopGroup = defineGroup({
  name: "desktop",
  title: "Desktop host",
  intro: [
    "Used by apps/desktop. Overrides for the cloud endpoint the shell talks to",
    "and the hooks the smoke scripts use; a release build needs none of them.",
  ],
  vars: {
    rendererUrl: text({
      env: "CALIBRA_DESKTOP_RENDERER_URL",
      description:
        "Web app the unpackaged shell loads (default http://localhost:5173). Ignored by a packaged build.",
    }),
    authApiUrl: text({
      env: "CALIBRA_DESKTOP_AUTH_API_URL",
      description:
        "Cloud API the shell signs in against and syncs with, instead of the build-time one.",
    }),
    authOrigin: text({
      env: "CALIBRA_DESKTOP_AUTH_ORIGIN",
      description:
        "Web origin the shell presents to the cloud API for sign-in, instead of the build-time one.",
    }),
    skipLocalServer: presence({
      env: "CALIBRA_DESKTOP_SKIP_LOCAL_SERVER",
      description:
        "Set to anything to not spawn the local server (the smoke scripts bring their own).",
    }),
    smokeHooks: text({
      env: "CALIBRA_DESKTOP_ENABLE_SMOKE_HOOKS",
      description: "`1` enables the smoke-test hooks. Never set in production.",
    }),
    smokeUpdateVersion: text({
      env: "CALIBRA_DESKTOP_SMOKE_DOWNLOADED_UPDATE_VERSION",
      description:
        "With the smoke hooks on, start with an update of this version already downloaded.",
    }),
  },
  derive: (values) => ({
    /** The downloaded-update version the smoke hooks ask for, if they are on. */
    smokeDownloadedUpdateVersion:
      values.smokeHooks === "1" ? (values.smokeUpdateVersion ?? null) : null,
  }),
});
