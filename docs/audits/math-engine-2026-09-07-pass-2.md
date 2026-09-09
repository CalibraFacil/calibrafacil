# Math-engine audit — second pass, 2026-09-07

Audited commit `a2229bfc` on `fix/math-engine-audit`, including the three fixes in PR #902. These are additional findings. Engine source and the PR were not changed during this pass.

The existing 73 tests and package TypeScript check pass. Public-API numerical probes ran with Bun; the parser probe additionally ran through Vitest on Node v22.21.1. Temporary parser probe files were removed. This is a targeted audit, not full metrological validation.

## 1. P1 — Decimal estimates lose precision before sensitivity calculation

Locations: `packages/math-engine/src/gum/measurement.ts:1565`, `packages/math-engine/src/numeric/validation.ts:107`.

```ts
const engine = createCalculationEngine();
engine.evaluateMeasurementModel({
  formula: "(x-9007199254740992)^2",
  quantities: {
    x: { estimate: "9007199254740993", standardUncertainty: 0.01 },
  },
});
```

Observed: nominal value `1`, sensitivity `0`, combined uncertainty `0`, expanded uncertainty `0`. The exact derivative is `2`, giving first-order combined uncertainty `0.02`. Only an informational symbolic-sensitivity diagnostic appears.

The nominal calculation preserves decimal input, but the derivative is evaluated with NumberBackend. Converting the estimate rounds it down to 9007199254740992. The supposed safe-double guard checks finiteness and magnitude above 1e100; it does not detect this loss. Both the literal and input pass the default limits.

Related confirmed path: `typeAFromRepeatedObservations(["1.00000000000000001", "1.00000000000000002", "1.00000000000000003"])` returns observations `[1,1,1]` and uncertainty `0`; the specified decimal samples have sample standard deviation 1e-17 and standard uncertainty 1e-17/√3. This conversion happens in `uncertainty/type-a.ts` through NumberBackend too.

Remediation: preserve decimal arithmetic through symbolic evaluation and centered observation statistics where possible. Detect unsupported precision loss before automatic double operations and require an explicit alternative instead of silently claiming zero uncertainty.

## 2. P2 — Distinct results share a calculation fingerprint

Locations: `packages/math-engine/src/numeric/backend.ts:110`, `packages/math-engine/src/formula/compiled.ts:462`.

```ts
const formula = createCalculationEngine({
  numericMode: "number",
}).compileFormula("x");
const a = formula.evaluate({ x: 0.3 });
const b = formula.evaluate({ x: 0.1 + 0.2 });
```

Observed: `a.value === 0.3`, `b.value === 0.30000000000000004`, but both have `valueText === "0.3"` and the same calculation fingerprint (`sha256:f4aa0443674d72fe3e54a7c5f8f8ad3f55a5f91289b87138103c6e9ff7aae97e`).

`canonicalJson` correctly preserves numbers, but these callers stringify the inputs and result first using the display-precision formatter. Their differing identities have already been lost before hashing. This contradicts the README's distinct-double audit guarantee and prevents the digest from distinguishing these calculations. Lower configured precision widens the collision interval.

Remediation: use shortest round-trip serialization for audit inputs/results; keep display rounding separate. The existing `canonicalRoundTripNumber` helper supplies the required primitive.

## 3. P2 — Welch–Satterthwaite underflow changes finite DOF to Infinity

Location: `packages/math-engine/src/gum/statistics.ts:319`.

```ts
welchSatterthwaiteDegreesOfFreedom(1e-180, [1e-180], [2]);
// Observed: Infinity. Expected: 2.
```

The single-contribution identity must be independent of the scale of its variance. Squaring 1e-180 underflows the denominator to zero, which is interpreted as infinite DOF.

Full-model reproduction with default options: formula `x`, estimate `1`, standardUncertainty `"0." + "0".repeat(89) + "1"`, degreesOfFreedom `2`. The accepted fixed-decimal input represents 1e-90. The model returns finite combined uncertainty 1e-90, but effective DOF `Infinity` and k≈1.959964 instead of DOF 2 and k≈4.302653. Expanded uncertainty is understated by approximately 54%. This affects extreme scales; the normal-range known-answer tests pass.

Remediation: normalize variance contributions before squaring, or reject unsupported ranges explicitly. Do not interpret arithmetic underflow as infinite information.

## 4. P2 — Exact nonzero decimal results serialize as zero

Location: `packages/math-engine/src/numeric/decimal.ts:401`.

```ts
const engine = createCalculationEngine();
engine.compileFormula("((1e-12)^12)^3").evaluate({}).value;
// Observed: "0". Exact result: 1e-432.
engine.compileFormula("(((1e-12)^12)^3)/(((1e-12)^12)^3)").evaluate({}).value;
// Observed: "1" — the intermediate rational was nonzero.
```

