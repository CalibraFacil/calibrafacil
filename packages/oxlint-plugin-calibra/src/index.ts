// Custom oxlint plugin encoding Calibra Fácil's architectural boundaries as
// deterministic lint rules. Loaded via `jsPlugins` in the root .oxlintrc.json, so
// every per-package `oxlint` run (pnpm lint / CI) enforces the boundaries that
// previously relied on manual `rg` scans.
//
// Each rule carries a LEGACY_BASELINE ratchet: existing violations can be
// grandfathered with exact per-file counts while net-new ones fail. All
// baselines are empty today — the boundaries are currently clean.
import noApiImportInFrontend from "./rules/no-api-import-in-frontend.ts";
import noHonoClientOutsideClientRuntime from "./rules/no-hono-client-outside-client-runtime.ts";
import noRouterCouplingInFeatures from "./rules/no-router-coupling-in-features.ts";

export default {
  meta: {
    name: "calibra",
  },
  rules: {
    "no-api-import-in-frontend": noApiImportInFrontend,
    "no-hono-client-outside-client-runtime": noHonoClientOutsideClientRuntime,
    "no-router-coupling-in-features": noRouterCouplingInFeatures,
  },
};
