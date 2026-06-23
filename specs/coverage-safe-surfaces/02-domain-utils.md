# Mini-spec: domain-utils coverage

Target: `packages/shared/src/domain-utils.ts`
Test file: `packages/shared/src/domain-utils.test.ts` (Vitest)

## Context
Hostname/origin normalization + localhost detection used by config/security paths.
Pure string logic; many reject branches.

## Acceptance Criteria

- REQ-DOM-001: WHEN `normalizeHostname` receives a value with a protocol and path
  (e.g. `"HTTPS://Lab.Example.com/x"`), the function SHALL return the lowercase
  host only (`"lab.example.com"`).
- REQ-DOM-002: WHEN `normalizeHostname` receives a trailing-dot FQDN
  (`"example.com."`), the function SHALL strip the trailing dot.
- REQ-DOM-003: IF `normalizeHostname` receives an empty/whitespace-only string,
  THEN the function SHALL return `null`.
- REQ-DOM-004: IF the host contains a port (`":"`), THEN `normalizeHostname` SHALL
  return `null`.
- REQ-DOM-005: IF the host contains characters outside `[a-z0-9.-]` (e.g. `_` or
  unicode), THEN `normalizeHostname` SHALL return `null`.
- REQ-DOM-006: IF the host starts or ends with `"."`, THEN `normalizeHostname` SHALL
  return `null`.
- REQ-DOM-007: WHEN `normalizeOrigin` receives a valid absolute URL, the function
  SHALL return lowercased `"<protocol>//<host>"` (port preserved, path/query dropped).
- REQ-DOM-008: IF `normalizeOrigin` receives a non-URL string, THEN the function
  SHALL return `null` (no throw).
- REQ-DOM-009: WHEN `isLocalHostname` receives `"localhost"`, any `*.local`, or a
  dotted-quad IPv4 (`"127.0.0.1"`), the function SHALL return `true`.
- REQ-DOM-010: WHEN `isLocalHostname` receives a normal public host
  (`"example.com"`), the function SHALL return `false`.
