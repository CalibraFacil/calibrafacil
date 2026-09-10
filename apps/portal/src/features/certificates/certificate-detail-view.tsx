import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Call02Icon,
  CheckmarkBadge02Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  Link01Icon,
  Location01Icon,
  Mail01Icon,
  RulerIcon,
  SecurityCheckIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

/**
 * Amendment chain info (ISO/IEC 17025 §7.8.8) attached by
 * GET /api/portal/certificates/:id. Neighbour links are only present once the
 * neighbour is itself an issued, portal-visible certificate.
 */
export type CertificateAmendment = {
  isAmendment: boolean;
  isSuperseded: boolean;
  amendmentNumber: number | null;
  amendmentReason: string | null;
  supersededAt: string | null;
  supersedes: { id: number; jobId: string } | null;
  supersededBy: {
    id: number;
    jobId: string;
    amendmentNumber: number | null;
    approvedAt: string | null;
  } | null;
  chain: Array<{
    id: number;
    jobId: string;
    amendmentNumber: number | null;
    approvedAt: string | null;
    isCurrent: boolean;
  }>;
};

export type Certificate = {
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
  assetPublicId: string;
  assetName: string;
  assetTag: string;
  assetManufacturer: string | null;
  assetModel: string | null;
  assetSerialNumber: string;
  serviceName: string;
  labName: string;
  labLogo: string | null;
  labEmail: string | null;
  labPhone: string | null;
  accreditation?: {
    accredited: boolean;
    number: string | null;
  };
  amendment?: CertificateAmendment | null;
  onSite?: {
    executedOnSite: boolean;
    addressText: string | null;
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
  REVOKED: "critical",
  UNVERIFIABLE: "warning",
};

const OVERALL_STRIP_LABEL: Record<SignatureVerdictOverall, string> = {
  VALID: "Assinatura íntegra",
  ALTERED: "Documento alterado",
  UNSIGNED: "Sem assinatura",
  REVOKED: "Certificado revogado",
  UNVERIFIABLE: "Não confirmada",
};

/** A subtle vertical divider between inline strip items. */
function StripSep() {
  return <span aria-hidden className="bg-foreground/15 h-3 w-px shrink-0" />;
}

/**
 * One inline integrity check: a tiny tone-colored glyph + short label. The check
 * names are cryptographic jargon for a customer, so each carries an optional
 * plain-language tooltip (hover/keyboard-focus, no extra space in the strip).
 */
function CheckItem({
  label,
  state,
  falseTone = "critical",
  hint,
}: {
  label: string;
  state: boolean | null;
  falseTone?: SignalTone;
  hint?: string;
}) {
  const tone: SignalTone =
    state === null ? "neutral" : state ? "ok" : falseTone;
  const icon =
    state === null ? undefined : state ? CheckmarkCircle02Icon : Alert02Icon;
  const inner = (
    <>
      {icon ? (
        <HugeiconsIcon icon={icon} strokeWidth={2.5} className="size-3.5" />
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {label}
    </>
  );
  const className = cn(
    "inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap",
    TONE[tone].text,
    hint && "cursor-help",
  );
  if (!hint) {
    return <span className={className}>{inner}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>
        {inner}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-relaxed">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Authenticity status strip — a slim, Vercel-style status bar for the ICP-Brasil
 * signature verdict, fetched from the public verification endpoint by token.
 * Collapses what used to be a half-page 2×2 tile grid into one line.
 */
function SignatureStrip({ token }: { token: string }) {
  const query = useSignatureVerdict(token, true);
  const data = query.data;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <span className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner className="size-3.5" />
        Verificando assinatura…
      </span>
    );
  } else if (query.isError || !data || !data.signed || !data.verdict) {
    body = (
      <span className="text-muted-foreground text-sm">
        Sem assinatura digital criptográfica
      </span>
    );
  } else {
    const verdict = data.verdict;
    const tone = OVERALL_TONE[verdict.overall];
    body = (
      <>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-sm font-medium",
            TONE[tone].text,
          )}
        >
          <span
            className={cn("size-2 shrink-0 rounded-full", TONE[tone].dot)}
          />
          {OVERALL_STRIP_LABEL[verdict.overall]}
        </span>
        {verdict.signer.commonName ? (
          <span className="text-muted-foreground max-w-[16rem] truncate text-xs">
            por {verdict.signer.commonName}
          </span>
        ) : null}
        <StripSep />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <CheckItem
            label="Conteúdo"
            state={verdict.hashMatch}
            hint="O conteúdo do certificado não foi alterado depois de assinado."
          />
          <CheckItem
            label="Assinatura"
            state={verdict.signatureCryptographicallyValid}
            hint="A assinatura digital é válida e foi conferida criptograficamente."
          />
          <CheckItem
            label="ICP-Brasil"
            state={verdict.signerChainsToIcpRoot}
            falseTone="warning"
            hint="Assinado com certificado ICP-Brasil — a infraestrutura oficial de chaves públicas do Brasil."
          />
          <CheckItem
            label="Validade"
            state={verdict.certNotExpiredAtCheckDate}
            falseTone="warning"
            hint="O certificado de assinatura estava válido na data em que o documento foi assinado."
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 shrink-0 px-2 text-xs"
          render={<Link to="/v/$token" params={{ token }} />}
        >
          Abrir verificação
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </Button>
      </>
    );
  }

  return (
    <Panel className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5">
          <HugeiconsIcon
            icon={SecurityCheckIcon}
            className="size-4"
            strokeWidth={2}
          />
          <span className="font-mono text-[11px] font-medium tracking-[0.16em] uppercase">
            Autenticidade
          </span>
        </span>
        {body}
      </div>
    </Panel>
  );
}

/**
 * Amendment banner (ISO/IEC 17025 §7.8.8) — a superseded certificate must be
 * unmistakably flagged, and a retificação must reference the original it
 * replaces (with the reason for the change).
 */
function AmendmentNotice({ amendment }: { amendment: CertificateAmendment }) {
  if (amendment.isSuperseded) {
    const replacement = amendment.supersededBy;
    return (
      <Alert variant="warning">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
        <AlertTitle>Certificado substituído</AlertTitle>
        <AlertDescription>
          <p>
            {replacement ? (
              <>
                Este certificado foi substituído pela retificação
                {replacement.amendmentNumber
                  ? ` nº ${replacement.amendmentNumber}`
                  : ""}{" "}
                (
                <span className="font-mono tabular-nums">
                  {replacement.jobId}
                </span>
                )
              </>
            ) : (
              <>
                Este certificado foi substituído por uma nova emissão, que será
                disponibilizada no portal assim que concluída
              </>
            )}
            {amendment.supersededAt
              ? ` em ${formatDate(amendment.supersededAt)}`
              : ""}
            . Não o utilize como referência.
          </p>
          {amendment.amendmentReason ? (
            <p className="mt-1">Motivo: {amendment.amendmentReason}</p>
          ) : null}
          {replacement ? (
            <Link
              to="/certificates/$id"
              params={{ id: replacement.jobId }}
              className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-2"
            >
              Ver versão vigente
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            </Link>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (amendment.isAmendment) {
    const original = amendment.supersedes;
    return (
      <Alert variant="info">
        <HugeiconsIcon icon={SecurityCheckIcon} strokeWidth={2} />
        <AlertTitle>
          Retificação
          {amendment.amendmentNumber ? ` nº ${amendment.amendmentNumber}` : ""}
        </AlertTitle>
        <AlertDescription>
          <p>
            {original ? (
              <>
                Substitui o certificado{" "}
                <span className="font-mono tabular-nums">{original.jobId}</span>
                .
              </>
            ) : (
              <>Substitui uma emissão anterior deste certificado.</>
            )}
          </p>
          {amendment.amendmentReason ? (
            <p className="mt-1">Motivo: {amendment.amendmentReason}</p>
          ) : null}
          {original ? (
            <Link
              to="/certificates/$id"
              params={{ id: original.jobId }}
              className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-2"
            >
              Ver certificado substituído
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            </Link>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}

/**
 * Compact emission-chain timeline, shown when a certificate was re-amended
 * (chain longer than original + one retificação).
 */
function AmendmentChainTimeline({
  chain,
  viewedId,
}: {
  chain: CertificateAmendment["chain"];
  viewedId: number;
}) {
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        title="Histórico de emissões"
        description="Cadeia de retificações deste certificado, da emissão original à versão vigente."
      />
      <ol className="mt-4">
        {chain.map((member, index) => {
          const tone: SignalTone = member.isCurrent ? "ok" : "neutral";
          const isViewed = member.id === viewedId;
          return (
            <li key={member.id} className="relative flex gap-3 pb-4 last:pb-0">
              {index < chain.length - 1 ? (
                <span
                  aria-hidden
                  className="bg-foreground/15 absolute top-4 left-[5px] h-full w-px"
                />
              ) : null}
              <span
                aria-hidden
                className={cn(
                  "relative mt-1.5 size-[11px] shrink-0 rounded-full",
                  TONE[tone].dot,
                )}
              />
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  {isViewed ? (
                    <span className="font-mono font-medium tabular-nums">
                      {member.jobId}
                    </span>
                  ) : (
                    <Link
                      to="/certificates/$id"
                      params={{ id: member.jobId }}
                      className="font-mono tabular-nums underline underline-offset-2"
                    >
                      {member.jobId}
                    </Link>
                  )}
                  {member.isCurrent ? (
                    <StatusPill tone="ok" size="sm">
                      Vigente
                    </StatusPill>
                  ) : (
                    <StatusPill tone="neutral" size="sm" dot={false}>
                      Substituído
                    </StatusPill>
                  )}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {member.amendmentNumber
                    ? `Retificação nº ${member.amendmentNumber}`
                    : "Emissão original"}
                  {member.approvedAt
                    ? ` · aprovado em ${formatDate(member.approvedAt)}`
                    : ""}
                  {isViewed ? " · este certificado" : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/**
 * Presentational certificate detail. The route adapter fetches the certificate
 * and passes it in.
 */
export function CertificateDetailView({
  certificate,
}: {
  certificate: Certificate;
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingStandardId, setDownloadingStandardId] = useState<
    number | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  const referenceStandards = certificate.referenceStandards ?? [];
  const isPaymentPending = certificate.releaseStatus === "PAYMENT_PENDING";
  const canDownload = Boolean(certificate.certificateUrl);
  const certPath = encodeURIComponent(certificate.jobId);

  const handleDownload = async () => {
    if (isDownloading || !certificate.certificateUrl) return;
    setIsDownloading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates/${certPath}/download`,
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
        `${getApiBaseUrl()}/api/portal/certificates/${certPath}/reference-standards/${standardId}/certificate/download`,
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

  // Customer-facing: just the method name — the internal "vX.Y" revision is
  // engineering detail that lives on the PDF, not the portal summary.
  const method = certificate.methodSnapshot?.name || "—";

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
  const amendment = certificate.amendment ?? null;

  return (
    <div className="portal-shell space-y-6">
      <Button variant="ghost" size="sm" render={<Link to="/certificates" />}>
        <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
        Certificados
      </Button>

      {/* §7.8.8 — supersession / retificação must be the first thing read. */}
      {amendment && (amendment.isSuperseded || amendment.isAmendment) ? (
        <AmendmentNotice amendment={amendment} />
      ) : null}

      {/* Quality-record header */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              {accredited ? (
                <div
                  className="shrink-0"
                  title="Calibração acreditada ABNT NBR ISO/IEC 17025"
                >
                  <AccreditationSeal
                    accreditationNumber={
                      certificate.accreditation?.number ?? null
                    }
                    width={78}
                  />
                </div>
              ) : (
                <span className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
                  <span
                    aria-hidden
                    className="absolute inset-1 rounded-full border border-dashed border-emerald-500/40"
                  />
                  <HugeiconsIcon
                    icon={CheckmarkBadge02Icon}
                    className="size-7"
                  />
                </span>
              )}
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Certificado de calibração
                </p>
                <h1 className="text-balance font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {certificate.jobId}
                </h1>
                <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                  {certificate.serviceName} · emitido por{" "}
                  <span className="text-foreground font-medium">
                    {certificate.labName}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* Verdict-derived — never a green "Aprovado" on a non-conforming cert. */}
                  <StatusPill tone={conformityTone}>
                    {conformityLabel}
                  </StatusPill>
                  {amendment?.isSuperseded ? (
                    <StatusPill tone="warning">Substituído</StatusPill>
                  ) : amendment?.isAmendment ? (
                    <StatusPill tone="info">
                      Retificação nº {amendment.amendmentNumber ?? 1}
                    </StatusPill>
                  ) : null}
                  {accredited ? (
                    <StatusPill tone="info">Acreditado RBC</StatusPill>
                  ) : null}
                  {isPaymentPending ? (
                    <StatusPill tone="warning">Liberação pendente</StatusPill>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
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
                className={ACTION_BUTTON_CLASS}
                render={
                  <Link
                    to="/requests/new"
                    search={{ assetIds: [certificate.assetId] }}
                  />
                }
              >
                <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} />
                Agendar próxima calibração
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

          {/* The three KPIs a customer actually opens this page for. Color is
              reserved for exceptions — only conformity + a due/overdue date tint. */}
          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
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
            <StaggerItem>
              <SignalTile
                icon={RulerIcon}
                label="Rastreabilidade"
                value={String(referenceStandards.length)}
                hint="padrões rastreáveis"
                tone="neutral"
              />
            </StaggerItem>
            {certificate.onSite?.executedOnSite ? (
              <StaggerItem>
                <SignalTile
                  icon={Location01Icon}
                  label="Local da calibração"
                  value="No local (em loco)"
                  hint={certificate.onSite.addressText ?? "no cliente"}
                  tone="info"
                />
              </StaggerItem>
            ) : null}
          </StaggerGroup>
        </div>
      </Panel>

      {/* Authenticity — Vercel-style status strip */}
      <SignatureStrip token={certificate.verificationToken} />

      {/* Re-amended chains get the full emission history. */}
      {amendment && amendment.chain.length > 2 ? (
        <AmendmentChainTimeline
          chain={amendment.chain}
          viewedId={certificate.id}
        />
      ) : null}

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
        <Panel className="p-5 sm:p-6">
          <PanelHeader title="Equipamento calibrado" />
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
                params={{ id: certificate.assetPublicId }}
              />
            }
          >
            Ver equipamento
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
        </Panel>

        {/* Calibration */}
        <Panel className="p-5 sm:p-6">
          <PanelHeader title="Serviço, método e datas" />
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            <BlueprintField label="Serviço" className="sm:col-span-2">
              {certificate.serviceName}
            </BlueprintField>
            <BlueprintField label="Método" className="sm:col-span-2">
              {method}
            </BlueprintField>
            <BlueprintField label="Data de execução" mono>
              {formatDate(certificate.performedAt)}
            </BlueprintField>
            <BlueprintField label="Aprovado em" mono>
              {formatDate(certificate.approvedAt)}
            </BlueprintField>
          </BlueprintGrid>
        </Panel>
      </div>

      {/* Calibration results — the operational outcome */}
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          title="Resultados da calibração"
          description="Veredito de conformidade e valores apurados, registrados na data de aprovação."
        />
        <div
          className={cn(
            "mt-4 flex items-start gap-3 rounded-xl p-4",
            "shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]",
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
          <Collapsible
            open={techOpen}
            onOpenChange={setTechOpen}
            className="mt-4"
          >
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors focus-visible:outline-none"
                />
              }
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className={cn(
                  "size-4 transition-transform",
                  techOpen && "rotate-180",
                )}
              />
              Detalhes técnicos
            </CollapsibleTrigger>
            <CollapsibleContent>
              <BlueprintGrid className="mt-3 sm:grid-cols-2">
                {scalarResults.map((result) => (
                  <BlueprintField key={result.key} label={result.label} mono>
                    {result.value}
                  </BlueprintField>
                ))}
              </BlueprintGrid>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </Panel>

      {/* Reference standards (traceability) */}
      <Panel className="p-5 sm:p-6">
        <PanelHeader
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

      {/* Lab contact — a quiet path back to the issuing laboratory */}
      {certificate.labEmail || certificate.labPhone ? (
        <div className="text-muted-foreground flex flex-col gap-3 border-t border-foreground/10 px-1 pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-pretty">
            Dúvidas sobre este certificado? Fale com{" "}
            <span className="text-foreground font-medium">
              {certificate.labName}
            </span>
            .
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {certificate.labEmail ? (
              <a
                href={`mailto:${certificate.labEmail}`}
                className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
              >
                <HugeiconsIcon
                  icon={Mail01Icon}
                  className="size-4"
                  strokeWidth={2}
                />
                {certificate.labEmail}
              </a>
            ) : null}
            {certificate.labPhone ? (
              <a
                href={`tel:${certificate.labPhone.replace(/[^\d+]/g, "")}`}
                className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
              >
                <HugeiconsIcon
                  icon={Call02Icon}
                  className="size-4"
                  strokeWidth={2}
                />
                {certificate.labPhone}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
