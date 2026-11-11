# Math-engine 0.6.0 — release note

Successor to 0.5.0 (dossier CF-VAL-MATH-ENGINE-0.5.0 rev. 1.0). Validation dossier: `validation/math-engine/v0.6.0/` (rev. 1.0).

## Why a new version

The review of 2026-11-11 came in two batches. The first, ten defects with a wrong result, is 0.5.0. This is the second: what 0.5.0 left declared as a limitation or an inconsistency. **No value of the five golden models changes against 0.5.0**; what changes is the t quantile for ν above 1e5, the numerical fallback of the sensitivities, which formulas and inputs are accepted, and every fingerprint (the version and two default limits are part of the digest).

## What changed

Each item has a regression test that fails on 0.5.0 (`audit/math-engine-review-0.6.0.spec.ts`, and the group _0.6.0: large ν_ of `gum/statistics.spec.ts`).

1. **Student's t for large ν, without a step.** Up to 0.5.0 the normal distribution replaced t above ν = 1e7: the quantile jumped by 1.25e-7 there, and just below it the continued fraction lost up to 1.4e-10. Above ν = 1e5 the distribution function is now `Φ(z)`, with z from the Cornish–Fisher expansion of the t quantile (Abramowitz and Stegun 26.7.5) reverted to 1/ν⁴; the quantile is its inverse, by the same bisection as for every other ν. Measured against mpmath: 1.8e-12 up to 1e5, 5e-15 above, for p between 1e-15 and 1 − 1e-15.
2. **The numerical derivative's step.** The fallback step was `1e-6 · max(|x|, 1)`, absolute below 1: at x = 1e-6 the stencil reached x = 0. In the measurement model the stencil now spans the estimate ± its standard uncertainty (step `u(x)/2`), the interval the linearization has to hold over (JCGM 100:2008, 5.1.3, note 2). The step is never below `numericalDerivativeRelativeStep · |x|`: a difference taken over x ± u with u/|x| = 1e-13 has about three digits left in a double (measured on `student_t_inverse_2t(α, 10)` at α = 0.05: the coefficient 0.1 % off at u/|x| = 2e-12, 8 % at 2e-14, the wrong sign at 2e-15). The diagnostic carries `stepBasis` (`standardUncertainty`, `relativeFloor` or `relative`) and `step`. The relative difference between step and half step, which feeds `LINEARIZATION_NUMERICAL_INSTABILITY`, lost its floor of 1 and is relative to the sensitivity itself. `numericalDerivative` called directly keeps the old step unless `step` is given.
3. **Declared relationships in the canonical input.** Correlations and covariances went into the fingerprint as the text received: `"0.5"`, `"0.50"` and `5e-1`, or one pair given as a list and as both halves of a matrix, were four fingerprints for one model. The pairs the calculation used go in now, once each, with the value in canonical number text; the diagonal is left out, and `COVARIANCE_TERMS_INCLUDED` counts pairs.
4. **Formula limits.** `maxAstDepth` is the depth of the tree, and a sum of n terms is n deep: with the default of 64 a sum of 65 terms was refused with 129 of its 512 nodes. The default is 256 (a plain sum now ends at the node limit) and the largest value accepted goes from 10 000 to 500: the parser, the validator and the evaluator recurse, and the stack overflowed with a raw `RangeError` from about 1 500 levels. A signed literal exponent (`x^-13`) is checked at compile time like an unsigned one. `mergeFormulaLimits` dropped `maxSignificantDigits`, so `parseFormula` alone accepted what `compileFormula` refused.
5. **Options.** `evaluateFormula` takes the compile options and the evaluation options for a string and for a compiled formula (one kind each before: `rejectUnusedInputs` was refused for a string). An option given as `undefined` is an option not given, everywhere. `maxNumericInputLength` defaults to 512 in the engine as in the Type A and Type B helpers; at 128 a signed or fractional input could not use the 128 significant digits allowed.
6. **Numeric inputs.** A JavaScript number is read in plain positional notation, like the same value written out: 1.5e-13 was refused as a number and accepted as `"0.00000000000015"`. In number mode a non-zero input that a double reads as 0 is refused (`UNSAFE_NUMERIC_RANGE`), like one that overflows. `0 ^ -n` is `ERR_DIVISION_BY_ZERO` in both modes.
7. **Exact exponent in the power rule.** The derivative of `x^1.1` carried the exponent 0.10000000000000009 (1.1 − 1 in double); it is subtracted on the literal's exact decimal value.
8. **Repeated work.** Canonical JSON is written in one pass (it was quadratic in depth: 350 ms to normalize a sum of 3 000 terms). Every evaluation of a compiled formula normalized and hashed its AST again to compare it with itself, about half the time of an evaluation; the instance and the AST are frozen in the constructor, and only the check that the instance was built by the engine stays.
9. **Unused code.** `createNumericBackend`, `canonicalClone`, the `NumericOptions` type and the barrels `evaluator/index.ts` and `engine/index.ts` are gone: nothing imported them. The list of reserved keys existed twice and has one copy.
10. **The engine ↔ dossier gate** (outside the pinned source). Only a directory named exactly `v<major>.<minor>.<patch>` is a released dossier: a suffixed one (`-rc1`, `.bak`) competed with the release of the same number, in whatever order the file system listed them. The digest of each file is taken on its bytes, not on the decoded text; for valid UTF-8 it is the same digest (17 of the 37 files did not change between the two versions and keep theirs).

