import { createFileRoute } from "@tanstack/react-router";
import { NewRequestPage } from "@/features/requests/new-request-page";

type NewRequestSearch = {
  /** Self-service recall: instruments to preselect (e.g. from asset detail). */
  assetIds?: Array<number>;
};

function parseAssetIds(value: unknown): Array<number> | undefined {
  const raw = Array.isArray(value) ? value : value !== undefined ? [value] : [];
  const ids = raw
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? [...new Set(ids)].slice(0, 50) : undefined;
}

export const Route = createFileRoute("/_authenticated/requests/new")({
  validateSearch: (search: Record<string, unknown>): NewRequestSearch => ({
    assetIds: parseAssetIds(search.assetIds),
  }),
  component: NewRequestRoute,
});

function NewRequestRoute() {
  const { assetIds } = Route.useSearch();

  return <NewRequestPage assetIds={assetIds} />;
}
