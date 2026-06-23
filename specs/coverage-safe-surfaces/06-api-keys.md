# Mini-spec: public API-key helpers coverage

Target: `apps/api/src/lib/api-keys.ts`
Test file: `apps/api/src/lib/__tests__/api-keys.spec.ts` (Vitest — `.spec.ts` per
apps/api config `include: ["src/**/*.spec.ts"]`)

## Context
[REVIEW: auth-adjacent — key generation/hashing/extraction. NOT the RBAC policy
layer (access.ts/permission.ts), which is untouched.] Pure crypto/string helpers.
Tests assert existing behavior only; do not alter the module.

## Acceptance Criteria

- REQ-APIKEY-001: WHEN `createApiKeySecret` is called, the function SHALL return a
  `key` beginning with `"cf_live_"` and a `keyPrefix` equal to the first 15 chars of
  that key.
- REQ-APIKEY-002: WHEN `createApiKeySecret` is called, the returned `keyHash` SHALL
  equal `hashApiKey(key)` (i.e. the SHA-256 hex of the full key).
- REQ-APIKEY-003: The `hashApiKey` function SHALL return the lowercase 64-char SHA-256
  hex digest of its input (assert against a known vector, e.g. `hashApiKey("cf_live_x")`
  matches Node `createHash("sha256")`).
- REQ-APIKEY-004: WHEN two calls to `createApiKeySecret` run, the function SHALL
  return distinct `key` values (randomness present).
- REQ-APIKEY-005: WHEN `safeEqualHash` receives two equal strings, the function SHALL
  return `true`; for two different equal-length strings it SHALL return `false`.
- REQ-APIKEY-006: IF `safeEqualHash` receives strings of different lengths, THEN it
  SHALL return `false` without throwing (no timingSafeEqual length error).
- REQ-APIKEY-007: WHEN a Request carries an `x-api-key` header, `extractApiKeyFromRequest`
  SHALL return its trimmed value (header takes precedence over Authorization).
- REQ-APIKEY-008: WHEN a Request carries `Authorization: Bearer <token>` (and no
  x-api-key), the function SHALL return the trimmed token; scheme match SHALL be
  case-insensitive.
- REQ-APIKEY-009: IF a Request has neither header, or an Authorization scheme that is
  not `bearer`, or a bearer with no token, THEN `extractApiKeyFromRequest` SHALL
  return `null`.
