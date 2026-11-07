import { Link, createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@calibra-facil/ui/button";
import { Card, CardContent } from "@calibra-facil/ui/card";
import { Spinner } from "@calibra-facil/ui/spinner";
import { CertificateDetailView } from "@/features/certificates/certificate-detail-view";
import { useCertificateDetail } from "@/features/certificates/queries";

export const Route = createFileRoute("/_authenticated/certificates/$id")({
  component: CertificateDetailPage,
});

function CertificateDetailPage() {
  const { id } = Route.useParams();
  const { data: certificate, isLoading, error } = useCertificateDetail(id);

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
