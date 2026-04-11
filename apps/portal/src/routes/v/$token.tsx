import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Download04Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/v/$token")({
  component: VerifyPage,
});

type VerificationData = {
  valid: boolean;
  jobId: string;
  status: string;
  hasDocument: boolean;
  lab: string;
  customer: string;
  asset: {
    name: string;
    tag: string;
  };
  service: string;
  performedAt: string | null;
  approvedAt: string | null;
};

function VerifyPage() {
  const { token } = Route.useParams();
  const [downloading, setDownloading] = useState(false);
  const verificationQuery = useQuery({
    queryKey: ["verification", token],
    queryFn: async (): Promise<VerificationData> => {
      const response = await fetch(`${getApiBaseUrl()}/api/verify/${token}`);

      if (!response.ok) {
        if (response.status === 404 || response.status === 400) {
          throw new Error("Certificado não encontrado ou inválido.");
        }
        throw new Error("Erro ao verificar certificado.");
      }

      const result = (await response.json()) as VerificationData;

      if (!result.valid) {
        throw new Error("Certificado não encontrado ou inválido.");
      }

      return result;
    },
  });
  const data = verificationQuery.data;
  const error =
    verificationQuery.error instanceof Error
      ? verificationQuery.error.message
      : null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/verify/${token}/download`,
      );

      if (!response.ok) {
        throw new Error("Download failed");
      }

      const { url } = await response.json();
      window.location.href = url;
    } catch {
      toast.error("Erro ao baixar certificado");
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Loading state
  if (verificationQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  // Error/Invalid state
  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon
                icon={AlertCircleIcon}
                className="size-8 text-destructive"
              />
            </div>
            <CardTitle className="text-xl text-destructive">
              Certificado Inválido
            </CardTitle>
            <CardDescription>
              {error || "Certificado nao encontrado ou invalido."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Valid state
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <HugeiconsIcon
              icon={SecurityCheckIcon}
              className="size-8 text-green-600 dark:text-green-500"
            />
          </div>
          <CardTitle className="text-xl text-green-600 dark:text-green-500">
            Certificado Válido
          </CardTitle>
          <CardDescription className="mt-2 text-2xl font-bold text-foreground">
            {data.jobId}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Ativo</p>
              <p className="font-medium">{data.asset.name}</p>
              <p className="text-xs text-muted-foreground">{data.asset.tag}</p>
            </div>

            <div>
              <p className="text-muted-foreground">Cliente</p>
              <p className="font-medium">{data.customer}</p>
            </div>

            <div>
              <p className="text-muted-foreground">Serviço</p>
              <p className="font-medium">{data.service}</p>
            </div>

            <div>
              <p className="text-muted-foreground">Data</p>
              <p className="font-medium">{formatDate(data.performedAt)}</p>
            </div>

            <div className="col-span-2">
              <p className="text-muted-foreground">Laboratório</p>
              <p className="font-medium">{data.lab}</p>
            </div>
          </div>

          {/* Download Button */}
          {data.hasDocument && (
            <Button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full"
              size="lg"
            >
              {downloading ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Baixando...
                </>
              ) : (
                <>
                  <HugeiconsIcon
                    icon={Download04Icon}
                    className="mr-2 size-4"
                  />
                  Baixar PDF Original
                </>
              )}
            </Button>
          )}

          {!data.hasDocument && (
            <p className="text-center text-sm text-muted-foreground">
              Documento ainda não disponível para download.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
