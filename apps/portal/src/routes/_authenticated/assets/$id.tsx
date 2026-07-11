import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  File01Icon,
  InformationCircleIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, TONE } from "@/components/status-pill";
import { Timeline } from "@/components/timeline";
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
import { getInstrumentStatus } from "@/lib/calibration-status";
import { formatDate } from "@/lib/format";
import { getApiBaseUrl } from "@/lib/utils";
import { DriftChartPanel } from "@/features/reliability/drift-chart-panel";
import { OotAssessmentPanel } from "@/features/reliability/oot-assessment-panel";

export const Route = createFileRoute("/_authenticated/assets/$id")({
  component: AssetDetailPage,
});

type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

type AssetCertificate = {
  id: number;
  jobId: string;
  certificateName: string | null;
  status: string;
  performedAt: string | null;
  approvedAt: string | null;
  certificateUrl: string | null;
  verificationToken: string;
  serviceName: string;
  labName: string;
};

type AssetDetail = {
  id: number;
  customerId: number;
  customerName: string;
  assetTypeId: number;
  assetTypeName: string;
  assetTypeSlug: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string;
  tag: string;
  status: AssetStatus;
  specifications: Record<string, unknown> | null;
  lastCalibrationDate: string | null;
  nextCalibrationDate: string | null;
  // Track 1 — customer-owned calibration interval (periodicity). The customer sets it
  // here for EVERY regime (§7.8.4.3 + ILAC-G24); the lab never attributes it.
  calibrationIntervalMonths: number | null;
  intervalSetBy: "customer_confirmed" | "engine_applied" | null;
  // Track 2 — legal-metrology regime + the regulation-fixed VERIFICATION periodicity
  // (independent of Track 1; lab-recorded, read-only for the customer).
  metrologyRegime: "INDUSTRIAL" | "LEGAL" | "UNKNOWN";
  regulatedInterval: {
    kind:
      | "fixed_months"
      | "max_months_from_install"
      | "per_technology"
      | "not_nationally_fixed";
    regulationReference: string;
    operationalizedByDelegate: boolean;
  } | null;
  nextLegalVerificationDate: string | null;
  inLab: boolean;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
  certificates: Array<AssetCertificate>;
  /** Total approved certificates; `certificates` holds only the 5 newest. */
  certificateCount: number;
};

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  MAINTENANCE: "Manutenção",
  SCRAPPED: "Descartado",
};

function formatSpecificationValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value))
    return value.map(formatSpecificationValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const specificationLabels: Record<string, string> = {
  capacity: "Capacidade",
  humidityRangeMax: "Faixa de umidade máx.",
  humidityRangeMin: "Faixa de umidade mín.",
  humidityResolution: "Resolução de umidade",
  immersionDepth: "Profundidade de imersão",
  immersionType: "Tipo de imersão",
  instrumentType: "Tipo",
  jawType: "Tipo de bico",
  linearity: "Linearidade",
  rangeMax: "Faixa máx.",
  rangeMin: "Faixa mín.",
  repeatability: "Repetitividade",
  resolution: "Resolução",
  scaleDivision: "Divisão de escala",
  tempRangeMax: "Faixa de temperatura máx.",
  tempRangeMin: "Faixa de temperatura mín.",
  tempResolution: "Resolução de temperatura",
  weighingRanges: "Faixas de pesagem",
};

function formatSpecificationLabel(key: string): string {
  if (specificationLabels[key]) return specificationLabels[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toLocaleUpperCase("pt-BR"));
}

function AssetDetailPage() {
  const { id } = Route.useParams();

  const assetQuery = useQuery({
    queryKey: ["portal-asset", id],
    queryFn: async (): Promise<AssetDetail> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${id}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar ativo.");
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- portal asset endpoint returns the AssetDetail DTO.
      const result = (await response.json()) as { data: AssetDetail };
      return result.data;
    },
  });

  if (assetQuery.isLoading) {
    return <AssetDetailSkeleton />;
  }

  const asset = assetQuery.data;

  if (assetQuery.error || !asset) {
    return (
      <div className="portal-shell">
        <Panel className="p-6">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Instrumento
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            Equipamento não encontrado
          </h1>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            O equipamento não está disponível para este acesso.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              render={<Link to="/assets" />}
              className={ACTION_BUTTON_CLASS}
            >
              <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
              Voltar
            </Button>
            <Button
              variant="ghost"
              onClick={() => assetQuery.refetch()}
              className={ACTION_BUTTON_CLASS}
            >
              Tentar novamente
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const calibration = getInstrumentStatus(asset);
  const specifications = Object.entries(asset.specifications ?? {});
  const certificateCount = asset.certificateCount;

  return (
    <div className="portal-shell space-y-6">
      {/* Hero */}
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/assets" />}
              className={ACTION_BUTTON_CLASS}
            >
              <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
              Equipamentos
            </Button>
            <div className="mt-4 flex items-center gap-2">
              <span className={cnDot(calibration.tone)} aria-hidden />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Instrumento · {asset.assetTypeName}
              </p>
            </div>
            <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              {asset.name}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm text-pretty">
              Tag <span className="font-mono tabular-nums">{asset.tag}</span>
              {" · "}Série{" "}
              <span className="font-mono tabular-nums">
                {asset.serialNumber}
              </span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusPill
                tone={calibration.tone}
                pulse={calibration.tone === "critical"}
              >
                {calibration.label}
              </StatusPill>
              <Badge variant="secondary">{asset.assetTypeName}</Badge>
            </div>
          </div>

          <Button
            render={
              <Link to="/requests/new" search={{ assetIds: [asset.id] }} />
            }
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={Wrench01Icon} strokeWidth={2} />
            Solicitar calibração
          </Button>
        </div>
      </Panel>

      {/* Vitals */}
      <StaggerGroup className="grid gap-3 sm:grid-cols-3">
        <StaggerItem>
          <SignalTile
            icon={Calendar03Icon}
            label="Próxima calibração"
            value={formatDate(asset.nextCalibrationDate)}
            hint={calibration.description}
            tone={calibration.tone}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={CheckmarkCircle02Icon}
            label="Última calibração"
            value={formatDate(asset.lastCalibrationDate)}
            hint="registrada"
            tone="neutral"
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={File01Icon}
            label="Certificados"
            value={certificateCount}
            hint="disponíveis"
            tone={certificateCount > 0 ? "info" : "neutral"}
          />
        </StaggerItem>
      </StaggerGroup>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          {/* Out-of-tolerance impact assessment (ISO 9001 §7.1.5.2) */}
          <OotAssessmentPanel assetId={asset.id} />

          {/* Identification */}
          <Panel className="p-5">
            <PanelHeader
              eyebrow="Cadastro"
              title="Identificação"
              description="Dados principais do instrumento cadastrado."
            />
            <BlueprintGrid className="mt-4 sm:grid-cols-2">
              <BlueprintField label="Fabricante">
                {asset.manufacturer?.trim() || "—"}
              </BlueprintField>
              <BlueprintField label="Modelo">
                {asset.model?.trim() || "—"}
              </BlueprintField>
              <BlueprintField label="Número de série" mono>
                {asset.serialNumber.trim() || "—"}
              </BlueprintField>
              <BlueprintField label="Tag" mono>
                {asset.tag.trim() || "—"}
              </BlueprintField>
              <BlueprintField label="Cliente">
                {asset.customerName.trim() || "—"}
              </BlueprintField>
              <BlueprintField label="Atualizado em" mono>
                {formatDate(asset.updatedAt)}
              </BlueprintField>
            </BlueprintGrid>
          </Panel>

          {/* Specifications */}
          <Panel className="p-5">
            <PanelHeader
              eyebrow="Técnico"
              title="Especificações"
              description="Características técnicas usadas no processo de calibração."
            />
            <div className="mt-4">
              {specifications.length > 0 ? (
                <BlueprintGrid className="sm:grid-cols-2">
                  {specifications.map(([key, value]) => (
                    <BlueprintField
                      key={key}
                      label={formatSpecificationLabel(key)}
                      mono
                    >
                      {formatSpecificationValue(value)}
                    </BlueprintField>
                  ))}
                </BlueprintGrid>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Nenhuma especificação registrada.
                </p>
              )}
            </div>
          </Panel>

          {asset.comments ? (
            <Panel className="p-5">
              <PanelHeader eyebrow="Notas" title="Observações" />
              <p className="text-muted-foreground mt-4 text-sm leading-6 text-pretty">
                {asset.comments}
              </p>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          {/* Track 1 — customer-owned calibration interval */}
          <IntervalEditorPanel asset={asset} />

          {/* Track 2 — regulation-fixed legal-metrology verification periodicity */}
          <LegalVerificationPanel asset={asset} />

          {/* Reliability-based interval analysis (read-only) */}
          <IntervalInsightPanel assetId={asset.id} />

          {/* Per-point as-found drift chart (ILAC-G24 Method 2) */}
          <DriftChartPanel assetId={asset.id} />

          {/* Calibration history */}
          <Panel className="p-5">
            <PanelHeader
              eyebrow="Rastreabilidade"
              title="Histórico de calibrações"
              description="Certificados aprovados, do mais recente ao mais antigo."
              action={
                certificateCount > asset.certificates.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    render={
                      <Link to="/certificates" search={{ assetId: asset.id }} />
                    }
                    className={ACTION_BUTTON_CLASS}
                  >
                    Ver todos ({certificateCount})
                  </Button>
                ) : undefined
              }
            />
            <div className="mt-4">
              {asset.certificates.length > 0 ? (
                <Timeline
                  items={asset.certificates.map((certificate) => ({
                    title: (
                      <Link
                        to="/certificates/$id"
                        params={{ id: certificate.jobId }}
                        className="font-mono tabular-nums hover:underline"
                      >
                        {certificate.jobId}
                      </Link>
                    ),
                    description: certificate.serviceName,
                    meta: formatDate(certificate.approvedAt),
                    state: "done",
                    tone: "ok",
                    icon: File01Icon,
                  }))}
                />
              ) : (
                <div className="bg-muted/45 text-muted-foreground rounded-xl p-4 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
                  Nenhum certificado aprovado encontrado para este equipamento.
                </div>
              )}
            </div>
          </Panel>

          {/* Operational summary */}
          <Panel className="p-5">
            <PanelHeader
              eyebrow="Operação"
              title="Resumo operacional"
              description="Informações rápidas para acompanhamento."
            />
            <BlueprintGrid className="mt-4 sm:grid-cols-2">
              <BlueprintField label="Tipo">
                {asset.assetTypeName}
              </BlueprintField>
              <BlueprintField label="Situação">
                {statusLabels[asset.status]}
              </BlueprintField>
              <BlueprintField label="Criado em" mono>
                {formatDate(asset.createdAt)}
              </BlueprintField>
              <BlueprintField label="Atualizado em" mono>
                {formatDate(asset.updatedAt)}
              </BlueprintField>
            </BlueprintGrid>
            <div className="bg-muted/45 mt-4 rounded-xl p-4 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
              <div className="flex items-start gap-3">
                <HugeiconsIcon
                  icon={InformationCircleIcon}
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  strokeWidth={2}
                />
                <p className="text-muted-foreground text-sm text-pretty">
                  Use a solicitação de calibração para enviar este equipamento
                  ao laboratório junto com outros instrumentos da organização.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function cnDot(tone: SignalTone): string {
  return `size-1.5 shrink-0 rounded-full ${TONE[tone].dot}`;
}

type IntervalInsight = {
  classification: "INSUFFICIENT_DATA" | "STABLE" | "DRIFTING";
  reliability: number | null;
  coverage: number;
  recommendation: {
    action: "extend" | "keep" | "shorten";
    method: string;
    proposedIntervalMonths: number;
    reliabilityBound: number | null;
  } | null;
  series: Array<{
    approvedAt: string;
    conformity: "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";
    minMargin: number | null;
  }>;
  engineVersion: string;
  fingerprint: string;
};

const CLASSIFICATION_META: Record<
  IntervalInsight["classification"],
  { label: string; tone: SignalTone }
> = {
  STABLE: { label: "Estável", tone: "ok" },
  DRIFTING: { label: "Derivando", tone: "warning" },
  INSUFFICIENT_DATA: { label: "Dados insuficientes", tone: "neutral" },
};

const ACTION_LABEL: Record<
  NonNullable<IntervalInsight["recommendation"]>["action"],
  string
> = { extend: "Estender", keep: "Manter", shorten: "Encurtar" };

/**
 * Read-only reliability-based interval analysis (ILAC-G24 / NCSL RP-1). It only
 * SUGGESTS — the customer applies via the editor above (§7.8.4.3). Regime-agnostic: a
 * legal-metrology asset is analyzed like any other; its regulation-fixed verification
 * periodicity is a separate, read-only track (see the legal-verification panel).
 */
function IntervalInsightPanel({ assetId }: { assetId: number }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["portal-interval-insight", assetId],
    queryFn: async (): Promise<IntervalInsight> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${assetId}/interval-insight`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Falha ao carregar a análise.");
      return response.json();
    },
  });
  const insight = query.data;

  // REQ-ENGINE-APPLY: one-click apply the suggestion (writes engine_applied + an
  // auditable rationale citing the method). The customer clicking IS their agreement.
  const applyMutation = useMutation({
    mutationFn: async () => {
      const recommendation = insight?.recommendation;
      if (!recommendation) return;
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${assetId}/interval`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intervalMonths: recommendation.proposedIntervalMonths,
            rationale: `Sugestão do motor de confiabilidade (ILAC-G24 / NCSL RP-1) aplicada — ${insight?.classification}, método ${recommendation.method}.`,
            source: "engine",
          }),
        },
      );
      if (!response.ok) {
        throw new Error("Não foi possível aplicar a sugestão.");
      }
    },
    onSuccess: () => {
      toast.success("Periodicidade atualizada a partir da sugestão.");
      queryClient.invalidateQueries({ queryKey: ["portal-asset"] });
      queryClient.invalidateQueries({ queryKey: ["portal-interval-insight"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!insight) return null;
  const meta = CLASSIFICATION_META[insight.classification];

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Programa metrológico"
        title="Análise de periodicidade"
        description="Sugestão baseada no histórico de calibração (ILAC-G24 / NCSL RP-1). Apenas indicativo — você decide."
      />
      <div className="mt-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className={cnDot(meta.tone)} aria-hidden />
          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        </div>

        {insight.reliability !== null ? (
          <BlueprintGrid className="sm:grid-cols-2">
            <BlueprintField label="Confiabilidade" mono>
              {(insight.reliability * 100).toFixed(0)}%
            </BlueprintField>
            <BlueprintField label="Cobertura" mono>
              {(insight.coverage * 100).toFixed(0)}%
            </BlueprintField>
          </BlueprintGrid>
        ) : null}

        {insight.recommendation ? (
          <div className="bg-muted/45 rounded-xl p-4 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
            Sugestão:{" "}
            <strong>
              {ACTION_LABEL[insight.recommendation.action]} para{" "}
              {insight.recommendation.proposedIntervalMonths}{" "}
              {insight.recommendation.proposedIntervalMonths === 1
                ? "mês"
                : "meses"}
            </strong>
            .
            {insight.recommendation.action === "keep" ? (
              " A periodicidade atual já está adequada."
            ) : (
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => applyMutation.mutate()}
                  disabled={applyMutation.isPending}
                  className={ACTION_BUTTON_CLASS}
                >
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
                  {applyMutation.isPending ? "Aplicando…" : "Aplicar sugestão"}
                </Button>
              </div>
            )}
          </div>
        ) : insight.classification === "INSUFFICIENT_DATA" ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Histórico insuficiente para uma sugestão (mín. 3 calibrações com
            dados de conformidade).
          </p>
        ) : null}

        <div>
          <Button
            variant="ghost"
            size="sm"
            render={
              <a
                href={`${getApiBaseUrl()}/api/portal/assets/${assetId}/interval-insight/report`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
            Baixar relatório
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Track 2 — the regulation-fixed legal-metrology VERIFICATION periodicity (read-only),
 * shown only for LEGAL instruments and INDEPENDENT of the customer-owned calibration
 * interval. The date is INDICATIVE when the Ipem runs the cadence
 * (operationalizedByDelegate) and absent for `not_nationally_fixed` (REQ-MLR-060/061/062).
 */
function LegalVerificationPanel({ asset }: { asset: AssetDetail }) {
  if (asset.metrologyRegime !== "LEGAL") return null;
  const regulated = asset.regulatedInterval;
  const noNationalPeriod =
    !regulated ||
    regulated.kind === "not_nationally_fixed" ||
    !asset.nextLegalVerificationDate;
  const indicative = regulated?.operationalizedByDelegate ?? false;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Metrologia legal"
        title="Verificação — metrologia legal"
        description="Periodicidade fixada por regulamento (Inmetro / RBMLQ-I) — definida pela regulamentação, não editável."
      />
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Calendar03Icon}
            className="text-muted-foreground size-4 shrink-0"
            strokeWidth={2}
          />
          <span className="text-sm">
            Próxima verificação:{" "}
            <span className="font-mono tabular-nums">
              {noNationalPeriod
                ? "sem periodicidade nacional fixada"
                : formatDate(asset.nextLegalVerificationDate)}
            </span>
          </span>
        </div>
        {indicative && !noNationalPeriod ? (
          <p className="text-muted-foreground text-xs text-pretty">
            Cadência operacionalizada pelo Ipem — data indicativa, não é prazo
            nacional fixo.
          </p>
        ) : null}
        {regulated ? (
          <p className="text-muted-foreground text-xs text-pretty">
            {regulated.regulationReference}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Customer-owned calibration interval (periodicity) editor. The interval is the
 * equipment owner's decision, not the lab's (ISO/IEC 17025:2017 §7.8.4.3 +
 * ILAC-G24 / OIML D 10), for EVERY regime — there is no legal-metrology lock (a legal
 * instrument's regulation-fixed verification periodicity is shown by
 * LegalVerificationPanel). The customer sets months + a mandatory rationale (the §7.5
 * technical record); submission is blocked without it (REQ-INTERVAL-040/041).
 */
function IntervalEditorPanel({ asset }: { asset: AssetDetail }) {
  const queryClient = useQueryClient();
  const [months, setMonths] = useState(
    asset.calibrationIntervalMonths != null
      ? String(asset.calibrationIntervalMonths)
      : "",
  );
  const [rationale, setRationale] = useState("");

  const mutation = useMutation({
    mutationFn: async (input: {
      intervalMonths: number;
      rationale: string;
    }) => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${asset.id}/interval`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error("Não foi possível salvar a periodicidade.");
      }
    },
    onSuccess: () => {
      toast.success("Periodicidade atualizada.");
      setRationale("");
      queryClient.invalidateQueries({ queryKey: ["portal-asset"] });
      queryClient.invalidateQueries({ queryKey: ["portal-assets"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // REQ-MLR-040: the customer owns the calibration interval for EVERY regime — there is
  // no legal-metrology lock here. A legal instrument's regulation-fixed verification
  // periodicity is shown separately by LegalVerificationPanel (read-only).
  const monthsValue = Number(months);
  const monthsValid =
    Number.isInteger(monthsValue) && monthsValue >= 1 && monthsValue <= 120;
  const canSubmit =
    monthsValid && rationale.trim().length > 0 && !mutation.isPending;

  const currentLabel =
    asset.calibrationIntervalMonths != null
      ? `${asset.calibrationIntervalMonths} ${asset.calibrationIntervalMonths === 1 ? "mês" : "meses"} · definida por você`
      : "aguardando definição do cliente";

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Programa metrológico"
        title="Periodicidade de calibração"
        description="Você define com que frequência este instrumento deve ser recalibrado — o laboratório não atribui periodicidade."
      />
      <div className="mt-4 space-y-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Calendar03Icon}
            className="text-muted-foreground size-4 shrink-0"
            strokeWidth={2}
          />
          <span className="text-sm">
            Atual:{" "}
            <span className="font-mono tabular-nums">{currentLabel}</span>
          </span>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            mutation.mutate({
              intervalMonths: monthsValue,
              rationale: rationale.trim(),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="interval-months">Intervalo (meses)</Label>
            <Input
              id="interval-months"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              value={months}
              onChange={(event) => setMonths(event.target.value)}
              placeholder="Ex.: 12"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="interval-rationale">Justificativa</Label>
            <Textarea
              id="interval-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="Motivo (histórico de estabilidade, recomendação do fabricante, intensidade de uso…)."
              rows={3}
            />
            <p className="text-muted-foreground text-xs text-pretty">
              A justificativa fica registrada no histórico do equipamento.
            </p>
          </div>
          <Button
            type="submit"
            disabled={!canSubmit}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
            {mutation.isPending ? "Salvando…" : "Salvar periodicidade"}
          </Button>
        </form>
      </div>
    </Panel>
  );
}

function AssetDetailSkeleton() {
  return (
    <div className="portal-shell space-y-6">
      <Panel className="p-5 sm:p-6">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-4 h-4 w-40" />
        <Skeleton className="mt-3 h-9 w-72 max-w-full" />
        <Skeleton className="mt-3 h-5 w-96 max-w-full" />
      </Panel>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Panel className="p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-40 w-full rounded-xl" />
        </Panel>
        <Panel className="p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-40 w-full rounded-xl" />
        </Panel>
      </div>
    </div>
  );
}
