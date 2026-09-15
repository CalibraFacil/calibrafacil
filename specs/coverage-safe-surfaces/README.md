# Coverage mini-specs

Characterization/coverage specs for safe, loopable pure-logic surfaces. Each spec
locks down the **current** behavior of an under-tested module so a regression would
fail a test. No production-code changes unless a spec uncovers a real bug — in which
case the fix lands in a **separate, clearly-labeled commit** and anything
cut-line-adjacent is escalated to a human first (see CLAUDE.md / calibrafacil-domain).

REQ IDs are stable and append-only. Each REQ maps to ≥1 test that FAILS on regression
(no tautologies — enforced by spec-verifier with mutation reasoning).

Cut-line note: none of these targets are RBAC/tenancy, ICP signing, GUM uncertainty
math, or the calibration-approval state machine. Two are _adjacent_ and flagged
`[REVIEW]`: `api-keys` (auth-adjacent key hashing, not the policy layer) and
`criteria` (conformity-criteria compilation, not GUM math). Tests assert existing
behavior only.
