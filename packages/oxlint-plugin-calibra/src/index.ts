// Custom oxlint plugin encoding Calibra Fácil's architectural boundaries as
// deterministic lint rules. Loaded via `jsPlugins` in the root .oxlintrc.json, so
// every per-package `oxlint` run (pnpm lint / CI) enforces the boundaries that
// previously relied on manual `rg` scans.
//
// Each rule carries a LEGACY_BASELINE ratchet: existing violations can be
// grandfathered with exact per-file counts while net-new ones fail. Only
// no-json-error-body-in-routes, no-calibration-job-update-outside-owner and
// no-process-env carry a non-empty baseline (legacy writers, remaining reads).
import noApiImportInFrontend from "./rules/no-api-import-in-frontend.ts";
import noHonoClientOutsideClientRuntime from "./rules/no-hono-client-outside-client-runtime.ts";
import noCalibrationJobUpdateOutsideOwner from "./rules/no-calibration-job-update-outside-owner.ts";
import noRawLocaleFormatting from "./rules/no-raw-locale-formatting.ts";
import noJsonErrorBodyInRoutes from "./rules/no-json-error-body-in-routes.ts";
import noProcessEnv from "./rules/no-process-env.ts";
import noRouterCouplingInFeatures from "./rules/no-router-coupling-in-features.ts";

export default {
  meta: {
    name: "calibra",
  },
  rules: {
    "no-api-import-in-frontend": noApiImportInFrontend,
    "no-hono-client-outside-client-runtime": noHonoClientOutsideClientRuntime,
    "no-calibration-job-update-outside-owner":
      noCalibrationJobUpdateOutsideOwner,
    "no-raw-locale-formatting": noRawLocaleFormatting,
    "no-json-error-body-in-routes": noJsonErrorBodyInRoutes,
    "no-router-coupling-in-features": noRouterCouplingInFeatures,
    "no-process-env": noProcessEnv,
  },
};
