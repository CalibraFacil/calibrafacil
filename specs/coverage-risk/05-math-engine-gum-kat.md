# Mini-spec [HIGH RISK / CUT-LINE]: math-engine GUM known-answer tests

Target: `packages/math-engine` GUM core — `uncertainty/type-a.ts`,
`uncertainty/type-b.ts`, `gum/statistics.ts` (`studentTQuantile`,
`coverageFactorForProbability`, `welchSatterthwaiteDegreesOfFreedom`),
`gum/measurement.ts` / `engine/create.ts` (`evaluateMeasurementModel`),
and `numeric/decimal.ts` exactness.
Test file: `packages/math-engine/src/gum/gum-kat.spec.ts` (NEW) — and you MUST first
wire a Vitest runner in this package (see Tooling).

## CUT-LINE — pair-don't-loop, oracle-gated

This is the GUM uncertainty engine: wrong U/k = invalid certificates. The expected
values below are an AUTHORITATIVE oracle from JCGM 100:2008 (GUM) and standard
Student-t tables — independently hand-verifiable. **Assert the ORACLE values. IF the
engine produces a different number, STOP and escalate as a GUM regression — do NOT
relax tolerance or edit the expected value to match.** Do NOT modify any engine source.
Mirror the validated approach in `apps/api/src/lib/math-engine-kat.spec.ts` and EXPAND it.

## Tooling (test infra, not a production change — report it)

`packages/math-engine` has no test runner. Add: `vitest` (+ `@vitest/coverage-v8`) devDep,
a `vitest.config.ts` (mirror `packages/shared`), and `"test"`/`"test:run"` scripts in
package.json. Confirm `pnpm --dir packages/math-engine test:run` works. Do not change `main`
/`exports` or any `src/**` engine file.

## Oracle (independently verifiable)

- Type A of `[9.8, 10.0, 10.2]`: mean = 10, sample s = 0.2, standard uncertainty of the
  mean u = s/√n = 0.2/√3, degreesOfFreedom = n−1 = 2.
- Type B divisors: rectangular ÷√3, triangular ÷√6, U-shaped/arcsine ÷√2. (Read type-b.ts
  for the exact distribution set + the `normal` handling; assert each divisor against its
  textbook value and FLAG any distribution whose divisor is not a clean derivation.)
- Student-t `studentTQuantile(0.975, ν)` (two-sided 95%): ν=1→12.7062, ν=2→4.30265,
  ν=3→3.18245, ν=5→2.57058, ν=10→2.22814, ν=30→2.04227, ν→∞→1.95996.
- `coverageFactorForProbability(0.95, ν)` SHALL equal `studentTQuantile(0.975, ν)`; at
  ν=∞ it is z₀.₉₇₅ = 1.959964.
- Welch–Satterthwaite `welchSatterthwaiteDegreesOfFreedom(uc²=2, [1,1], [10,10])` = 20;
  with `[∞,10]` (one infinite-dof contribution) = 40.
- Full model `y = x`, Type-A only on x=[9.8,10,10.2], p=0.95: value=10, u_c=0.2/√3,
  ν_eff=2, k=t(0.975,2)=4.30265, U=u_c·k.

## Acceptance Criteria

- REQ-GUM-001: `typeAFromRepeatedObservations([9.8,10.0,10.2])` SHALL yield mean=10,
  sampleStandardDeviation=0.2, standardUncertainty=0.2/√3, degreesOfFreedom=2. [HIGH RISK]
- REQ-GUM-002: `typeBStandardUncertainty` SHALL divide the half-width by √3 (rectangular),
  √6 (triangular), and √2 (U-shaped/arcsine), returning the matching divisor. Assert each;
  FLAG any other distribution whose divisor isn't textbook. [HIGH RISK]
- REQ-GUM-003: `studentTQuantile(0.975, ν)` SHALL match the oracle t-values for
  ν ∈ {1,2,3,5,10,30} to ≥5 significant figures. [HIGH RISK]
- REQ-GUM-004: `coverageFactorForProbability(0.95, Infinity)` SHALL equal z₀.₉₇₅ ≈ 1.959964,
  and `coverageFactorForProbability(0.95, ν)` SHALL equal `studentTQuantile(0.975, ν)` for a
  finite ν (e.g. 10). [HIGH RISK]
- REQ-GUM-005: `coverageFactorForProbability` SHALL be monotonically NON-increasing as ν
  grows (k(ν=2) > k(ν=10) > k(ν=∞)) — a sanity invariant on the t→z limit.
- REQ-GUM-006: `welchSatterthwaiteDegreesOfFreedom(2,[1,1],[10,10])` SHALL equal 20 and
  `(2,[1,1],[Infinity,10])` SHALL equal 40. [HIGH RISK]
- REQ-GUM-007: `evaluateMeasurementModel({formula:"x", quantities:{x:{estimate:10,
repeatedObservations:[9.8,10,10.2]}}, coverageProbability:0.95})` SHALL produce value=10,
  combinedStandardUncertainty=0.2/√3, effectiveDegreesOfFreedom=2, coverageFactor≈4.30265,
  expandedUncertainty=(0.2/√3)·4.30265. [HIGH RISK]
- REQ-GUM-008: A two-component model where Type B dominates SHALL combine in quadrature
  (u_c = √(Σu_i²)) — assert with a hand-computed two-term example (e.g. u1=0.003/√3 from a
  rectangular Type B plus the Type-A term) and FLAG if the engine does not RSS them. [HIGH RISK]
- REQ-GUM-009: `ENGINE_VERSION` SHALL equal `"0.3.0"` (pins the validated engine tag; a
  surprise bump must show in the diff and force re-validation). [HIGH RISK]
- REQ-GUM-010: The decimal backend (`numeric/decimal.ts`) SHALL add/subtract exactly where
  float would drift (e.g. 0.1 + 0.2 === 0.3 exactly through the decimal API) — read the
  module for its exact public surface and assert one exactness case. [HIGH RISK]

Implementer: read the EXACT signatures/return types first (values may be decimal objects →
wrap with `Number(...)` like the existing KAT). Use `toBeCloseTo` with a TIGHT digit count
(≥5 sig figs); never loosen it. Report every REQ where the engine disagreed with the oracle.
