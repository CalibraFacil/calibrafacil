import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  File01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AccreditationSeal } from "@/components/accreditation-seal";
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  type SignalTone,
} from "@/components/instrument-panel";

import {
  fetchCertificateDownloadUrl,
  matchCertificateUpload,
  useSignatureVerdict,
  useVerification,
  type SignatureVerdictOverall,
  type VerificationData,
} from "./queries";

type IconType = Parameters<typeof HugeiconsIcon>[0]["icon"];

const TONE_SURFACE: Record<SignalTone, string> = {
  ok: "bg-emerald-500/10",
  critical: "bg-destructive/10",
  warning: "bg-amber-500/10",
  info: "bg-primary/10",
  neutral: "bg-muted/45",
};

const TONE_TEXT: Record<SignalTone, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  critical: "text-destructive",
  warning: "text-amber-700 dark:text-amber-400",
  info: "text-primary",
  neutral: "text-foreground",
};

const TILE_RING =
  "shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-4">{children}</div>
    </div>
  );
}

/** Tonal indicator strip for supersession / amendment / parity notes. */
function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: SignalTone;
  icon: IconType;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl p-4", TILE_RING, TONE_SURFACE[tone])}>
      <p className={cn("flex items-center gap-2 font-medium", TONE_TEXT[tone])}>
        <HugeiconsIcon icon={icon} className="size-4 shrink-0" />
        {title}
      </p>
      {children ? (
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      ) : null}
    </div>
  );
}

function StatusHero({ data }: { data: VerificationData }) {
  const superseded = data.isSuperseded;
  const tone: SignalTone = superseded ? "warning" : "ok";
  const title = superseded
    ? "Certificado substituído"
    : "Certificado autêntico";
  const icon = superseded ? Alert02Icon : CheckmarkCircle02Icon;

  return (
    <Panel className="relative overflow-hidden">
      <BlueprintOverlay />
      <div className="relative flex flex-col items-center gap-3 p-6 text-center">
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full",
            TONE_SURFACE[tone],
          )}
        >
          <HugeiconsIcon
            icon={icon}
            strokeWidth={2}
            className={cn("size-7", TONE_TEXT[tone])}
          />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Verificação de certificado
          </p>
          <h1 className={cn("mt-1 text-xl font-semibold", TONE_TEXT[tone])}>
            {title}
          </h1>
          <p className="mt-1 break-all font-mono text-2xl font-bold tabular-nums text-foreground">
            {data.jobId}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function DownloadButton({ token }: { token: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const url = await fetchCertificateDownloadUrl(token);
      window.location.href = url;
    } catch {
      toast.error("Erro ao baixar certificado");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      onClick={handleDownload}
      disabled={downloading}
      size="lg"
      className={cn("w-full", ACTION_BUTTON_CLASS)}
    >
      {downloading ? (
        <>
          <Spinner className="mr-2 size-4" />
          Baixando...
        </>
      ) : (
        <>
          <HugeiconsIcon icon={Download04Icon} className="mr-2 size-4" />
          Baixar PDF Original
        </>
      )}
    </Button>
  );
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

/** A single boolean integrity check rendered as a tonal instrument tile. */
function VerdictTile({
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
  const value = state === null ? "—" : state ? "OK" : "Falha";
  const icon =
    state === null ? undefined : state ? CheckmarkCircle02Icon : Alert02Icon;
  return (
    <SignalTile
      label={label}
      value={value}
      tone={tone}
      icon={icon}
      hint={hint}
    />
  );
}

/** Lazily-fetched cryptographic verdict for a signed certificate. */
function SignatureIntegrity({ token }: { token: string }) {
  const query = useSignatureVerdict(token, true);

  if (query.isPending) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Verificando integridade da assinatura…
      </div>
    );
  }

  const verdict = query.data?.verdict;
  if (query.isError || !verdict) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Não foi possível verificar a integridade da assinatura no momento.
      </p>
    );
  }

  const tone = OVERALL_TONE[verdict.overall];

  return (
    <div className="mt-4 space-y-3">
      <div className={cn("rounded-xl p-3", TILE_RING, TONE_SURFACE[tone])}>
        <p
          className={cn("flex items-center gap-2 font-medium", TONE_TEXT[tone])}
        >
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
        {/* #646 (PAdES-T): shown only when present — certificates issued before
            the carimbo do tempo feature must not render a failing tile. */}
        {verdict.timestampPresent ? (
          <VerdictTile
            label="Carimbo do tempo"
            state={true}
            hint={verdict.timestamp?.time ?? undefined}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Upload-to-verify: confirm a held PDF is byte-identical to the issued record. */
function UploadMatch({ token }: { token: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mutation = useMutation({
    mutationFn: (file: File) => matchCertificateUpload(token, file),
  });

  const handlePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) mutation.mutate(file);
  };

  const result = mutation.data;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Anti-fraude"
        title="Confira o seu arquivo"
        description="Envie o PDF que você recebeu para conferir se é idêntico ao documento emitido."
      />
      <div className="mt-4">
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={mutation.isPending}
          variant="outline"
          className={cn("w-full", ACTION_BUTTON_CLASS)}
        >
          {mutation.isPending ? (
            <>
              <Spinner className="mr-2 size-4" />
              Conferindo...
            </>
          ) : (
            <>
              <HugeiconsIcon icon={File01Icon} className="mr-2 size-4" />
              Enviar PDF para conferência
            </>
          )}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handlePick}
        />
      </div>
      {mutation.isError ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Não foi possível conferir o arquivo. Tente novamente.
        </p>
      ) : null}
      {result ? (
        <div className="mt-3">
          <SignalTile
            label="Resultado"
            value={result.match ? "Confere" : "Difere"}
            tone={result.match ? "ok" : "critical"}
            icon={result.match ? CheckmarkCircle02Icon : Alert02Icon}
            hint={
              result.match
                ? "Idêntico ao documento emitido"
                : "Este arquivo não corresponde ao registro"
            }
          />
        </div>
      ) : null}
    </Panel>
  );
}

