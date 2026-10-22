import { defineGroup, flag, integer, text, url } from "../define";

/**
 * The offline desktop server (apps/local-server). The Electron host normally
 * hands it a typed bootstrap envelope; these variables are the development
 * fallback (and the envelope's transport: CALIBRA_LOCAL_SERVER_BOOTSTRAP).
 */
export const localServerGroup = defineGroup({
  name: "localServer",
  title: "Local server (desktop / offline)",
  intro: [
    "Used by apps/local-server. The desktop host passes a base64url JSON bootstrap",
    "envelope; the individual variables are a development fallback.",
  ],
  vars: {
    bootstrap: text({
      env: "CALIBRA_LOCAL_SERVER_BOOTSTRAP",
      description:
        "base64url JSON bootstrap envelope from the desktop host; takes precedence over every other variable.",
      secret: true,
    }),
    bootstrapFromStdin: text({
      env: "CALIBRA_LOCAL_SERVER_BOOTSTRAP_STDIN",
      description: "`1` reads the bootstrap envelope from standard input.",
    }),
    dbPath: text({
      env: "CALIBRA_LOCAL_DB_PATH",
      description:
        "SQLite database file (default .calibra-local/calibra.sqlite in the repo).",
    }),
    dataRoot: text({
      env: "CALIBRA_LOCAL_DATA_ROOT",
      description: "Root of the per-account database partitions.",
    }),
    requirePartition: flag({
      env: "CALIBRA_LOCAL_REQUIRE_PARTITION",
      description:
        "Refuse to start without a signed-in account and organization (packaged builds).",
      default: false,
    }),
    host: text({
      env: "CALIBRA_LOCAL_HOST",
      description: "Address the local server binds to.",
      default: "127.0.0.1",
    }),
    port: integer({
      env: "CALIBRA_LOCAL_PORT",
      description: "Port the local server listens on.",
      min: 1,
      max: 65_535,
      default: 4317,
    }),
    appVersion: text({
      env: "CALIBRA_APP_VERSION",
      description: "Version of the desktop app.",
      default: "0.0.0-dev",
    }),
    localServerVersion: text({
      env: "CALIBRA_LOCAL_SERVER_VERSION",
      description: "Version of the local server.",
      default: "0.0.0-dev",
    }),
    storageDir: text({
      env: "CALIBRA_LOCAL_STORAGE_DIR",
      description:
        "Directory of locally stored files (default: next to the database).",
    }),
    deviceId: text({
      env: "CALIBRA_DEVICE_ID",
      description: "Identifies this device in sync.",
      default: "local-dev-device",
    }),
    tenantId: text({
      env: "CALIBRA_TENANT_ID",
      description: "Tenant of the signed-in account.",
    }),
    organizationId: text({
      env: "CALIBRA_ORGANIZATION_ID",
      description: "Organization of the signed-in account.",
    }),
    unitId: integer({
      env: "CALIBRA_UNIT_ID",
      description: "Unit of the signed-in account.",
      min: 0,
    }),
    userId: text({
      env: "CALIBRA_USER_ID",
      description: "Signed-in user.",
    }),
    syncEnabled: flag({
      env: "CALIBRA_SYNC_ENABLED",
      description:
        "Synchronise with the cloud (false for standalone development).",
      default: true,
    }),
    autoStartSync: flag({
      env: "CALIBRA_LOCAL_AUTO_START_SYNC",
      description: "Start the sync scheduler as soon as the server starts.",
      default: true,
    }),
    bootstrapToken: text({
      env: "CALIBRA_LOCAL_BOOTSTRAP_TOKEN",
      description: "Token the desktop host uses to talk to the local server.",
      secret: true,
    }),
    cloudApiUrl: url({
      env: "CALIBRA_CLOUD_API_URL",
      description: "Cloud API the local server synchronises with.",
    }),
    cloudAuthToken: text({
      env: "CALIBRA_CLOUD_AUTH_TOKEN",
      description: "Cloud session token.",
      secret: true,
    }),
    cloudProxyToken: text({
      env: "CALIBRA_CLOUD_PROXY_TOKEN",
      description: "Token for the cloud proxy.",
      secret: true,
    }),
    desktopRunId: text({
      env: "CALIBRA_DESKTOP_RUN_ID",
      description: "Identifies this desktop run in logs.",
      default: "desktop-dev-run",
    }),
    localServerRunId: text({
      env: "CALIBRA_LOCAL_SERVER_RUN_ID",
      description: "Identifies this local-server run in logs.",
      default: "local-server-dev-run",
    }),
  },
  derive: (values) => ({
    /** The envelope arrives on standard input. */
    readBootstrapFromStdin: values.bootstrapFromStdin === "1",
  }),
});