`ENGINE_VERSION = "0.6.0"`, package version 0.6.0, new dossier directory, reference fingerprint `sha256:bb09d457…be3a7`.

## Delta against 0.5.0

The five golden models: value, `u_c`, `ν_eff`, `k`, `U` and sensitivities identical to the last digit. Only the fingerprints change.

Largest relative error of the t quantile against mpmath (p between 1e-15 and 1 − 1e-15, away from the median):

| ν          | 0.5.0            | 0.6.0   |
| ---------- | ---------------- | ------- |
| up to 1e5  | 1.8e-12          | 1.8e-12 |
| 1e5 to 1e7 | 1.4e-10          | 5e-15   |
| above 1e7  | 1.25e-7 at k = 2 | 5e-15   |

Beyond that range (|t| from 8 to 40) the series error grows as 0.05·(t²/ν)⁵, to 5e-11 at ν = 1e5.

## What a caller can notice

- An option object with `maxAstDepth` above 500 is refused.
- `numericalDerivativeRelativeStep` sets the step only for a quantity with no uncertainty, or with a standard uncertainty below twice that fraction of its estimate.
- A model that reached the numerical fallback gets a different sensitivity (and the same warning).
- `x^-13` with the default exponent limit fails at compile time instead of at evaluation.
- Number inputs below 1e-6 or from 1e21 on are accepted where they were refused by the exponent limit (and refused by length where they are longer than `maxNumericInputLength`).
- TypeScript only: `NumericOptions` is no longer exported.

## Left as it is

- **The exponent limit is a limit on exponent notation** (`1e-13` is refused, `0.0000000000001` is not). Turning it into a limit on magnitude would refuse inputs that are accepted today. Documented in the README and as limitation 11 of the dossier.
- **Error codes of a power outside its domain**: `(-8)^0.5` is `NON_FINITE_RESULT` and `sqrt(-1)` is `DOMAIN_ERROR`. Callers match on these codes.
- **Limits the decimal backend cannot honour**: `maxSignificantDigits` and `maxNumericInputLength` accept up to 10 000, the exact type holds about 4 900 digits. The failure is a structured error (`ERR_RESULT_MAGNITUDE_EXCEEDED`).
- **Exact arithmetic at the size cap**: the gcd of two 16 000-bit integers takes 40 ms. Reaching it takes operands a formula within the default limits does not produce.
- **`src/testing/index.ts`** is not exported from the package and nothing imports it, but the source pin's algorithm names the directory; removing it is a change to the gate's contract.

## Tests

- math-engine 494 (13 files). New: `audit/math-engine-review-0.6.0.spec.ts` (18), the large-ν group and reference rows up to ν = 1e15 in `gum/statistics.spec.ts` (generated by `scripts/statistics-reference.py`).
- method-definition 194, method-templates 135 (example lab method fingerprint fixture bumped: `method:5b1f62cc… → method:fce372b2…`), apps/api 1205 (KAT pin 0.6.0), apps/local-server 202, apps/web 1270.

## Operator steps (production)

As for 0.5.0. If 0.5.0 was never deployed, this is one step from 0.4.0: deploy API, worker and web together, recompile and re-approve every published method (`ENGINE_VERSION_MISMATCH` blocks older snapshots until then), build the dossier, release a desktop build.

## References

- Abramowitz, M., Stegun, I. A., _Handbook of Mathematical Functions_, 26.7.5 (Cornish–Fisher expansion of the t quantile).
- JCGM 100:2008 (GUM), 5.1.3, note 2 (numerical evaluation of `c_i u(x_i)` over ± u(x_i)).
