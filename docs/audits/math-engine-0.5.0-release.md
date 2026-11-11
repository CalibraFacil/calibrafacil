# Math-engine 0.5.0 — release note

Successor to 0.4.0 (dossier CF-VAL-MATH-ENGINE-0.4.0 rev. 1.2). Validation dossier: `validation/math-engine/v0.5.0/` (rev. 1.0).

## Why a new version

A review of the 0.4.0 source on 2026-11-11 read every file of the package and compared each statistical function with references that do not use the engine: mpmath at 60 significant digits, SciPy (Boost), and a table of LibreOffice's `TINV(4.55 %; ν)` at 11 511 values of ν. It found ten defects. None changes a published value of the dossier (GUM tables, EA-4/02 examples), and the usual coverage factors (p ≥ 68 %, ν ≥ 1) were already inside the declared precision. They are still wrong results from exported functions, a wrong sensitivity that only a warning flagged, and a calculation fingerprint that depended on the machine. Any byte of the engine source is pinned to its version, so fixing them is a release.

## What changed

Each item has a regression test that fails on 0.4.0.

1. **Student's t around the median.** `studentTCdf` formed `x = ν/(ν + t²)` in double: for `|t| < 1e-8·√ν` it rounded to 1 and the function returned exactly 0.5. `studentTQuantile(0.5, ν)` was not 0 (−1.5e-8 at ν = 2, −3.1e-5 at ν = 1e7) and quantiles next to the median had no correct digit. `x` and `1 − x` are now both formed from `t²`; the quantile is solved on the tail `P(T > a) = min(p, 1 − p)`, is exactly 0 at the median and odd around it to the last bit.
2. **Upper tail of the t quantile.** For p close to 1 the bisection compared `1 − tail` with p: 1.1e-6 relative at `p = 1 − 1e-12`. It is now the mirror of the lower tail.
3. **Incomplete beta truncated in silence.** The continued fraction stopped at 200 terms and returned what it had: `regularizedIncompleteBeta(0.5, 1e6, 1e6)` gave 0.4997. Student's t (b = ½) never needed more than 150 terms, so this was reachable only through the exported helper. The cap is 10 000 and a fraction that does not converge is an `INVALID_STATISTIC_INPUT` error.
4. **`ln B(a, b)` as a difference of large `ln Γ`.** Near ν = 1e7 the subtraction lost eight digits: up to 5e-8 relative in the quantile at p = 0.95, 4e-9 at p = 0.97725. `ln Γ(L) − ln Γ(L + s)` is now taken analytically from Stirling's series (Abramowitz and Stegun 6.1.40), and the logarithms of `x` and `1 − x` with `log1p`: at most 1.4e-10 for ν ≤ 1e7.
5. **`erf` and the normal quantile.** `erf` was Abramowitz and Stegun 7.1.26 (1.5e-7, and `erf(0) = 1e-9`, so `Φ(0) ≠ 0.5`); `normalQuantile` was Acklam's approximation without the refinement step the 0.4.0 dossier said it had (1.1e-9). `erf` is now the series 7.1.6 below 2 and `erfc` the continued fraction 7.1.14 from 2 on (4e-16); the quantile takes one step of Halley's method (1e-13 relative). `k(95 %, ∞)` goes from 1.959963986120195 to 1.9599639845400547.
6. **Overflow of `t²`.** For `|t| > 1.3e154` the tail was 0, and for very small ν the quantile came back as 1.34e154 instead of a value no double holds. `x` is carried by its logarithm there, and a quantile that is not representable is an error.
7. **Exact value to double.** `DeterministicDecimal.toNumber` divided two doubles that were already rounded: one or two units in the last place off for about one input in five with 18 or more significant digits (`80427220030586.574426022` gave `…586.56`, the nearest double is `…586.58`). It is now the nearest double, ties to even, assembled from sign, exponent and fraction with no floating-point operation. `sqrtToNumber` (Type A standard deviation, `sqrt` in decimal mode) rounds once, from the exact rational; the decimal backend's `sqrt` of a non-zero value below the double range returned 0.
8. **Symbolic sensitivity next to a constant call.** A call with two arguments (`student_t_inverse_2t`) or without a derivative (`abs`, `min`, …) made the whole formula non-differentiable even when the variable was not in it, and every sensitivity fell back to the numerical derivative, whose step is absolute below 1. For `sqrt(x) * student_t_inverse_2t(0.05, 10)` at `x = 1e-6` the engine returned c = 1575.5 for 1114.07, with warnings only. A sub-expression without the variable now differentiates to 0.
9. **Calculation fingerprint and the locale.** Declared correlations and covariances were ordered with `localeCompare` in the canonical input: under `et-EE` (z before t) the same model had another `calculationFingerprint`. The order is now by code unit, like the rest of the canonical JSON. A model with two or more relationships whose symbols mix upper case, lower case or underscore is recorded in a different order than 0.4.0 recorded it.
10. **Canonical JSON of values that are not records.** A `Map`, `Set`, `Date` or boxed primitive was written as `{}` and had the fingerprint of the empty record; a sparse array gave text that is not JSON. Both are refused with `ERR_INVALID_INPUT`.

