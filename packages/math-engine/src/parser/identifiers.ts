import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";
import { DANGEROUS_KEYS } from "../validation/shape.js";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

// The keys no record may carry (one list, in validation/shape.ts) and the names
// that would read as host capabilities.
const RESERVED_IDENTIFIERS = new Set([
  ...DANGEROUS_KEYS,
  "import",
  "require",
  "process",
  "globalThis",
  "eval",
  "Function",
  "random",
  "pickRandom"
]);

export function isReservedIdentifier(identifier: string): boolean {
  return RESERVED_IDENTIFIERS.has(identifier);
}

export function assertSafeIdentifier(identifier: string, maxIdentifierLength: number): void {
  if (identifier.length > maxIdentifierLength) {
    throw makeError(ERROR_CODES.IDENTIFIER_TOO_LONG, "Identifier exceeds the configured length limit.", {
      identifier,
      maxIdentifierLength
    });
  }
  if (!IDENTIFIER_RE.test(identifier)) {
    throw makeError(ERROR_CODES.INVALID_IDENTIFIER, "Identifier must match [A-Za-z_][A-Za-z0-9_]*.", {
      identifier
    });
  }
  if (isReservedIdentifier(identifier)) {
    throw makeError(ERROR_CODES.RESERVED_IDENTIFIER, "Identifier is reserved and cannot be used.", { identifier });
  }
}

export function assertSafeIdentifierRecord(record: Record<string, unknown>, maxIdentifierLength: number): void {
  for (const key of Object.keys(record)) {
    assertSafeIdentifier(key, maxIdentifierLength);
  }
}
