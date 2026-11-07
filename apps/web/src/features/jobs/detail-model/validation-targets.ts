/**
 * Which acceptance validation speaks about a formula output: one targets an
 * output only when the key appears in one of its expressions as a whole
 * identifier. Matching the key as plain text would let an output `U` match
 * `U_c`, `Uexp` or any expression with a capital U in it, and show another
 * criterion's message and badge next to it.
 */

/**
 * An identifier: a letter or `_`, then letters, digits or `_`. Not one glued to
 * a preceding identifier character, digit or dot, so the `e` of `1e-3` and the
 * `x` of `0x10` are not identifiers.
 */
const IDENTIFIER = /(?<![A-Za-z0-9_.])[A-Za-z_][A-Za-z0-9_]*/g

/** The identifiers an expression names. */
export function expressionIdentifiers(expression: string): Set<string> {
  return new Set(expression.match(IDENTIFIER) ?? [])
}

type ValidationExpressions = {
  leftExpression: string
  rightExpression: string
}

/** Whether `validation` names `outputKey` as an identifier in either side. */
export function validationTargets(
  validation: ValidationExpressions,
  outputKey: string,
): boolean {
  return (
    expressionIdentifiers(validation.leftExpression).has(outputKey) ||
    expressionIdentifiers(validation.rightExpression).has(outputKey)
  )
}

/** The first validation that targets `outputKey`, if any. */
export function findValidationFor<T extends ValidationExpressions>(
  validations: readonly T[],
  outputKey: string,
): T | undefined {
  return validations.find((validation) =>
    validationTargets(validation, outputKey),
  )
}
