# Math-engine audit — 2026-09-07

Scope: `packages/math-engine` calculation, uncertainty propagation, parser/evaluator, numeric backend and audit serialization. Read-only source review plus public-API reproductions using Bun. No production code changes. This is not a complete metrological validation.

Checks: `pnpm --dir packages/math-engine test:run` passed (33 tests, two files); `pnpm --dir packages/math-engine check-types` passed.

## P1 — Discontinuous if_zero model gets an automatic zero sensitivity

Location: `src/formula/derivative.ts:134`; `src/gum/measurement.ts:1451`.

`evaluateMeasurementModel({formula: "if_zero(x, 0, 1)", quantities: {x: {estimate: 0, standardUncertainty: 1}}})` returns value 0, sensitivity 0, combined and expanded uncertainty 0. Diagnostics only report audit context and symbolic sensitivity. The function is discontinuous at x=0 and has no derivative there. Branch differentiation is invalid at this operating point, but if_zero is absent from the non-smooth function guard. Reject this case or require the explicit non-smooth override and explicit sensitivities.

## P1 — Global covariance tolerance admits impossible small-scale covariance

Location: `src/gum/measurement.ts:1266-1271,1306`.

Reproduction: formula `b+c`; quantities a={estimate:0,standardUncertainty:1000000}, b=c={estimate:0,standardUncertainty:0.001}; covariances=[["b","c",0.001]]. Accepted, returning combined uncertainty 0.04474371464239419. The covariance bound for b,c is 0.000001: the supplied value implies correlation 1000. The unrelated large variance inflates both the pairwise bound tolerance and Cholesky tolerances, admitting a non-positive-semidefinite matrix. Normalize to a correlation matrix or use suitable local scaling, including for zero-variance quantities. Reject independently of the selected formula.

## P1 — Repeated observations plus Type B silently discards repeatability

Location: `src/gum/measurement.ts:671-688`.

Reproduction: formula `x`; quantity x={repeatedObservations:[9.8,10,10.2],typeB:{distribution:"rectangular",halfWidth:0.003}}. Returns combined uncertainty 0.0017320508075688774 and effective degrees of freedom 2. The observations alone give uncertainty approximately 0.115470; supplying an additional source replaces it with the Type B value, while retaining the observations' degrees of freedom. If these represent independent components, quadrature gives approximately 0.115483. Either explicitly reject this ambiguous combination and require separate quantities, or combine components and derive the appropriate effective degrees of freedom. Do not silently select one source.

GUM reference for combination of standard uncertainties and covariance: JCGM 100:2008, section 5, https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf .

All three reproductions used the default engine configuration and public createCalculationEngine().evaluateMeasurementModel API. Existing passing tests do not cover these cases. Fixes were not applied.

## Remediation

The follow-up fix rejects mixed observation/uncertainty sources with `INVALID_UNCERTAINTY` and directs callers to separate quantities. `if_zero` now follows the existing non-smooth policy: measurement models require both the explicit override and sensitivities for every formula variable; ordinary formula evaluation retains lazy branches. Covariance bounds use each pair's uncertainty product, and PSD validation runs on the normalized correlation matrix, including zero-variance rows.

Added 40 regression cases across decimal and number modes. Running these against the original implementation produced 22 failures and 18 passes; the fixed implementation passes all 40. The original GUM oracle values and dossier manifest remain unchanged.

Validation:

- Math-engine: 73 tests passed, including the existing GUM known-answer tests and dossier gate.
- Method-definition: 156 tests passed, including real-engine golden execution cases.
- API math-engine known-answer tests: 8 passed.
- Math-engine TypeScript check passed.
- Repository `pnpm lint`: 16 tasks successful; existing warnings remain.
- Direct oxlint of the changed source files and new test: 37 existing diagnostics, identical to the baseline; no new diagnostics. The new test file passes lint independently.
- Changed files formatted with Prettier; whitespace checks passed.

These checks provide regression evidence; they do not replace laboratory method validation. Callers that previously combined uncertainty sources on one quantity or relied on automatic sensitivities for `if_zero` must supply the now-required explicit model configuration.
