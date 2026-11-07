import { createFileRoute } from "@tanstack/react-router";
import { CertificatesPage } from "@/features/certificates/certificates-page";

type CertificatesSearch = {
  /** Per-instrument archive: deep-link the list scoped to one asset. */
  assetId?: number;
};

export const Route = createFileRoute("/_authenticated/certificates/")({
  validateSearch: (search: Record<string, unknown>): CertificatesSearch => {
    const assetId = Number(search.assetId);
    return {
      assetId: Number.isInteger(assetId) && assetId > 0 ? assetId : undefined,
    };
  },
  component: CertificatesRoute,
});

function CertificatesRoute() {
  const { assetId } = Route.useSearch();

  return <CertificatesPage assetId={assetId} />;
}
