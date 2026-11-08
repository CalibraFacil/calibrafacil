import { ac, type PermissionCheck } from "@calibra-facil/auth/access";

/**
 * Whether `value` is a permission the access-control statements know: every
 * resource is a statement and every action is one of its actions.
 *
 * The contract types an endpoint's `permission` (and a sync operation's)
 * structurally, as plain strings, because it cannot import auth's runtime; this is
 * where the names are held to `ac.statements`. `mount` refuses a definition that
 * fails it, and the API's specs run it over every definition and every sync
 * operation.
 */
export function isPermissionCheck(value: unknown): value is PermissionCheck {
  if (typeof value !== "object" || value === null) return false;
  const known = new Map<string, readonly string[]>(
    Object.entries(ac.statements),
  );
  return Object.entries(value).every(([resource, actions]) => {
    const allowed = known.get(resource);
    return (
      allowed !== undefined &&
      Array.isArray(actions) &&
      actions.every(
        (action) => typeof action === "string" && allowed.includes(action),
      )
    );
  });
}
