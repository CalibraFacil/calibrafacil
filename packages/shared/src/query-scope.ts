/**
 * `placeholderData` for paginated/filtered lists: while the next page, search
 * or filter loads, keep showing the previous result (no skeleton flash) -
 * but only when it belongs to the same `scope`.
 *
 * `scope` is the leading part of the query key that identifies *whose* list
 * this is (the lab app's `['jobs', organizationId]`, the portal's
 * `key("portal-assets")` from `usePortalQueryKey()`: root + active
 * organization + list name); page, search and filters follow it. Plain
 * `keepPreviousData` would also carry rows across an organization switch,
 * showing one tenant's records under another's name until the new request
 * lands. Out of scope, no placeholder is used.
 *
 * Structurally the same callback TanStack Query's `keepPreviousData` is (it
 * returns the previous data as is), so this module needs no query dependency.
 */
export function keepPreviousDataInScope<TData>(
  scope: ReadonlyArray<unknown>,
): (
  previousData: TData | undefined,
  previousQuery: { queryKey: ReadonlyArray<unknown> } | undefined,
) => TData | undefined {
  return (previousData, previousQuery) => {
    if (!previousQuery) return undefined;

    const sameScope = scope.every((part, index) =>
      Object.is(previousQuery.queryKey[index], part),
    );

    return sameScope ? previousData : undefined;
  };
}
