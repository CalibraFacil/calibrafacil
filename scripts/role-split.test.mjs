// Tests for the .env role-split rewrite of `pnpm setup:dev`.
// Run: node scripts/role-split.test.mjs (same convention as the other
// scripts/*.test.mjs gates: plain asserts, exit non-zero on failure).
import assert from "node:assert/strict";
import { splitDatabaseRoles } from "./role-split.mjs";

const OLD =
  "A=1\nDATABASE_URL=postgres://calibra:calibra@localhost:55432/calibra\nB=2\n";

// An old layout becomes the split, everything else untouched.
{
  const result = splitDatabaseRoles(OLD);
  assert.equal(result.status, "upgraded");
  assert.equal(
    result.text,
    "A=1\nDATABASE_URL=postgres://calibra_app:calibra_app@localhost:55432/calibra\nDATABASE_OWNER_URL=postgres://calibra:calibra@localhost:55432/calibra\nB=2\n",
  );
}

// `$&`, `$$`, `$1`, $` and $' in the owner's password must survive verbatim.
for (const password of ["p$&q", "p$$q", "a$1b", "x$`y", "x$'y", "$$$&$&"]) {
  const owner = `postgres://calibra:${password}@localhost:55432/calibra`;
  const result = splitDatabaseRoles(`DATABASE_URL=${owner}\nZ=1\n`);
  assert.equal(result.status, "upgraded", password);
  assert.equal(
    result.text,
    `DATABASE_URL=postgres://calibra_app:calibra_app@localhost:55432/calibra\nDATABASE_OWNER_URL=${owner}\nZ=1\n`,
    password,
  );
}

// Already split: nothing to do. No DATABASE_URL at all: nothing to do.
assert.equal(
  splitDatabaseRoles(
    "DATABASE_URL=postgres://calibra_app:x@h/db\nDATABASE_OWNER_URL=postgres://calibra:y@h/db\n",
  ).status,
  "current",
);
assert.equal(splitDatabaseRoles("A=1\n").status, "current");

// An owner that is not the development default (or not a URL) is left to the person.
assert.equal(
  splitDatabaseRoles("DATABASE_URL=postgres://someone:pw@h/db\n").status,
  "manual",
);
assert.equal(splitDatabaseRoles("DATABASE_URL=not a url\n").status, "manual");

console.log("role-split tests passed");