Both formulas use default options. The rational arithmetic retains the result and stays inside the BigInt magnitude guard. Serialization falls back to a double when an exact finite decimal has more than 120 fractional places. That double underflows to zero, which passes the finite-result check. A persisted intermediate therefore differs from the value used inside a larger expression.

Remediation: emit scientific decimal text directly from the rational at the chosen precision, without an intermediate double, or return a structured range error for an unrepresentable nonzero result.

## 5. P2 — Recursive parser paths bypass the pre-parse depth guard in Node

Locations: `packages/math-engine/src/parser/parser.ts:72`, `:82`, `:153`.

```ts
const engine = createCalculationEngine({
  maxExpressionLength: 100000,
  maxAstDepth: 64,
});
engine.compileFormula("sin(".repeat(4000) + "1" + ")".repeat(4000));
engine.compileFormula("-".repeat(20000) + "1");
engine.compileFormula("1^".repeat(10000) + "1");
```

All three throw raw `RangeError: Maximum call stack size exceeded` in Node v22.21.1, before AST validation can return `ERR_AST_TOO_DEEP`. Bun returns the structured AST-depth error for these same examples. Only parenthesized expressions increment the parser's recursion counter; calls, unary operators, and powers recurse without that guard.

This requires raising `maxExpressionLength` beyond its default 2000; no current non-engine caller configuring that option was found. A raw RangeError is confirmed, not a demonstrated process crash or production exploit.

Remediation: bound every recursive descent path before recursing, or use an iterative parser. Add Node and Bun checks that enforce structured errors at the configured depth.

## Remediation

