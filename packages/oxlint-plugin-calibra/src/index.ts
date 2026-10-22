// Custom oxlint plugin encoding Calibra Fácil's architectural boundaries as
// deterministic lint rules. Loaded via `jsPlugins` in the root .oxlintrc.json, so
// every per-package `oxlint` run (pnpm lint / CI) enforces the boundaries that
// previously relied on manual `rg` scans.
//
// Each rule carries a LEGACY_BASELINE ratchet: existing violations can be
// grandfathered with exact per-file counts while net-new ones fail. Only
// no-json-error-body-in-routes, no-calibration-job-update-outside-owner,
// no-process-env and no-raw-palette-color-classes carry a non-empty baseline
// (legacy writers, remaining reads, raw palette colours in feature code).
import noApiImportInFrontend from "./rules/no-api-import-in-frontend.ts";
import noHonoClientOutsideClientRuntime from "./rules/no-hono-client-outside-client-runtime.ts";
import noCalibrationJobUpdateOutsideOwner from "./rules/no-calibration-job-update-outside-owner.ts";
import noJobAuditInsertOutsideOwner from "./rules/no-job-audit-insert-outside-owner.ts";
import noRawLocaleFormatting from "./rules/no-raw-locale-formatting.ts";
import noJsonErrorBodyInRoutes from "./rules/no-json-error-body-in-routes.ts";
import noProcessEnv from "./rules/no-process-env.ts";
import noUnparsedPortalFetch from "./rules/no-unparsed-portal-fetch.ts";
import noRouterCouplingInFeatures from "./rules/no-router-coupling-in-features.ts";
import noRawPaletteColorClasses from "./rules/no-raw-palette-color-classes.ts";
import noAppUiPrimitiveRecreation from "./rules/no-app-ui-primitive-recreation.ts";

export default {
  meta: {
    name: "calibra",
  },
  rules: {
    "no-api-import-in-frontend": noApiImportInFrontend,
    "no-hono-client-outside-client-runtime": noHonoClientOutsideClientRuntime,
    "no-calibration-job-update-outside-owner":
      noCalibrationJobUpdateOutsideOwner,
    "no-job-audit-insert-outside-owner": noJobAuditInsertOutsideOwner,
    "no-raw-locale-formatting": noRawLocaleFormatting,
    "no-json-error-body-in-routes": noJsonErrorBodyInRoutes,
    "no-router-coupling-in-features": noRouterCouplingInFeatures,
    "no-process-env": noProcessEnv,
    "no-unparsed-portal-fetch": noUnparsedPortalFetch,
    "no-raw-palette-color-classes": noRawPaletteColorClasses,
    "no-app-ui-primitive-recreation": noAppUiPrimitiveRecreation,
  },
};
