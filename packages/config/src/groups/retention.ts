import { choice, defineGroup, example, flag, text } from "../define.ts";
import { nodeEnvVar, vercelEnvVar } from "./runtime.ts";

export const retentionGroup = defineGroup({
  name: "retention",
  title: "Records retention",
  intro: [
    "See docs/architecture/records-retention.md and DEPLOYMENT.md. The records-purge",
    "cron does nothing unless RECORDS_PURGE_ENABLED=true, and even then it only LOGS",
    "what it would purge unless RECORDS_PURGE_MODE=execute.",
  ],
  vars: {
    purgeEnabled: flag({
      env: "RECORDS_PURGE_ENABLED",
      description:
        "Enables the records-purge cron. Only `true` enables it; anything else keeps it off.",
      default: false,
      tolerant: true,
      example: example.commented("false"),
    }),
    purgeMode: choice({
      env: "RECORDS_PURGE_MODE",
      description:
        "`execute` deletes eligible records; anything else (the default dry-run) only logs what would be purged.",
      values: ["dry-run", "execute"],
      default: "dry-run",
      tolerant: true,
      example: example.commented("dry-run"),
    }),
  },
});

export const observabilityGroup = defineGroup({
  name: "observability",
  title: "Logs and errors",
  intro: [
    "There is no error-tracking service and no DSN: unhandled errors are written as",
    "one redacted JSON line on stderr. These only label those lines.",
  ],
  vars: {
    nodeEnv: nodeEnvVar,
    vercelEnv: vercelEnvVar,
    release: text({
      env: "VERCEL_GIT_COMMIT_SHA",
      description:
        "Release label of the error log lines (the commit on Vercel).",
      hidden: true,
    }),
  },
  derive: (values) => ({
    /** `environment` label of the error log lines: VERCEL_ENV, else NODE_ENV. */
    environment: values.vercelEnv ?? values.nodeEnv,
  }),
});