`ENGINE_VERSION = "0.5.0"`, package version 0.5.0, new dossier directory, reference fingerprint `sha256:28538dbe…2471a`, source pin and golden models recorded with `engine:pin`.

Also in this change, outside the pinned source: the engine README lists `if_zero` and `student_t_inverse_2t`, which the formula syntax section left out; `engine-source-pin.spec.ts` fails when `src/` holds a file the pin cannot see (a `.js` beside a `.ts` would be the code that runs, unhashed; a symbolic link is skipped by the walk); an unused import left a spec.

## Delta against 0.4.0

The five golden models of `manifest.json`, same inputs, `METHOD_ENGINE_OPTIONS`:

| Model                                       | Changed                                                         | Max relative difference |
| ------------------------------------------- | --------------------------------------------------------------- | ----------------------- |
| additive, Type A + Type B, ν_eff ≈ 36       | `k` 2.07216272002245 → 2.0721627200224506; `U`                  | 2.9e-16                 |
| nonlinear thermal expansion                 | `k` 2.040672923003555 → 2.040672923003558; `U`                  | 1.5e-15                 |
| quotient and power, ν_eff ≈ 13.7            | `c_R` …2205 → …2204 (exact narrowing); `u_c`, `ν_eff`, `k`, `U` | 1.2e-15                 |
| correlated, generalized Welch–Satterthwaite | `k` 2.1131015426307718 → 2.113101542630774; `U`                 | 1.0e-15                 |
| explicit coverage factor                    | none                                                            | 0                       |

Every calculation fingerprint changes (the version is part of the digest).

`k(95.45 %, ν)` against LibreOffice's `TINV`, largest relative difference by range of ν, and the printed k (two decimals) the same at all 11 511 points in both versions:

| ν          | 0.4.0   | 0.5.0   |
| ---------- | ------- | ------- |
| 1 to 1e4   | 4.1e-12 | 4.6e-13 |
| 1e4 to 1e7 | 4.0e-9  | 4.9e-10 |
| above 1e7  | 1.25e-7 | 1.25e-7 |

## What stays as it was

- **The normal distribution above ν = 1e7.** The quantiles differ by `(z² + 1)/(4ν)` relative, 1.25e-7 at k = 2 just past the switch, so there is a step of that size at 1e7. Evaluating t directly above it was tried and is not an option with this continued fraction: in `x = ν/(ν + t²)` it loses about ν·1e-17 near x = 1 (4e-7 at ν = 1e10, 9e-2 at 1e16). A Cornish–Fisher expansion (Abramowitz and Stegun 26.7.5) from about ν = 1e5 would close the step and the 1e-9 below it; it is a new approximation with its own validation and was left for a later version. Dossier, limitation 3.
- **The numerical derivative's step**, `1e-6 · max(|x|, 1)`. After item 8 it is reached only when the variable is inside a function with no symbolic derivative or when the symbolic derivative is not finite at the estimate, always with `SENSITIVITY_NUMERICAL_FALLBACK`. A purely relative step is not better in general (it trades truncation for cancellation when the output is large next to its variation). Dossier, limitation 10.

## Tests

- math-engine 427 (12 files): `gum/statistics.spec.ts` (193: reference tables from `scripts/statistics-reference.py`, closed forms for ν = 1 and ν = 2, the corrections of items 1 to 6 and 9), `numeric/decimal-rounding.spec.ts` (20 000 literals against `Number(text)`, 10 000 rationals and roots against their two neighbouring doubles in integer fractions), `formula/derivative.spec.ts`, `audit/canonical-json.spec.ts`; the existing KAT, EA-4/02, audit and gate suites unchanged and passing.
- method-definition 194, method-templates 135 (example lab method fingerprint fixture bumped: `method:7deeb2cb… → method:5b1f62cc…`, it embeds the engine version), apps/api 1205 (KAT pin 0.5.0), apps/local-server 202, apps/web 1270.

## Operator steps (production)

Same as for 0.4.0:

1. Deploy API, worker and web together (the engine is a workspace package).
2. Recompile and re-approve every published method: until then `ENGINE_VERSION_MISMATCH` blocks execution of 0.4.0 snapshots. Open jobs pick the recompiled method up on their next save or submit when the method definition itself did not change. Issued certificates are untouched; their snapshots stay reproducible with 0.4.0.
3. Build the dossier (`make` in `validation/math-engine/v0.5.0`; the PDF is not versioned).
4. Release a desktop build so offline execution runs the same engine.

## References

- Abramowitz, M., Stegun, I. A., _Handbook of Mathematical Functions_: 6.1.40 (Stirling's series), 7.1.6 and 7.1.14 (erf, erfc), 26.7.5 (t quantile for large ν, not implemented).
- Acklam, P. J., rational approximation of the normal quantile, with the refinement step by Halley's method.
- Lentz, W. J. (1976); Thompson, I. J., Barnett, A. R. (1986): modified continued-fraction evaluation.
