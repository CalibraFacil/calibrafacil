import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  Link01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { formatDate } from "@/lib/format";
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
  releaseStatus?: "RELEASED" | "PAYMENT_PENDING";
  verificationToken: string;
  methodSnapshot: { name?: string; version?: string } | null;
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
  referenceStandards: Array<{
    id: number;
    name: string;
    type?: string | null;
    certificateNumber: string;
    calibratedBy?: string | null;
    calibrationDate: string | Date;
    nextCalibrationDate: string | Date | null;
    certificateDocument: {
      documentId: number;
      fileName: string;
      fileSize: number;
      uploadedAt: string | Date;
      certificateNumber: string;
      calibrationDate: string | Date;
      nextCalibrationDate: string | Date;
    } | null;
  }>;
};

async function downloadFromUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function CertificateDetailPage() {
  const { id } = Route.useParams();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingStandardId, setDownloadingStandardId] = useState<
    number | null
  >(null);
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

  const referenceStandards = certificate?.referenceStandards ?? [];
  const isPaymentPending = certificate?.releaseStatus === "PAYMENT_PENDING";
  const canDownload = Boolean(certificate?.certificateUrl);

  const handleDownload = async () => {
    if (isDownloading || !certificate?.certificateUrl) return;
    setIsDownloading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates/${id}/download`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Falha ao baixar o certificado");
      const { url, filename } = await response.json();
      await downloadFromUrl(url, filename);
    } catch {
      toast.error("Não foi possível baixar o certificado");
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

  const handleStandardCertificateDownload = async (standardId: number) => {
    if (downloadingStandardId) return;
    setDownloadingStandardId(standardId);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates/${id}/reference-standards/${standardId}/certificate/download`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Falha ao baixar");
      const { url, filename } = await response.json();
      await downloadFromUrl(url, filename);
    } catch {
      toast.error("Não foi possível baixar o certificado do padrão");
    } finally {
      setDownloadingStandardId(null);
    }
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
      <div className="portal-shell-sm space-y-4">
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

  const method = certificate.methodSnapshot?.name
    ? `${certificate.methodSnapshot.name}${
        certificate.methodSnapshot.version
          ? ` v${certificate.methodSnapshot.version}`
          : ""
      }`
    : "—";

  return (
    <div className="portal-shell-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/certificates" />}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
            Certificados
          </Button>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone="ok">Aprovado</StatusPill>
            {isPaymentPending ? (
              <StatusPill tone="warning">Liberação pendente</StatusPill>
            ) : null}
          </div>
          <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {certificate.jobId}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            {certificate.serviceName} · emitido por{" "}
            <span className="text-foreground font-medium">
              {certificate.labName}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
          <Button
            onClick={handleDownload}
            disabled={!canDownload || isDownloading}
            className={ACTION_BUTTON_CLASS}
          >
            {isDownloading ? (
              <Spinner className="mr-1" />
            ) : (
              <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            )}
            Baixar PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleCopyLink}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon
              icon={copied ? CheckmarkCircle02Icon : Link01Icon}
              strokeWidth={2}
            />
            {copied ? "Link copiado" : "Copiar verificação"}
          </Button>
        </div>
      </div>

      {isPaymentPending ? (
        <Alert variant="warning">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Liberação pendente</AlertTitle>
          <AlertDescription>
            O download deste certificado será liberado após a confirmação do
            pagamento junto ao laboratório. O documento já está aprovado e
            válido.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Instrument */}
        <Panel className="p-5">
          <PanelHeader eyebrow="Instrumento" title="Equipamento calibrado" />
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            <BlueprintField label="Nome">
              {certificate.assetName}
            </BlueprintField>
            <BlueprintField label="Tag" mono>
              {certificate.assetTag}
            </BlueprintField>
            <BlueprintField label="Fabricante">
              {certificate.assetManufacturer || "—"}
            </BlueprintField>
            <BlueprintField label="Modelo">
              {certificate.assetModel || "—"}
            </BlueprintField>
            <BlueprintField
              label="Número de série"
              mono
              className="sm:col-span-2"
            >
              {certificate.assetSerialNumber}
            </BlueprintField>
          </BlueprintGrid>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            render={
              <Link
                to="/assets/$id"
                params={{ id: String(certificate.assetId) }}
              />
            }
          >
            Ver equipamento
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
        </Panel>

        {/* Calibration */}
        <Panel className="p-5">
          <PanelHeader eyebrow="Calibração" title="Serviço, método e datas" />
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            <BlueprintField label="Serviço" className="sm:col-span-2">
              {certificate.serviceName}
            </BlueprintField>
            <BlueprintField label="Método">{method}</BlueprintField>
            <BlueprintField label="Laboratório">
              {certificate.labName}
            </BlueprintField>
            <BlueprintField label="Data de execução" mono>
              {formatDate(certificate.performedAt)}
            </BlueprintField>
            <BlueprintField label="Data de aprovação" mono>
              {formatDate(certificate.approvedAt)}
            </BlueprintField>
          </BlueprintGrid>
        </Panel>
      </div>

      {/* Reference standards (traceability) */}
      <Panel className="p-5">
        <PanelHeader
          eyebrow="Rastreabilidade"
          title="Padrões de referência"
          description="Certificados originais dos padrões usados nesta calibração."
        />
        <div className="mt-4">
          {referenceStandards.length > 0 ? (
            <div className="space-y-2">
              {referenceStandards.map((standard) => (
                <div
                  key={standard.id}
                  className="flex flex-col gap-3 rounded-xl p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] sm:flex-row sm:items-center sm:justify-between dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {standard.name}
                    </p>
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      Certificado{" "}
                      <span className="font-mono tabular-nums">
                        {standard.certificateNumber}
                      </span>
                      {standard.calibratedBy
                        ? ` · ${standard.calibratedBy}`
                        : ""}
                    </p>
                  </div>
                  {standard.certificateDocument ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleStandardCertificateDownload(standard.id)
                      }
                      disabled={downloadingStandardId === standard.id}
                    >
                      {downloadingStandardId === standard.id ? (
                        <Spinner className="mr-1" />
                      ) : (
                        <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                      )}
                      Baixar PDF
                    </Button>
                  ) : (
                    <StatusPill tone="neutral" dot={false} size="sm">
                      PDF indisponível
                    </StatusPill>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-muted/40 text-muted-foreground rounded-xl p-4 text-sm">
              Nenhum padrão de referência registrado neste certificado.
            </div>
          )}
        </div>
      </Panel>

      {/* Authenticity verification */}
      <Panel className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
            <HugeiconsIcon
              icon={SecurityCheckIcon}
              className="size-5"
              strokeWidth={2}
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              Verificação de autenticidade
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
              Compartilhe o link público com auditores para comprovar a
              autenticidade e a validade deste certificado.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleCopyLink}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon
              icon={copied ? CheckmarkCircle02Icon : Link01Icon}
              strokeWidth={2}
            />
            {copied ? "Copiado" : "Copiar link"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
