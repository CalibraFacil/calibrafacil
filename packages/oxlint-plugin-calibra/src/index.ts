// Custom oxlint plugin encoding Calibra Fácil's architectural boundaries as
// deterministic lint rules. Loaded via `jsPlugins` in the root .oxlintrc.json, so
// every per-package `oxlint` run (pnpm lint / CI) enforces the boundaries that
// previously relied on manual `rg` scans.
//
// A rule whose legacy violations are not all gone carries a LEGACY_BASELINE
// ratchet: existing violations are grandfathered with exact per-file counts while
// net-new ones fail. Only no-json-error-body-in-routes,
// no-calibration-job-update-outside-owner, no-process-env, no-raw-locale-formatting
// and no-raw-palette-color-classes have a non-empty baseline (the rest, including
// no-features-import-from-low-layers, no-literal-query-keys and
// no-api-domain-boundary-violations, report every
// occurrence; no-raw-db-in-routes and no-error-response-in-transaction keep a
// `baseline` rule option for their own tests only). no-raw-db-in-routes also fails
// a count that is higher than the file's real number of uses (stale).
import noApiImportInFrontend from "./rules/no-api-import-in-frontend.ts";
import noHonoClientOutsideClientRuntime from "./rules/no-hono-client-outside-client-runtime.ts";
import noCalibrationJobUpdateOutsideOwner from "./rules/no-calibration-job-update-outside-owner.ts";
import noJobAuditInsertOutsideOwner from "./rules/no-job-audit-insert-outside-owner.ts";
import noRawLocaleFormatting from "./rules/no-raw-locale-formatting.ts";
import noJsonErrorBodyInRoutes from "./rules/no-json-error-body-in-routes.ts";
import noRawDbInRoutes from "./rules/no-raw-db-in-routes.ts";
import noProcessEnv from "./rules/no-process-env.ts";
import noUnparsedPortalFetch from "./rules/no-unparsed-portal-fetch.ts";
import noRouterCouplingInFeatures from "./rules/no-router-coupling-in-features.ts";
import noRawPaletteColorClasses from "./rules/no-raw-palette-color-classes.ts";
import noAppUiPrimitiveRecreation from "./rules/no-app-ui-primitive-recreation.ts";
import noErrorResponseInTransaction from "./rules/no-error-response-in-transaction.ts";
import noFeaturesImportFromLowLayers from "./rules/no-features-import-from-low-layers.ts";
import noLiteralQueryKeys from "./rules/no-literal-query-keys.ts";
import noApiDomainBoundaryViolations from "./rules/no-api-domain-boundary-violations.ts";

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
    "no-raw-db-in-routes": noRawDbInRoutes,
    "no-process-env": noProcessEnv,
    "no-unparsed-portal-fetch": noUnparsedPortalFetch,
    "no-raw-palette-color-classes": noRawPaletteColorClasses,
    "no-app-ui-primitive-recreation": noAppUiPrimitiveRecreation,
    "no-error-response-in-transaction": noErrorResponseInTransaction,
    "no-features-import-from-low-layers": noFeaturesImportFromLowLayers,
    "no-literal-query-keys": noLiteralQueryKeys,
    "no-api-domain-boundary-violations": noApiDomainBoundaryViolations,
  },
};
