import { keepPreviousData } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";

/**
 * `placeholderData` for paginated/filtered lists: while the next page, search
 * or filter loads, keep showing the previous result (no skeleton flash) -
 * but only when it belongs to the same `scope`.
 *
 * `scope` is the leading part of the query key built with
 * `usePortalQueryKey()` (`key("portal-assets")` = portal root + active client
 * organization + list name). Plain `keepPreviousData` would also carry rows
 * across an organization switch, showing one client's records under another's
 * name until the new request lands. Out of scope, no placeholder is used.
 */
export function keepPreviousDataInScope<TData>(
  scope: ReadonlyArray<unknown>,
): (
  previousData: TData | undefined,
  previousQuery: { queryKey: QueryKey } | undefined,
) => TData | undefined {
  return (previousData, previousQuery) => {
    if (!previousQuery) return undefined;

    const sameScope = scope.every((part, index) =>
      Object.is(previousQuery.queryKey[index], part),
    );

    return sameScope ? keepPreviousData(previousData) : undefined;
  };
}
