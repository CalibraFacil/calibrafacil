# Mini-spec: acceptance-criteria compile/compare coverage

Target: `packages/method-definition/src/criteria.ts`
Test file: `packages/method-definition/tests/criteria.test.ts` (Vitest — the package
uses `tests/<name>.test.ts`)

## [REVIEW] Conformity-decision-adjacent
`compareDecimalInputs` and `evaluateCompiledCriterion` decide whether a measurement
PASSES an acceptance criterion (conformity decision) — adjacent to the regulated
metrology surface, though NOT the GUM uncertainty engine. Tests assert EXISTING
behavior only. **IF a decimal-comparison or evaluation bug is found, STOP and
escalate to a human — do NOT fix it unattended.** Reuse the real engine where
practical; otherwise inject a minimal fake `CalculationEngineLike` (a `compileFormula`
returning `{ variables, normalizedFormula, evaluate }`).

## Acceptance Criteria

- REQ-CRIT-001: WHEN `compareDecimalInputs` compares two decimals exactly via its
  bigint backend, the function SHALL return `-1`/`0`/`1` for less/equal/greater,
  including pairs that float would mis-order (e.g. compare `"0.1"`-derived sums) and
  differing scales (`"1.50"` vs `"1.5"` → `0`).
- REQ-CRIT-002: WHEN `compareDecimalInputs` receives values in scientific notation
  (e.g. `"1e-2"` vs `"0.01"`), the function SHALL treat them as equal (`0`).
- REQ-CRIT-003: IF `compareDecimalInputs` receives a non-finite / non-numeric string,
  THEN the function SHALL throw (`"...non-finite value"`).
- REQ-CRIT-004: IF `compileCriterionExpression` receives an expression that is not a
  boolean comparison (no comparator), THEN the function SHALL throw
  (`"...must be a boolean comparison"`).
- REQ-CRIT-005: WHEN `compileCriterionExpression` parses each comparator
  (`<,<=,>,>=,==,!=`), the compiled `operator` SHALL equal that comparator; an
  unrecognized operator token SHALL default to `"<"`.
- REQ-CRIT-006: IF the expression references a variable not in `allowedVariables`
  (and not produced by an aggregate rewrite), THEN `compileCriterionExpression` SHALL
  throw naming the unknown variable.
- REQ-CRIT-007: WHEN the expression contains an aggregate call (`mean/std/min/max(...)`)
  over allowed variables, `compileCriterionExpression` SHALL succeed, list the consumed
  source variable(s) in `variables`, and NOT leak the synthetic `cf_internal_criterion_agg_*`
  name into `variables`.
- REQ-CRIT-008: WHEN `evaluateCompiledCriterion` is given a compiled criterion and a
  numeric context, the function SHALL return the boolean result of applying the parsed
  operator to the two evaluated sides (cover at least one true and one false case per a
  representative operator).

Implementer: record in your report which REQs use the real engine vs a fake, and any
REQ you could not cover without touching cut-line code.
