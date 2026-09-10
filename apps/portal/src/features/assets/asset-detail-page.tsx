import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDiamondIcon,
  ArrowLeft02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  File01Icon,
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
import { DriftChartPanel } from "@/features/reliability/drift-chart-panel";
import { OotAssessmentPanel } from "@/features/reliability/oot-assessment-panel";
import {
  formatSpecificationLabel,
  formatSpecificationValue,
  statusLabels,
} from "./lib";
import { useAssetDetail, useIntervalInsight } from "./queries";
import { IntervalEditorPanel } from "./interval-editor-panel";
import { IntervalInsightPanel } from "./interval-insight-panel";
import { LegalVerificationPanel } from "./legal-verification-panel";
import type { AssetDetail } from "./types";

/**
 * Asset detail. Layout rule: the wide main column carries what needs width or
 * attention (OOT assessment, drift chart, cadastro grids); the 24rem rail
 * carries forms, the read-only analysis and the certificate timeline — narrow
 * by nature. Keeps both columns near the same height for typical assets
 * instead of piling everything operational into the rail.
 */
export function AssetDetailPage({ assetId }: { assetId: string }) {
  const assetQuery = useAssetDetail(assetId);

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
  const latestCertificate = asset.certificates[0];

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
              {asset.status !== "ACTIVE" ? (
                <StatusPill
                  tone={asset.status === "SCRAPPED" ? "critical" : "neutral"}
                >
                  {statusLabels[asset.status]}
                </StatusPill>
              ) : null}
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
          {latestCertificate ? (
            <Link
              to="/certificates/$id"
              params={{ id: latestCertificate.jobId }}
              aria-label={`Última calibração — abrir certificado ${latestCertificate.jobId}`}
              className="group block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <SignalTile
                icon={CheckmarkCircle02Icon}
                label="Última calibração"
                value={formatDate(asset.lastCalibrationDate)}
                hint={latestCertificate.jobId}
                tone="neutral"
                className="h-full transition-shadow group-hover:ring-1 group-hover:ring-foreground/20"
              />
            </Link>
          ) : (
            <SignalTile
              icon={CheckmarkCircle02Icon}
              label="Última calibração"
              value={formatDate(asset.lastCalibrationDate)}
              hint="registrada"
              tone="neutral"
            />
          )}
        </StaggerItem>
        <StaggerItem>
          {certificateCount > 0 ? (
            <Link
              to="/certificates"
              search={{ assetId: asset.id }}
              aria-label={`Ver os ${certificateCount} certificados deste equipamento`}
              className="group block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <SignalTile
                icon={File01Icon}
                label="Certificados"
                value={certificateCount}
                hint="disponíveis · ver todos"
                tone="info"
                className="h-full transition-shadow group-hover:ring-1 group-hover:ring-foreground/20"
              />
            </Link>
          ) : (
            <SignalTile
              icon={File01Icon}
              label="Certificados"
              value={certificateCount}
              hint="disponíveis"
              tone="neutral"
            />
          )}
        </StaggerItem>
      </StaggerGroup>

      {/* Unified reliability warning — the hero pill only answers "am I due?";
          this strip surfaces the drift verdict that used to hide at the bottom
          of the rail. */}
      <DriftAttentionStrip assetId={asset.id} />

      {/* min-w-0 on the columns: a grid item's implicit min-width is
          min-content, and the recharts SVG carries a fixed pixel width once
          measured — without min-w-0 one wide measurement ratchets the column
          past the viewport and it can never shrink back. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {/* Out-of-tolerance impact assessment (ISO 9001 §7.1.5.2) */}
          <OotAssessmentPanel assetId={asset.id} />

          {/* Per-point as-found drift chart (ILAC-G24 Method 2) — width-hungry */}
          <DriftChartPanel assetId={asset.id} />

          {/* Identification */}
          <Panel className="p-5">
            <PanelHeader
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
              <BlueprintField label="Situação">
                {statusLabels[asset.status]}
              </BlueprintField>
              <BlueprintField label="Atualizado em" mono>
                {formatDate(asset.updatedAt)}
              </BlueprintField>
            </BlueprintGrid>
          </Panel>

          {/* Specifications — only when there is something to show */}
          {specifications.length > 0 ? (
            <Panel className="p-5">
              <PanelHeader
                title="Especificações"
                description="Características técnicas usadas no processo de calibração."
              />
              <BlueprintGrid className="mt-4 sm:grid-cols-2">
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
            </Panel>
          ) : null}

          {asset.comments ? (
            <Panel className="p-5">
              <PanelHeader title="Observações" />
              <p className="text-muted-foreground mt-4 text-sm leading-6 text-pretty">
                {asset.comments}
              </p>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          {/* Track 1 — customer-owned calibration interval */}
          <IntervalEditorPanel asset={asset} />

          {/* Track 2 — regulation-fixed legal-metrology verification periodicity */}
          <LegalVerificationPanel asset={asset} />

          {/* Reliability-based interval analysis (read-only) — kept next to the
              editor it feeds */}
          <IntervalInsightPanel
            assetId={asset.id}
            currentIntervalMonths={asset.calibrationIntervalMonths}
          />

          {/* Calibration history */}
          <CalibrationHistoryPanel asset={asset} />
        </div>
      </div>
    </div>
  );
}

function cnDot(tone: SignalTone): string {
  return `size-1.5 shrink-0 rounded-full ${TONE[tone].dot}`;
}

/**
 * Shown only when the reliability engine classifies the asset as DRIFTING —
 * the one place the page says "attention" above the fold, resolving the
 * contradiction of a green "Em dia" hero over a drifting instrument.
 */
function DriftAttentionStrip({ assetId }: { assetId: number }) {
  const insight = useIntervalInsight(assetId).data;
  if (!insight || insight.classification !== "DRIFTING") return null;

  const recommendation = insight.recommendation;
  const suggestion =
    recommendation && recommendation.action === "shorten"
      ? ` Sugestão do motor: encurtar a periodicidade para ${recommendation.proposedIntervalMonths} ${recommendation.proposedIntervalMonths === 1 ? "mês" : "meses"}.`
      : "";

  return (
    <div className="flex items-start gap-3 rounded-xl bg-amber-500/10 p-4 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
      <HugeiconsIcon
        icon={AlertDiamondIcon}
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        strokeWidth={2}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          Deriva detectada no histórico de calibração
        </p>
        <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
          A análise de confiabilidade indica tendência estatisticamente
          significativa em direção ao limite de tolerância — mesmo com a
          calibração dentro do prazo.{suggestion} Veja o gráfico de deriva e a
          análise de periodicidade abaixo.
        </p>
      </div>
    </div>
  );
}

function CalibrationHistoryPanel({ asset }: { asset: AssetDetail }) {
  const certificateCount = asset.certificateCount;
  return (
    <Panel className="p-5">
      <PanelHeader
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
            Nenhum certificado aprovado encontrado para este equipamento. Use a
            solicitação de calibração para enviar este equipamento ao
            laboratório.
          </div>
        )}
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Panel className="p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-4 h-56 w-full rounded-xl" />
          </Panel>
          <Panel className="p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-4 h-40 w-full rounded-xl" />
          </Panel>
        </div>
        <div className="min-w-0 space-y-6">
          <Panel className="p-5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="mt-4 h-48 w-full rounded-xl" />
          </Panel>
          <Panel className="p-5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-4 h-40 w-full rounded-xl" />
          </Panel>
        </div>
      </div>
    </div>
  );
}
