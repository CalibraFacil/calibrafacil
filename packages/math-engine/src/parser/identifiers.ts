import { ERROR_CODES } from "../errors/codes.js";
import { makeError } from "../errors/errors.js";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const RESERVED_IDENTIFIERS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
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
