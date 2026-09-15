# Mini-spec: portal-digest frequency coverage

Target: `packages/shared/src/portal-digest.ts`
Test file: `packages/shared/src/portal-digest.test.ts` (Vitest)

## Context

`portalDigestFrequenciesFor(date)` decides which digest frequencies fire on a given
cron run. WEEKLY only on Monday (UTC). Pure date logic; easy to get the day-of-week
boundary wrong. Use fixed UTC dates; assert against `getUTCDay`.

## Acceptance Criteria

- REQ-DIG-001: WHEN the date is a Monday in UTC (`getUTCDay() === 1`), the function
  SHALL return `["DAILY", "WEEKLY"]` (both, in that order).
- REQ-DIG-002: WHEN the date is any non-Monday UTC day (Sunday/Tuesday..Saturday),
  the function SHALL return `["DAILY"]` only.
- REQ-DIG-003: The function SHALL key off the UTC day, not local time: a timestamp
  that is Monday in UTC but Sunday in a negative-offset local zone (and vice-versa)
  SHALL be classified by its UTC day. (Construct via `new Date("...T...Z")`.)