export function VerificationPage({ token }: { token: string }) {
  const query = useVerification(token);

  if (query.isPending) {
    return (
      <PageShell>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="size-8" />
        </div>
      </PageShell>
    );
  }

  if (query.isError || !query.data) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : "Certificado não encontrado ou inválido.";
    return (
      <PageShell>
        <Panel className="relative overflow-hidden">
          <BlueprintOverlay />
          <div className="relative flex flex-col items-center gap-3 p-8 text-center">
            <div
              className={cn(
                "flex size-14 items-center justify-center rounded-full",
                TONE_SURFACE.critical,
              )}
            >
              <HugeiconsIcon
                icon={Alert02Icon}
                strokeWidth={2}
                className={cn("size-7", TONE_TEXT.critical)}
              />
            </div>
            <div>
              <h1 className={cn("text-xl font-semibold", TONE_TEXT.critical)}>
                Certificado inválido
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{message}</p>
            </div>
          </div>
        </Panel>
      </PageShell>
    );
  }

  const data = query.data;
  const signature = data.digitalSignature;

  return (
    <PageShell>
      <StatusHero data={data} />

      <Panel className="p-5">
        <PanelHeader eyebrow="Dados do certificado" title="Identificação" />
        <BlueprintGrid className="mt-4 grid-cols-2">
          <BlueprintField label="Ativo">
            <p className="font-medium">{data.asset.name}</p>
            {data.asset.tag ? (
              <p className="text-xs text-muted-foreground">{data.asset.tag}</p>
            ) : null}
          </BlueprintField>
          <BlueprintField label="Cliente">
            <span className="font-medium">{data.customer}</span>
          </BlueprintField>
          <BlueprintField label="Serviço">
            <span className="font-medium">{data.service}</span>
          </BlueprintField>
          <BlueprintField label="Data" mono>
            {formatDate(data.performedAt)}
          </BlueprintField>
          <BlueprintField label="Laboratório" className="col-span-2">
            <span className="font-medium">{data.lab}</span>
          </BlueprintField>
        </BlueprintGrid>
      </Panel>

      {data.accreditation?.accredited ? (
        <Panel className="flex items-center gap-4 p-5">
          <AccreditationSeal
            accreditationNumber={data.accreditation.number}
            width={72}
          />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              Calibração acreditada NBR ISO/IEC 17025
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Emitido sob o escopo acreditado do laboratório
              {data.accreditation.number
                ? ` (CAL ${data.accreditation.number})`
                : ""}
              .
            </p>
          </div>
        </Panel>
      ) : null}

      {data.isSuperseded ? (
        <Notice
          tone="warning"
          icon={Alert02Icon}
          title="Certificado substituído"
        >
          <p>
            Este certificado foi substituído por uma versão mais recente
            {data.supersededAt ? ` em ${formatDate(data.supersededAt)}` : ""}.
          </p>
          {data.supersededBy ? (
            <Link
              to="/v/$token"
              params={{ token: data.supersededBy.verificationToken }}
              className={cn(
                "mt-1 inline-block font-medium underline",
                TONE_TEXT.warning,
              )}
            >
              Ver versão vigente: {data.supersededBy.jobId}
            </Link>
          ) : null}
        </Notice>
      ) : null}

      {data.isAmendment ? (
        <Notice
          tone="neutral"
          icon={SecurityCheckIcon}
          title={`Retificação${
            data.amendmentNumber ? ` Nº ${data.amendmentNumber}` : ""
          }`}
        >
          {data.amendmentReason ? <p>{data.amendmentReason}</p> : null}
        </Notice>
      ) : null}

      <Panel className="p-5">
        <PanelHeader eyebrow="Autenticidade" title="Assinatura digital" />
        {signature.signed ? (
          <>
            <BlueprintGrid className="mt-4 grid-cols-1 sm:grid-cols-2">
              <BlueprintField label="Signatário">
                <span className="font-medium">
                  {signature.signerName ?? "—"}
                </span>
              </BlueprintField>
              <BlueprintField label="CPF/CNPJ" mono>
                {signature.signerCpfCnpj ?? "—"}
              </BlueprintField>
              <BlueprintField label="Assinado em" mono>
                {formatDate(signature.signedAt)}
              </BlueprintField>
              <BlueprintField label="Série do certificado" mono>
                <span className="break-all text-xs">
                  {signature.certificateSerial ?? "—"}
                </span>
              </BlueprintField>
            </BlueprintGrid>
            <p className="mt-3 text-xs text-muted-foreground">
              Assinatura digital com certificado A1 (PAdES/PKCS#7).
            </p>
            <SignatureIntegrity token={token} />
          </>
        ) : (
          <div
            className={cn(
              "mt-4 rounded-xl p-4 text-sm text-muted-foreground",
              TILE_RING,
              TONE_SURFACE.neutral,
            )}
          >
            Este certificado não possui assinatura digital. A verificação
            criptográfica está disponível para certificados emitidos pela nuvem.
          </div>
        )}
      </Panel>

      {data.hasDocument ? (
        <DownloadButton token={token} />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          Documento ainda não disponível para download.
        </p>
      )}

      {data.hasDocument ? <UploadMatch token={token} /> : null}
    </PageShell>
  );
}
