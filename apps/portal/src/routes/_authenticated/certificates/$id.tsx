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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

  const {
    data: certificate,
    isLoading,
    error,
  } = useQuery({
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
    <div className="space-y-4">
      {/* Back link */}
      <Link
        to="/certificates"
        className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground transition-[color] hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
        Certificados
      </Link>

      <Card>
        <CardHeader className="gap-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <Badge className="gap-1.5">
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="size-3"
                />
                Certificado aprovado
              </Badge>
              <div className="space-y-1">
                <CardTitle className="text-2xl text-balance tabular-nums">
                  {certificate.jobId}
                </CardTitle>
                <p className="text-sm text-muted-foreground text-pretty">
                  {certificate.serviceName} emitido por{" "}
                  <span className="font-medium text-foreground">
                    {certificate.labName}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
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
                size="lg"
                onClick={handleCopyLink}
                className="gap-2"
              >
                <HugeiconsIcon
                  icon={copied ? CheckmarkCircle02Icon : Link01Icon}
                  className="size-4"
                />
                {copied ? "Link copiado" : "Copiar verificação"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <Separator />

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
            <section className="space-y-4">
              <SectionHeading
                icon={Wrench01Icon}
                title="Instrumento"
                description="Equipamento calibrado"
              />
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailItem label="Nome" value={certificate.assetName} />
                <DetailItem label="Tag" value={certificate.assetTag} mono />
                {certificate.assetManufacturer && (
                  <DetailItem
                    label="Fabricante"
                    value={certificate.assetManufacturer}
                  />
                )}
                {certificate.assetModel && (
                  <DetailItem label="Modelo" value={certificate.assetModel} />
                )}
                <DetailItem
                  label="Número de série"
                  value={certificate.assetSerialNumber}
                  mono
                />
              </dl>
            </section>

            <section className="space-y-4">
              <SectionHeading
                icon={Settings01Icon}
                title="Calibração"
                description="Serviço e método"
              />
              <dl className="grid gap-3">
                <DetailItem label="Serviço" value={certificate.serviceName} />
                {certificate.methodSnapshot?.name && (
                  <DetailItem
                    label="Método"
                    value={`${certificate.methodSnapshot.name}${
                      certificate.methodSnapshot.version
                        ? ` v${certificate.methodSnapshot.version}`
                        : ""
                    }`}
                  />
                )}
                <DetailItem label="Laboratório" value={certificate.labName} />
              </dl>
            </section>
          </div>

          <Separator />

          <section className="space-y-4">
            <SectionHeading
              icon={Calendar03Icon}
              title="Datas"
              description="Cronologia do certificado"
            />
            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailItem
                label="Data de execução"
                value={formatDate(certificate.performedAt)}
                className="text-base tabular-nums"
              />
              <DetailItem
                label="Data de aprovação"
                value={formatDate(certificate.approvedAt)}
                className="text-base tabular-nums"
              />
            </dl>
          </section>

          <div className="rounded-lg bg-muted/60 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background shadow-xs">
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="size-5 text-muted-foreground"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">Verificação de autenticidade</h3>
                <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
                  Compartilhe o link público de verificação com auditores para
                  comprovar a autenticidade deste certificado.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="gap-2"
              >
                <HugeiconsIcon
                  icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                  className="size-4"
                />
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: typeof Wrench01Icon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <HugeiconsIcon icon={icon} className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <h2 className="font-medium leading-none">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-sm font-medium",
          mono && "font-mono tabular-nums",
          className,
        )}
      >
        {value}
      </dd>
    </div>
  );
}
