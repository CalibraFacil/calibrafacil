// Rewrites an `.env` written before the role split (P2-18k) for `pnpm setup:dev`
// (scripts/dev-setup.mjs): the owner was in DATABASE_URL and there was no
// DATABASE_OWNER_URL, and the API now refuses that at start-up. Pure, so it is
// tested (scripts/role-split.test.mjs).

/**
 * @param {string} text the contents of an `.env` file
 * @returns {{ status: "current" } | { status: "manual" } | { status: "upgraded", text: string }}
 *   `current`: nothing to do; `manual`: the old URL is not the development default
 *   owner (`calibra`), so the person must split it by hand; `upgraded`: the new text.
 */
export function splitDatabaseRoles(text) {
  if (/^DATABASE_OWNER_URL=/m.test(text)) return { status: "current" };
  const match = text.match(/^DATABASE_URL=(.*)$/m);
  if (!match) return { status: "current" };
  const owner = match[1].trim();
  let application;
  try {
    const url = new URL(owner);
    if (url.username !== "calibra") return { status: "manual" };
    url.username = "calibra_app";
    url.password = "calibra_app";
    application = url.toString();
  } catch {
    return { status: "manual" };
  }
  // A function replacer: a string replacement would read `$&`, `$$`, `$1` ... in
  // the owner's password as patterns and corrupt the URL.
  return {
    status: "upgraded",
    text: text.replace(
      match[0],
      () => `DATABASE_URL=${application}\nDATABASE_OWNER_URL=${owner}`,
    ),
  };
}