Fixes were applied on the same branch (PR #902) under the design constraint the first pass set: **the engine version, the dossier manifest and every result the 0.3.0 engine already produced correctly stay byte-identical.** Each fix therefore changes behavior only on the inputs the finding showed to be mishandled; adopting the exact paths for all inputs would alter canonical texts and fingerprints in the normal range (verified: exact-rational rounding turns `-2/3` from `-0.6666666666666666` into `-0.6666666666666667`, and exact derivatives change sensitivities on 4/4 realistic decimal-mode models, e.g. `-0.02991105009893625` vs `-0.02991105009894972`) and is deferred to the next validated engine version.

1. **Decimal estimates beyond double precision** — `validateNumericString` now compares the sign/digits/exponent identity of the text against `Number(text).toString()` whenever a double is required (`requireNumberSafeForDouble`); a lossy estimate reaching numerical differentiation fails with `UNSAFE_NUMERIC_RANGE` and asks for explicit sensitivities. For symbolic derivatives in decimal mode, an estimate that does not round-trip is evaluated with `DecimalBackend` (like the nominal value), so `(x-9007199254740992)^2` at `x = "9007199254740993"` now yields sensitivity `2` and `u_c = 0.02`. Round-trippable estimates keep the double path. `typeAFromRepeatedObservations` likewise centres and squares exactly only when an observation carries more precision than a double (`["1.00000000000000001", …]` → `s = 1e-17`, identical lossy observations → `0`); round-trippable observation sets keep the 0.3.0 double statistics.
2. **Fingerprint collisions (number mode)** — audit inputs and the audit copy of the result in `CompiledFormula.evaluate` and `canonicalizeEstimate` use `canonicalRoundTripNumber` in number mode; `valueText` and result fields keep display precision. Decimal mode is unchanged.
3. **Welch–Satterthwaite underflow** — contributions and the combined variance are normalized by the largest variance before squaring; the identity is scale invariant, so `welchSatterthwaiteDegreesOfFreedom(1e-180, [1e-180], [2])` returns `2` and the `u = 1e-90`, `ν = 2` model reports `ν_eff = 2`, `k ≈ 4.3027`. A combined variance more than ~1e154 below its largest contribution is rejected as `INVALID_STATISTIC_INPUT` instead of being read as infinite information.
4. **Sub-double serialization** — `toCanonicalString` rounds the rational itself (`rationalToPrecisionString`, exact half-up at the configured precision) only when the double is zero, subnormal or non-finite; `((1e-12)^12)^3` serializes as `1e-432`. Values in the normal double range keep the established `toPrecision` text.
5. **Parser recursion** — every recursive-descent path (parenthesized expression, call arguments, unary operators, `^` right operand) goes through one `parseNested` guard that counts depth and returns `ERR_AST_TOO_DEEP`; the three examples above throw the structured error under Node (Vitest) and Bun.

Validation: math-engine 95 tests (73 existing + 22 new in `src/audit/math-engine-pass-2.spec.ts`, including byte-stability checks for round-trippable inputs), TypeScript check, method-definition 156, method-templates 129, API math-engine KAT + sync 31, web method-runtime/jobs 51 — all passing. Direct oxlint of the changed sources: 46 pre-existing diagnostics, identical to baseline; the new spec passes lint. A side-by-side probe of five realistic decimal-mode models (mass, electrical, volume, geometric, repeatability) against the pre-fix `measurement.ts` reproduced identical calculation fingerprints (0/5 changed).

### Review follow-ups (Codex, commit 9027cc9e)

- **Cholesky pivots** (pass-1 code): any positive pivot is now factored; only an exactly collapsed pivot (`sum <= 0`) applies the residual test. A positive-definite block such as `r(b,c) = 1 - 5e-15`, `r(c,d) = 5e-8` (det ≈ 7.49e-15) is accepted; inconsistent residuals next to singular or nearly singular pivots still fail with `INVALID_COVARIANCE_MATRIX` via the later negative diagonal.
- **Domain checks**: `assertSmoothDomains` evaluates `sqrt`/`log`/`asin`/`acos`/`tan` arguments and the `if_zero` discriminator with the mode's backend (`DecimalBackend` in decimal mode) and applies the range test to that value, so a lossy source estimate is no longer rejected for a domain probe and the discriminator follows the branch the nominal evaluation takes (`sqrt(x-9007199254740992)`, `x = "9007199254740993"` → `1`, sensitivity `0.5`; `log(...)` → `0`).
- **Welch–Satterthwaite scale**: accumulated in a loop instead of spreading into `Math.max` (200 000 contributions verified; no argument-count ceiling).
- **Type A samples**: `TypeAUncertaintyResult.canonicalObservations` carries the canonical decimal text of each observation as parsed, so exact statistics can be reproduced from the returned samples; `observations` stays the double view.

Fingerprint probe vs the pre-fix `measurement.ts` re-run with a correlated model added: 0/5 changed. Math-engine 101 tests.

### Review follow-ups, second round (Codex, commit 5db71f00)

- **Canonical observations beyond 120 places**: `canonicalObservations` used `toCanonicalString`, which stops expanding a terminating rational past 120 fractional places and rounds through a double — so `1.${"0".repeat(120)}1/2/3` (within the 128-significant-digit input limit) collapsed to `["1","1","1"]` while the exact branch reported `s = 1e-121`. `DeterministicDecimal.toExactString()` added: the exact terminating expansion with no cutoff (a parsed input always terminates; a non-terminating rational — only reachable from arithmetic — is a structured `UNSAFE_NUMERIC_RANGE`, never rounded). `canonicalObservations` now uses it. Canonical texts and fingerprints are untouched.
- **Welch–Satterthwaite overflow**: the scale-normalized loop dropped the per-term/accumulated finiteness checks the previous implementation had, so a finite but tiny positive `dof` (`Number.MIN_VALUE`) made the denominator `Infinity` and the function returned `0`. Both checks restored (`INVALID_STATISTIC_INPUT`); tests cover a single overflowing term and two finite terms whose sum overflows.

### Byte-stability violation found by the re-run probe (fix 3, Welch–Satterthwaite)

Re-running the side-by-side probe against `origin/main` with a **mass model carrying two Type A contributions (ν = 4 each) next to three Type B ones** showed a changed fingerprint: `effectiveDegreesOfFreedom` `56.88888897960644` (0.3.0) vs `56.88888897960645` (branch). Dividing each contribution by the scale _before_ squaring rounds one ulp differently from squaring directly, and the ulp propagates into `k`, `U` and the calculation fingerprint. The earlier 0/5 probe had no model with more than one finite-dof contribution, so it could not see this. This broke the rule the PR is built on.

Fix: `welchSatterthwaiteDegreesOfFreedom` now runs the 0.3.0 arithmetic first (`Σ c²/ν` and `u_c⁴`, same operation order) and returns it whenever every square is a _normal_ double and every partial sum is finite. The scale-normalized form engages only when a square underflows to zero/subnormal (the audit finding: read as infinite information at 0.3.0) or overflows. Subnormal squares (`u` between ≈1.5e-154 and ≈1e-162) are deliberately routed to the exact form: 0.3.0 computed them with degraded precision. Test: _keeps the 0.3.0 Welch-Satterthwaite arithmetic bit-for-bit in the normal range_ (fails on the un-gated code).

Probe after the fix, 8 models (mass, electrical, volume, geometric, repeatability, correlated, mixed-dof with four distinct finite ν, and the electrical model in `number` mode): **0/7 decimal-mode fingerprints changed**; the `number`-mode fingerprint changed with identical `U`, `k`, `ν_eff` — that is fix 2 (round-trip audit text) and remains the single documented exception.

Math-engine 123 tests (incl. the new `src/gum/reference-evidence.spec.ts`, see below); dependents green (method-definition 156, method-templates 129, api 93).

### Review follow-ups, third round (Codex, commit 4e3442bd)

- **Exact Type A mean lost before model evaluation (P1)**: the exact branch computed the mean as a rational and then narrowed it to a double to serve as the quantity estimate. Observations `"9007199254740993"` and `"9007199254740997"` have exact mean `9007199254740995`, which becomes `…996`, so the decimal model `(x-9007199254740992)^2` reported `16` with sensitivity `8` instead of `9` with sensitivity `6`. `TypeAUncertaintyResult.canonicalMean` now carries the exact decimal text of the mean — present **only** when the exact branch runs and the text both terminates and fits the configured input limits — and `resolveQuantity` prefers it over `mean` when deriving an estimate from observations. The established double path never sets it, so its 0.3.0 mean arithmetic is untouched.
- **Lossy literals bypassed the decimal derivative gate (P1)**: the gate inspected quantity estimates only, so `(x-9007199254740993)^2` at `x = "9007199254740994"` (an estimate a double carries exactly, a literal it does not) had its literal rounded to `…992` during symbolic differentiation and reported sensitivity `4` instead of `2`, doubling the propagated uncertainty. The gate now also walks the derivative AST for `NumberLiteral` nodes that do not round-trip.
- **`toCanonicalString` threw above the double range (P2)**: the fallback for rationals a double cannot carry was unreachable, because the function narrowed through `toNumber()` — which asserts finiteness — before choosing it. `DeterministicDecimal.of(10n ** 432n, 3n).toCanonicalString()` threw `NON_FINITE_RESULT` instead of returning `3.333333333333333e431`. The narrowing helper (`ratioToDouble`) is now separate from the asserting `toNumber`, so the exact-rational branch is reached; `toNumber` keeps its exact previous arithmetic and error.
- **Type A square root taken after narrowing (P2)**: at small configured scales the variance narrows to zero while the standard deviation is an ordinary double — with `maxExponentMagnitude: 200`, observations `"1.00000000000000001e-200"` and `"2.00000000000000001e-200"` have variance ≈`5e-401` (→ `0`) and `s ≈ 7.071e-201`. `DeterministicDecimal.sqrtToNumber()` added: it runs the plain narrow-then-`Math.sqrt` arithmetic first and returns it whenever the narrowed value is a normal double, and only scales the rational by an even power of ten when that arithmetic is unreliable. Values the exact branch already produced are unchanged.
- **Welch–Satterthwaite term underflowing on division (P2)**: distinct from the overflow case closed in the previous round. A normal square divided by a very large finite dof can underflow the term to zero, which the plain path added as `0` and read as infinite information — `welchSatterthwaiteDegreesOfFreedom(1e-150, [1e-150], [1e24])` returned `Infinity` instead of `1e24`. The plain path now also requires the quotient to be a normal double before it is trusted; otherwise the scale-normalized form engages, as it already did for out-of-range squares.

Byte-stability probe re-run for this round: every registered platform template (mass balance, weighing instrument, electrical indication, force indication, frequency indication, volume glassware, humidity Magnus) compiled with `METHOD_ENGINE_OPTIONS` and executed over each of its declared preview scenarios, dumped as JSON and diffed against the same run on `origin/main` — **byte-identical**, including every method fingerprint, ν_eff, k and U. Math-engine 129 tests, TypeScript check clean; method-definition 156, method-templates 129, API math-engine KAT 8 — all passing.

### Dossier revision 1.1

`validation/math-engine/v0.3.0/dossier.tex` was rewritten as revision 1.1 to register the audit remediation under the same package version (byte-stability rule stated as the revalidation principle, all 13 findings tabulated with their regression tests, layer 3 + engine↔dossier gate documented). Two claims of revision 1.0 were found to be wrong and corrected: ν_eff is **not** truncated to the lower integer (it is carried as a real number and `k` is evaluated at that value), and the normal approximation of the t quantile applies for ν > 10⁷, not ν ≥ 500. Revision 1.0 also cited `tests/reference-evidence.test.mjs`, which never existed in this monorepo (it lived in the pre-internalization external repo); the additive reference case and the t-table are now reproduced by `packages/math-engine/src/gum/reference-evidence.spec.ts`, and the additive case declares the Type B degrees of freedom (ν_B1 = 24, ν_B2 = ∞) that revision 1.0 left implicit.

## Reference

The sensitivity and effective-DOF expectations follow [JCGM 100:2008](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf), sections 5.1.3 and G.4. The numerical expectations above also follow directly from differentiation, sample variance, and the single-contribution Welch–Satterthwaite identity.
