# @calibra-facil/shared

Domain vocabularies and helpers shared by the API, the worker and the frontends.

## Overview

The package has no runtime dependencies, so every module can be imported from any runtime (Bun,
Node, the browser, the Electron renderer).

## Modules

| Module                                            | What it holds                                                   |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `cnpj`                                            | CNPJ validation, including the 2026 alphanumeric format         |
| `units`, `mass-units`                             | Measurement-unit registry and value conversion                  |
| `calibration-format`, `format`                    | Calibration numbers, dates, currency and plurals                |
| `format-specifications`                           | Instrument specifications for display                           |
| `accreditation`                                   | Accreditation number and seal formatting                        |
| `scope-compliance`                                | Accredited-scope (CMC) compliance evaluation                    |
| `legal-metrology`                                 | Inmetro legal-metrology regulation category per asset type      |
| `service-orders`                                  | Service-order statuses, priorities, intake and delivery methods |
| `finance`                                         | Agreement, billing-document, receivable and release statuses    |
| `integrations`                                    | Financial ERP (Conta Azul) provider types and capabilities      |
| `background-jobs`                                 | Background job messages shared by the API and the worker        |
| `portal-digest`                                   | Client-portal digest frequencies                                |
| `public-api`                                      | Public integrator API resource types and webhook events         |
| `signup-email-policy`                             | Corporate-domain rule for the self-service sign-up              |
| `domain-utils`                                    | Hostname and origin normalization                               |
| `public-urls`, `storage-keys`, `storage-endpoint` | Public URL builders and the object-storage layout               |
| `telemetry`                                       | Logger and a dependency-free Sentry error reporter              |

## Exports

- `@calibra-facil/shared`: the root re-exports most modules.
- Subpaths (`@calibra-facil/shared/units`, `/cnpj`, `/public-urls`, …) are listed in
  `package.json` `exports`.
