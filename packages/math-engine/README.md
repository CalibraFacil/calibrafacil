# @calibra-facil/math-engine

Secure, dependency-light, ESM-first TypeScript calculation engine for calibration formulas and GUM-aligned uncertainty propagation.

**Status for this implementation:** Em produção no Calibra Fácil / In production use.

This package is the calculation core only — not a UI, report renderer, certificate generator, accreditation claim, legal-compliance claim, or substitute for laboratory method validation. It implements the GUM (JCGM 100:2008) methodology and is audit-friendly; regulated use relies on the validation evidence maintained per engine version (a fresh validation pass is expected on each `ENGINE_VERSION` bump).

## Build and test

```bash
npm install
npm run build
npm run typecheck
npm test
npm run coverage
npm audit --omit=dev
npm pack --dry-run
```

The package is ESM-first and exports `./dist/index.js` with generated `.d.ts` declarations. The npm package is expected to contain `dist`, selected `docs`, selected `examples`, `README.md`, and `CHANGELOG.md`; `src`, `tests`, temporary files, and validation workpapers are not part of the published package.

## Basic formula evaluation

```ts
import { createCalculationEngine } from "@calibra-facil/math-engine";

const engine = createCalculationEngine({
  numericMode: "decimal",
  angleMode: "radian",
  maxExpressionLength: 2000,
  maxAstDepth: 64,
  maxAstNodes: 512,
  maxExponentMagnitude: 12,
  maxNumericInputLength: 128,
  maxSignificantDigits: 128,
});

const formula = engine.compileFormula(
  "((pontos_indicacao_antes_leitura_1 + pontos_indicacao_antes_leitura_2 + pontos_indicacao_antes_leitura_3) / 3)",
);

const result = formula.evaluate({
  pontos_indicacao_antes_leitura_1: 10.01,
  pontos_indicacao_antes_leitura_2: 10.03,
  pontos_indicacao_antes_leitura_3: 10.02,
});

console.log(result.value); // "10.02" in decimal mode
console.log(result.calculationFingerprint);
```

A `CompiledFormula` carries compatibility metadata, including the engine version, numeric mode, decimal precision, numeric/formula limits, canonical AST fingerprint, and options fingerprint. Passing a compiled formula to an engine with incompatible options fails with `INCOMPATIBLE_COMPILED_FORMULA`. Compile formulas with the same engine/options that will evaluate them, or pass formula text and let the target engine compile it. Compiled formula instances and their ASTs are frozen at runtime; evaluation also checks that the AST fingerprint still matches the stored audit metadata before executing. Engine boundaries only accept exact compiled-formula instances returned by this package; subclasses are rejected. `CompiledFormula` is exported from the root package as a TypeScript type, not as a runtime constructor. Formula and measurement-model result objects are frozen after calculation; measurement metadata and diagnostic details returned by measurement models are recursively frozen. Persist `canonicalResultJson` and fingerprints as the audit evidence.

## GUM-style measurement model

```ts
const uncertaintyResult = engine.evaluateMeasurementModel({
  formula: "((x1 + x2 + x3) / 3) + correction",
  quantities: {
    x1: { estimate: 10.01, standardUncertainty: 0.01, degreesOfFreedom: 9 },
    x2: { estimate: 10.03, standardUncertainty: 0.01, degreesOfFreedom: 9 },
    x3: { estimate: 10.02, standardUncertainty: 0.01, degreesOfFreedom: 9 },
    correction: {
      estimate: -0.005,
      standardUncertainty: 0.002,
      degreesOfFreedom: "Infinity",
      distribution: "normal",
      certificateId: "CERT-REF-2026-001",
    },
  },
  coverageProbability: 0.95,
});

console.log(uncertaintyResult.value);
console.log(uncertaintyResult.combinedStandardUncertainty);
console.log(uncertaintyResult.expandedUncertainty);
console.log(uncertaintyResult.uncertaintyBudget);
```

## Supported formula syntax

Allowed syntax is intentionally small: numeric literals, ASCII identifiers matching `[A-Za-z_][A-Za-z0-9_]*`, parentheses, unary `+` and `-`, binary `+`, `-`, `*`, `/`, `^`, and the functions `sqrt`, `abs`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `log`, `log10`, `exp`, `min`, `max`, `floor`, `ceil`, and `round`.

Trigonometric functions use radians only. There is no implicit degree mode.

Operator precedence follows conventional mathematical notation for exponentiation and unary minus: `-2^2` is interpreted as `-(2^2)` and returns `-4`; `(-2)^2` returns `4`; `2^-2` returns `0.25`.

Rejected syntax includes assignment, property access, object access, index access, matrices, imports, user-defined functions, callbacks, loops, recursion, random values, dates, locale-sensitive parsing, and anything outside the whitelist grammar.

## Security and runtime validation model

User formulas are data, not code. The engine uses a custom tokenizer, recursive-descent parser, AST validator, and evaluator. It does not use `eval`, `new Function`, `vm`, dynamic imports, or runtime code generation. Identifier names such as `__proto__`, `prototype`, `constructor`, `import`, `require`, `process`, and `globalThis` are rejected.

