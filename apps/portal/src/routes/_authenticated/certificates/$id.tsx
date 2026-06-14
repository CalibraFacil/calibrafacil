import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  CheckmarkBadge02Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  FunctionIcon,
  Link01Icon,
  RulerIcon,
  SecurityCheckIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from "@/components/instrument-panel";
import { AccreditationSeal } from "@/components/accreditation-seal";
import { StatusPill, TONE } from "@/components/status-pill";
import { formatDate } from "@/lib/format";
import { getApiBaseUrl } from "@/lib/utils";
import {
  useSignatureVerdict,
  type SignatureVerdictOverall,
} from "@/features/verification/queries";
import {
  buildScalarResults,
  describeDueDate,
  summarizeConformity,
  type CertificateVerdict,
  type MethodSnapshotLike,
} from "@/features/certificates/verdict";

export const Route = createFileRoute("/_authenticated/certificates/$id")({
  component: CertificateDetailPage,
});

type Certificate = {
  id: number;
  jobId: string;
  status: string;
  performedAt: string | null;
  approvedAt: string | null;
  dueDate: string | null;
  certificateUrl: string | null;
  releaseStatus?: "RELEASED" | "PAYMENT_PENDING";
  verificationToken: string;
  verdict?: CertificateVerdict | null;
  methodSnapshot: MethodSnapshotLike;
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
  accreditation?: {
    accredited: boolean;
    number: string | null;
  };
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

const OVERALL_TONE: Record<SignatureVerdictOverall, SignalTone> = {
  VALID: "ok",
  ALTERED: "critical",
  UNSIGNED: "neutral",
  UNVERIFIABLE: "warning",
};

const OVERALL_LABEL: Record<SignatureVerdictOverall, string> = {
  VALID: "Assinatura íntegra e confiável",
  ALTERED: "Documento alterado",
  UNSIGNED: "Sem assinatura digital",
  UNVERIFIABLE: "Não foi possível confirmar",
};

function VerdictTile({
  label,
  state,
  falseTone = "critical",
}: {
  label: string;
  state: boolean | null;
  falseTone?: SignalTone;
}) {
  const tone: SignalTone =
    state === null ? "neutral" : state ? "ok" : falseTone;
  const value = state === null ? "—" : state ? "OK" : "Falha";
  const icon =
    state === null ? undefined : state ? CheckmarkCircle02Icon : Alert02Icon;
  return <SignalTile label={label} value={value} tone={tone} icon={icon} />;
}

/** ICP-Brasil cryptographic verdict, reusing the public verification endpoint. */
function SignatureIntegrity({ token }: { token: string }) {
  const query = useSignatureVerdict(token, true);

  if (query.isPending) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Verificando a assinatura digital…
      </div>
    );
  }

  const data = query.data;
  if (query.isError || !data || !data.signed || !data.verdict) {
    return (
      <div
        className={cn(
          "mt-4 rounded-xl p-3 text-sm text-muted-foreground",
          TONE.neutral.surface,
        )}
      >
        Este certificado não possui assinatura digital criptográfica.
      </div>
    );
  }

  const verdict = data.verdict;
  const tone = OVERALL_TONE[verdict.overall];

  return (
    <div className="mt-4 space-y-3">
      <div className={cn("rounded-xl p-3", TONE[tone].surface)}>
        <p className="flex items-center gap-2 font-medium">
          <HugeiconsIcon
            icon={
              verdict.overall === "VALID" ? CheckmarkCircle02Icon : Alert02Icon
            }
            className="size-4 shrink-0"
          />
          {OVERALL_LABEL[verdict.overall]}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <VerdictTile label="Conteúdo" state={verdict.hashMatch} />
        <VerdictTile
          label="Assinatura"
          state={verdict.signatureCryptographicallyValid}
        />
        <VerdictTile
          label="Cadeia ICP-Brasil"
          state={verdict.signerChainsToIcpRoot}
          falseTone="warning"
        />
        <VerdictTile
          label="Validade"
          state={verdict.certNotExpiredAtCheckDate}
          falseTone="warning"
        />
      </div>
    </div>
  );
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
        `${getApiBaseUrl()}/api/portal/certificates/${encodeURIComponent(id)}`,
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
        `${getApiBaseUrl()}/api/portal/certificates/${encodeURIComponent(
          id,
        )}/download`,
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
        `${getApiBaseUrl()}/api/portal/certificates/${encodeURIComponent(
          id,
        )}/reference-standards/${standardId}/certificate/download`,
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

  const verdict = certificate.verdict ?? null;
  const accredited = certificate.accreditation?.accredited ?? false;
  const scalarResults = buildScalarResults(
    certificate.methodSnapshot,
    certificate.results,
  );
  const dueState = describeDueDate(certificate.dueDate);
  const {
    tone: conformityTone,
    label: conformityLabel,
    pointsHint,
  } = summarizeConformity(verdict);

  return (
    <div className="portal-shell-sm space-y-6">
      <Button variant="ghost" size="sm" render={<Link to="/certificates" />}>
        <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
        Certificados
      </Button>

      {/* Quality-record hero — mirrors the lab certificate record */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <span className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
                <span
                  aria-hidden
                  className="absolute inset-1 rounded-full border border-dashed border-emerald-500/40"
                />
                <HugeiconsIcon icon={CheckmarkBadge02Icon} className="size-7" />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Certificado de calibração
                </p>
                <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight tabular-nums">
                  {certificate.jobId}
                </h1>
                <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                  {certificate.serviceName} · emitido por{" "}
                  <span className="text-foreground font-medium">
                    {certificate.labName}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusPill tone="ok">Aprovado</StatusPill>
                  {accredited ? (
                    <StatusPill tone="info">Acreditado RBC</StatusPill>
                  ) : null}
                  {isPaymentPending ? (
                    <StatusPill tone="warning">Liberação pendente</StatusPill>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0 lg:justify-end">
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

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            <StaggerItem>
              <SignalTile
                icon={Target02Icon}
                label="Conformidade"
                value={conformityLabel}
                hint={pointsHint}
                tone={conformityTone}
              />
            </StaggerItem>
            {dueState ? (
              <StaggerItem>
                <SignalTile
                  icon={Calendar03Icon}
                  label="Próxima calibração"
                  value={formatDate(certificate.dueDate)}
                  hint={dueState.hint}
                  tone={dueState.tone}
                />
              </StaggerItem>
            ) : null}
            {verdict?.expandedUncertainty ? (
              <StaggerItem>
                <SignalTile
                  icon={FunctionIcon}
                  label="Incerteza U (máx.)"
                  value={verdict.expandedUncertainty}
                  hint="expandida"
                  tone="neutral"
                />
              </StaggerItem>
            ) : null}
            <StaggerItem>
              <SignalTile
                icon={RulerIcon}
                label="Rastreabilidade"
                value={String(referenceStandards.length)}
                hint="padrões"
                tone={referenceStandards.length > 0 ? "info" : "neutral"}
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={Calendar03Icon}
                label="Aprovado em"
                value={formatDate(certificate.approvedAt)}
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

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

      {/* RBC accreditation seal — the headline trust signal */}
      {accredited ? (
        <Panel className="flex items-center gap-4 p-5">
          <AccreditationSeal
            accreditationNumber={certificate.accreditation?.number ?? null}
            width={72}
          />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground">
              Calibração acreditada ABNT NBR ISO/IEC 17025
            </p>
            <p className="mt-0.5 text-pretty text-muted-foreground">
              Emitido sob o escopo acreditado do laboratório
              {certificate.accreditation?.number
                ? ` (CAL ${certificate.accreditation.number})`
                : ""}
              , com rastreabilidade reconhecida pela Rede Brasileira de
              Calibração.
            </p>
          </div>
        </Panel>
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
            <BlueprintField label="Próxima calibração" mono>
              {formatDate(certificate.dueDate)}
            </BlueprintField>
          </BlueprintGrid>
        </Panel>
      </div>

      {/* Calibration results — the operational outcome */}
      <Panel className="p-5">
        <PanelHeader
          eyebrow="Resultado"
          title="Resultados da calibração"
          description="Veredito de conformidade e valores apurados, congelados na aprovação."
        />
        <div
          className={cn(
            "mt-4 flex items-start gap-3 rounded-xl p-4",
            TONE[conformityTone].surface,
          )}
        >
          <HugeiconsIcon
            icon={
              verdict?.conformity === "NON_CONFORMING"
                ? Alert02Icon
                : CheckmarkCircle02Icon
            }
            className="mt-0.5 size-5 shrink-0"
            strokeWidth={2}
          />
          <div className="min-w-0">
            <p className="font-medium">Resultado: {conformityLabel}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {verdict && verdict.pointsTotal > 0
                ? verdict.conformity === "CONFORMING"
                  ? `Todos os ${verdict.pointsTotal} pontos avaliados estão dentro da tolerância.`
                  : `${verdict.pointsWithin} de ${verdict.pointsTotal} pontos dentro da tolerância.`
                : "Calibração aprovada e registrada como documento de qualidade."}
              {verdict?.expandedUncertainty
                ? ` Incerteza expandida máxima ${verdict.expandedUncertainty}.`
                : ""}
            </p>
          </div>
        </div>
        {scalarResults.length > 0 ? (
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            {scalarResults.map((result) => (
              <BlueprintField key={result.key} label={result.label} mono>
                {result.value}
              </BlueprintField>
            ))}
          </BlueprintGrid>
        ) : null}
      </Panel>

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
              <HugeiconsIcon
                icon={SecurityCheckIcon}
                className="size-5"
                strokeWidth={2}
              />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                Autenticidade e assinatura digital
              </h2>
              <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
                Compartilhe o link público com auditores para comprovar a
                validade, ou confira a integridade da assinatura ICP-Brasil
                abaixo.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleCopyLink}
            className={cn(ACTION_BUTTON_CLASS, "shrink-0")}
          >
            <HugeiconsIcon
              icon={copied ? CheckmarkCircle02Icon : Link01Icon}
              strokeWidth={2}
            />
            {copied ? "Copiado" : "Copiar link"}
          </Button>
        </div>
        <SignatureIntegrity token={certificate.verificationToken} />
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          render={
            <Link
              to="/v/$token"
              params={{ token: certificate.verificationToken }}
            />
          }
        >
          Abrir página de verificação pública
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
        </Button>
      </Panel>
    </div>
  );
}
