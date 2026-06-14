import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { getApiBaseUrl } from "@/lib/utils";
import {
  CertificateDetailView,
  type Certificate,
} from "@/features/certificates/certificate-detail-view";

export const Route = createFileRoute("/_authenticated/certificates/$id")({
  component: CertificateDetailPage,
});

function CertificateDetailPage() {
  const { id } = Route.useParams();

  const {
    data: certificate,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["portal-certificate", id],
    queryFn: async (): Promise<Certificate> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates/${encodeURIComponent(id)}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar certificado");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error || !certificate) {
    return (
      <div className="portal-shell space-y-4">
        <Button variant="ghost" size="sm" render={<Link to="/certificates" />}>
          <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
          Certificados
        </Button>
        <Card>
          <CardContent className="text-destructive py-12 text-center">
            Certificado não encontrado ou indisponível para este acesso.
          </CardContent>
        </Card>
      </div>
    );
  }

  return <CertificateDetailView certificate={certificate} />;
}
