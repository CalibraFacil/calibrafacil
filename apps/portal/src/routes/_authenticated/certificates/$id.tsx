import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Download04Icon,
  File01Icon,
  Link01Icon,
  Settings01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/certificates/$id")({
  component: CertificateDetailPage,
});

type Certificate = {
  id: number;
  jobId: string;
  status: string;
  performedAt: string | null;
  approvedAt: string | null;
  certificateUrl: string | null;
  verificationToken: string;
  methodSnapshot: {
    name?: string;
    version?: string;
  } | null;
  results: Record<string, unknown> | null;
  assetId: number;
  assetName: string;
  assetTag: string;
  assetManufacturer: string | null;
  assetModel: string | null;
  assetSerialNumber: string;
  serviceName: string;
  labName: string;
  labLogo: string | null;
};

function formatDate(date: string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function CertificateDetailPage() {
  const { id } = Route.useParams();
  const [isDownloading, setIsDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: certificate, isLoading, error } = useQuery({
    queryKey: ["portal-certificate", id],
    queryFn: async (): Promise<Certificate> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates/${id}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar certificado");
      }
      return response.json();
    },
  });

  const handleDownload = async () => {
    if (isDownloading || !certificate?.certificateUrl) return;

    setIsDownloading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates/${id}/download`,
        { credentials: "include" },
      );

      if (!response.ok) throw new Error("Falha ao baixar");

      const { url, filename } = await response.json();

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Download error:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!certificate) return;

    const verifyUrl = `${window.location.origin}/v/${certificate.verificationToken}`;
    await navigator.clipboard.writeText(verifyUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error || !certificate) {
    return (
      <div className="space-y-6">
        <Link
          to="/certificates"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
          Voltar
        </Link>

        <Card className="border-destructive/50">
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon
                icon={File01Icon}
                className="size-6 text-destructive"
              />
            </div>
            <h3 className="text-lg font-medium">Certificado nao encontrado</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              O certificado solicitado nao existe ou voce nao tem acesso.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        to="/certificates"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
        Certificados
      </Link>

      {/* Hero section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 p-8">
        <div className="relative z-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-4">
              {/* Status badge */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-sm font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
                Certificado Aprovado
              </span>

              {/* Certificate ID */}
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">
                  {certificate.jobId}
                </h1>
                <p className="mt-1 text-muted-foreground">
                  {certificate.serviceName}
                </p>
              </div>

              {/* Lab info */}
              <p className="text-sm text-muted-foreground">
                Emitido por <span className="font-medium text-foreground">{certificate.labName}</span>
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 sm:items-end">
              <Button
                size="lg"
                onClick={handleDownload}
                disabled={isDownloading || !certificate.certificateUrl}
                className="gap-2"
              >
                {isDownloading ? (
                  <Spinner className="size-4" />
                ) : (
                  <HugeiconsIcon icon={Download04Icon} className="size-4" />
                )}
                Baixar PDF
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="gap-2"
              >
                <HugeiconsIcon
                  icon={copied ? CheckmarkCircle02Icon : Link01Icon}
                  className="size-4"
                />
                {copied ? "Link copiado!" : "Copiar link de verificacao"}
              </Button>
            </div>
          </div>
        </div>

        {/* Background decoration */}
        <div className="absolute -right-20 -top-20 size-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 size-64 rounded-full bg-primary/5 blur-3xl" />
      </div>

      {/* Details grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Asset information */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <HugeiconsIcon
                  icon={Wrench01Icon}
                  className="size-5 text-blue-600 dark:text-blue-400"
                />
              </div>
              <div>
                <CardTitle className="text-base">Instrumento</CardTitle>
                <CardDescription>Detalhes do equipamento calibrado</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <DetailItem label="Nome" value={certificate.assetName} />
              <DetailItem label="Tag" value={certificate.assetTag} mono />
              {certificate.assetManufacturer && (
                <DetailItem label="Fabricante" value={certificate.assetManufacturer} />
              )}
              {certificate.assetModel && (
                <DetailItem label="Modelo" value={certificate.assetModel} />
              )}
              <DetailItem
                label="Numero de Serie"
                value={certificate.assetSerialNumber}
                mono
              />
            </dl>
          </CardContent>
        </Card>

        {/* Calibration information */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <HugeiconsIcon
                  icon={Settings01Icon}
                  className="size-5 text-purple-600 dark:text-purple-400"
                />
              </div>
              <div>
                <CardTitle className="text-base">Calibracao</CardTitle>
                <CardDescription>Informacoes do servico</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <DetailItem label="Servico" value={certificate.serviceName} />
              {certificate.methodSnapshot?.name && (
                <DetailItem
                  label="Metodo"
                  value={`${certificate.methodSnapshot.name}${certificate.methodSnapshot.version ? ` v${certificate.methodSnapshot.version}` : ""}`}
                />
              )}
              <DetailItem label="Laboratorio" value={certificate.labName} />
            </dl>
          </CardContent>
        </Card>

        {/* Dates */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <HugeiconsIcon
                  icon={Calendar03Icon}
                  className="size-5 text-amber-600 dark:text-amber-400"
                />
              </div>
              <div>
                <CardTitle className="text-base">Datas</CardTitle>
                <CardDescription>Cronologia da calibracao</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1.5">
                <dt className="text-sm text-muted-foreground">Data de Execucao</dt>
                <dd className="text-lg font-medium">
                  {formatDate(certificate.performedAt)}
                </dd>
              </div>
              <div className="space-y-1.5">
                <dt className="text-sm text-muted-foreground">Data de Aprovacao</dt>
                <dd className="text-lg font-medium">
                  {formatDate(certificate.approvedAt)}
                </dd>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Verification info */}
      <Card className="border-dashed">
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="size-6 text-muted-foreground"
              />
            </div>
            <div className="flex-1">
              <h3 className="font-medium">Verificacao de Autenticidade</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Este certificado pode ser verificado publicamente atraves do link de verificacao.
                Compartilhe-o com auditores para comprovar a autenticidade.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopyLink} className="gap-2">
              <HugeiconsIcon
                icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                className="size-4"
              />
              {copied ? "Copiado!" : "Copiar"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-medium text-right", mono && "font-mono")}>
        {value}
      </dd>
    </div>
  );
}
