import { createFileRoute } from "@tanstack/react-router";

import { AssetDetailPage } from "@/features/assets/asset-detail-page";

export const Route = createFileRoute("/_authenticated/assets/$id")({
  component: AssetDetailRoute,
});

function AssetDetailRoute() {
  const { id } = Route.useParams();
  return <AssetDetailPage assetId={id} />;
}