All external numeric values are validated before decimal expansion, including formula literals, formula inputs, quantity estimates, uncertainties, degrees of freedom, coverage factors, correlations, and covariances. The engine rejects `NaN`, `Infinity`, `-Infinity` except the explicit DOF sentinel, blank strings, malformed exponent strings, oversized strings, excessive significant digits, and exponents outside configured limits.

Public APIs validate malformed JavaScript inputs before property access and throw `CalculationEngineError` with stable codes rather than raw `TypeError`. Formula compile/evaluation options and the measurement-model root object use explicit allow-lists, so typos such as `coverageProbablity`, `correlation`, `rejectUnusedInput`, or unsupported fields fail instead of being ignored. Metadata is flat and limited to string, finite number, boolean, or null. Dangerous keys such as `__proto__`, `prototype`, `constructor`, `toString`, and `valueOf` are rejected.

## Numeric and determinism model

`numericMode: "decimal"` uses an internal deterministic decimal/rational representation for decimal literals and core arithmetic. Addition, subtraction, multiplication, division, and integer powers are represented exactly where practical. In measurement models, nominal decimal estimates are preserved for evaluation and audit output.

Transcendental functions, Student's t coverage-factor calculations, and numerical differentiation use JavaScript `Math` / IEEE-754 double precision. Numerical sensitivity fallback emits a diagnostic. If nominal values needed for differentiation are outside the safe double-precision range, the engine rejects the model and requires explicit sensitivity coefficients.

**Determinism scope.** Exact decimal arithmetic (`+ − × ÷` and integer powers) is bit-for-bit reproducible across runtimes. Transcendental functions and the Student's t quantile go through `Math.*`, which ECMA-262 leaves implementation-approximated (only `Math.sqrt` is correctly-rounded), so their last ULP — and therefore the canonical output string and fingerprint of a formula that uses them — may differ between JavaScript engines (e.g. V8 vs JavaScriptCore). Results are deterministic _per runtime_; recomputation across heterogeneous runtimes can differ in the last digit for transcendental-bearing formulas. The exponent limit (`maxExponentMagnitude`) applies to user-supplied literals and inputs only — engine-computed values (transcendental results, GUM outputs) are not constrained by it.

`numericMode: "number"` uses native IEEE-754 binary64 numbers and returns numbers. `numericMode: "decimal"` returns canonical decimal strings. Rounding for display is separate from internal calculation; the core does not silently round user inputs.

## GUM propagation model

The engine evaluates `Y = f(X1, X2, ..., Xn)`, computes sensitivity coefficients symbolically where practical, combines uncertainty using `uc² = ΣΣ ci cj u(xi,xj)`, supports covariance/correlation terms, computes Welch-Satterthwaite effective degrees of freedom, and computes expanded uncertainty `U = k * uc`.

For GUM propagation, non-smooth functions such as `abs`, `floor`, `ceil`, `round`, `min`, `max`, and `if_zero` are rejected by default. They are allowed only when every formula variable has an explicit `sensitivityCoefficient` and the caller sets `allowNonSmoothWithExplicitSensitivities: true`.

Repeated observations cannot be combined with `standardUncertainty` or Type B source fields on the same quantity. Model repeatability and other uncertainty sources as separate quantities so each contributes to the budget with its own degrees of freedom.

Type B distributions are validated at runtime. Supported values are `normal`, `rectangular`, `uniform`, `triangular`, `u-shaped`, `arcsine`, and `custom`. Ambiguous configurations are rejected: for example, `normal + halfWidth` and `custom + halfWidth` without an explicit divisor fail with structured errors.

Units are metadata labels only. The package does not implement dimensional algebra or unit compatibility checks.

## Auditability

Formula results and measurement-model results include normalized formula text, normalized AST, formula fingerprint, calculation fingerprint, diagnostics, and canonical result JSON. Fingerprints use SHA-256 (via `@noble/hashes`, a synchronous pure-JavaScript implementation that runs identically in Node, Bun, the browser, and the container worker) over canonical JSON, prefixed `sha256:` / `ast-sha256:`. Canonical JSON serializes numbers in their shortest round-tripping form, so distinct double values never collapse to the same fingerprint. The digest gives preimage and collision resistance suitable as audit integrity evidence; it is still traceability metadata, not a signed attestation of authorship.

## Documentation

- `docs/formula-syntax.md`
- `docs/security-model.md`
- `docs/determinism-and-numeric-model.md`
- `docs/gum-uncertainty.md`
- `docs/runtime-compatibility.md`
- `docs/validation-recommendations.md`
- `docs/validation/VALIDATION-PLAN.md`
- `docs/validation/VALIDATION-TRACEABILITY.md`
- `docs/validation/VALIDATION-RESULTS-DRAFT.md`
- `docs/adr/0001-mathjs-decision.md`

## Examples

- `examples/average-readings.ts`
- `examples/indication-error.ts`
- `examples/thermal-expansion.ts`
- `examples/combined-uncertainty-budget.ts`
