import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
                      <Link
                        to="/certificates"
                        search={{ assetId: asset.id }}
                      />
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
