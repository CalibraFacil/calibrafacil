import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  AlertDiamondIcon,
  ArrowRight01Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DashboardSquare01Icon,
  DownloadCircle01Icon,
  File01Icon,
  FlaskConicalIcon,
  Invoice01Icon,
  Notebook01Icon,
  RefreshIcon,
  ToolsIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { cn } from "@/lib/utils";
import {
  getCalibrationStatus,
  type CalibrationFilter,
} from "@/lib/calibration-status";
import { formatDate, pluralize } from "@/lib/format";
import { getRequestStatus, getServiceOrderStatus } from "@/lib/status-labels";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from "@/components/instrument-panel";
import { useOotEvents } from "@/features/reliability/queries";
import {
  useOverview,
  useUnitSummary,
  type OverviewCertificate,
  type PortalOverview,
  type UnitSummaryItem,
} from "./queries";

/** Tonal surface + icon classes, matching instrument-panel's SignalTone maps. */
const TONE_SURFACE: Record<SignalTone, string> = {
  ok: "bg-emerald-500/10",
  critical: "bg-destructive/10",
  warning: "bg-amber-500/10",
  info: "bg-primary/10",
  neutral: "bg-muted/45",
};

const TONE_ICON: Record<SignalTone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  critical: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-primary",
  neutral: "text-muted-foreground",
};

export function DashboardPage() {
  const { data, isLoading, isError, isFetching, refetch } = useOverview();

  return (
    <div className="portal-shell space-y-5">
      {/* Command hero */}
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Operação · status em tempo real
              </p>
            </div>
            <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Sua operação de calibração
            </h1>
            <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
              O que precisa de você agora: priorize o que venceu, aprove
              orçamentos e baixe certificados liberados.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={cn("size-4", isFetching && "animate-spin")}
              />
              Atualizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={<Link to="/assets" />}
            >
              <HugeiconsIcon
                icon={DashboardSquare01Icon}
                strokeWidth={2}
                className="size-4"
              />
              Equipamentos
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 transition-transform active:scale-[0.96]"
              render={<Link to="/certificates" />}
            >
              <HugeiconsIcon
                icon={File01Icon}
                strokeWidth={2}
                className="size-4"
              />
              Certificados
            </Button>
            <Button
              size="sm"
              className={cn(ACTION_BUTTON_CLASS, "min-h-10")}
              render={<Link to="/requests/new" />}
            >
              <HugeiconsIcon
                icon={Add01Icon}
                strokeWidth={2}
                className="size-4"
              />
              Solicitar calibração
            </Button>
          </div>
        </div>
      </Panel>

      {isLoading ? (
        <DashboardSkeleton />
      ) : isError || !data ? (
        <Panel className="p-5">
          <div className="flex flex-col items-start gap-3">
            <p className="font-medium">Não foi possível carregar o painel</p>
            <p className="text-pretty text-sm text-muted-foreground">
              Tente novamente em instantes. Se o problema continuar, fale com o
              laboratório.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className="size-4"
              />
              Tentar novamente
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <ComplianceVitals equipment={data.equipment} />
          <UnitBreakdown />
          <AttentionPanel data={data} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
            <RecentCertificates certificates={data.certificates} />
            <div className="space-y-5">
              <OpenRequests requests={data.requests} />
              <ActiveServiceOrders serviceOrders={data.serviceOrders} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-unit breakdown — only meaningful for a consolidated (group) cockpit     */
/* -------------------------------------------------------------------------- */

function UnitBreakdown() {
  const { data } = useUnitSummary();
  const units = data?.units ?? [];
  // Single-customer portals have nothing to break down.
  if (units.length <= 1) return null;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Rede"
        title="Por unidade"
        description="Situação de calibração de cada unidade do grupo, da mais crítica para a menos."
      />
      <div className="mt-4 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
        {units.map((unit, index) => (
          <UnitRow key={unit.id} unit={unit} divider={index > 0} />
        ))}
      </div>
    </Panel>
  );
}

function UnitRow({
  unit,
  divider,
}: {
  unit: UnitSummaryItem;
  divider: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3",
        divider && "border-border/60 border-t",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{unit.name}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {pluralize(unit.total, "instrumento", "instrumentos")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {unit.overdue > 0 ? (
          <StatusPill tone="critical" size="sm">
            {unit.overdue} vencidas
          </StatusPill>
        ) : null}
        {unit.dueSoon > 0 ? (
          <StatusPill tone="warning" size="sm">
            {unit.dueSoon} a vencer
          </StatusPill>
        ) : null}
        {unit.overdue === 0 && unit.dueSoon === 0 ? (
          <StatusPill tone="ok" size="sm">
            Em dia
          </StatusPill>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Compliance vitals — the 5-second "am I compliant?" read                    */
/* -------------------------------------------------------------------------- */

function ComplianceVitals({
  equipment,
}: {
  equipment: PortalOverview["equipment"];
}) {
  const total = equipment.total;
  const denominator = total || 1;
  const pct = (value: number) => `${(value / denominator) * 100}%`;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Conformidade"
        title="Status da frota"
        description="Distribuição dos seus instrumentos por situação de calibração."
        action={
          <Button variant="ghost" size="sm" render={<Link to="/assets" />}>
            Ver equipamentos
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
        }
      />

      {/* Compliance ribbon */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="font-mono text-2xl font-semibold leading-none tabular-nums">
          {total}
        </p>
        <p className="text-sm text-muted-foreground">
          {total > 0
            ? pluralize(total, "instrumento", "instrumentos")
            : "Nenhum instrumento cadastrado"}
        </p>
      </div>
      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="bg-destructive transition-[width] duration-500"
          style={{ width: pct(equipment.overdue) }}
        />
        <div
          className="bg-amber-500 transition-[width] duration-500"
          style={{ width: pct(equipment.dueSoon) }}
        />
        <div
          className="bg-emerald-500 transition-[width] duration-500"
          style={{ width: pct(equipment.scheduled) }}
        />
      </div>

      {/* Vitals tiles */}
      <StaggerGroup className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StaggerItem>
          <VitalTileLink
            icon={Alert02Icon}
            label="Vencidas"
            value={equipment.overdue}
            tone={equipment.overdue > 0 ? "critical" : "ok"}
            dueStatus="overdue"
          />
        </StaggerItem>
        <StaggerItem>
          <VitalTileLink
            icon={Clock01Icon}
            label="Vencem em breve"
            value={equipment.dueSoon}
            tone={equipment.dueSoon > 0 ? "warning" : "neutral"}
            dueStatus="due_soon"
          />
        </StaggerItem>
        <StaggerItem>
          <VitalTileLink
            icon={CheckmarkCircle02Icon}
            label="Em dia"
            value={equipment.scheduled}
            tone={equipment.scheduled > 0 ? "ok" : "neutral"}
            dueStatus="scheduled"
          />
        </StaggerItem>
        <StaggerItem>
          <VitalTileLink
            icon={FlaskConicalIcon}
            label="No laboratório"
            value={equipment.inLab}
            tone={equipment.inLab > 0 ? "info" : "neutral"}
            dueStatus="in_lab"
          />
        </StaggerItem>
        <StaggerItem>
          <VitalTileLink
            icon={Calendar03Icon}
            label="Sem agenda"
            value={equipment.unscheduled}
            tone="neutral"
            dueStatus="unscheduled"
          />
        </StaggerItem>
      </StaggerGroup>
    </Panel>
  );
}

function VitalTileLink({
  icon,
  label,
  value,
  tone,
  dueStatus,
}: {
  icon: IconSvgElement;
  label: string;
  value: number;
  tone: SignalTone;
  dueStatus: CalibrationFilter;
}) {
  return (
    <Link
      to="/assets"
      search={{ dueStatus }}
      className="group block rounded-xl transition-transform focus-visible:outline-none active:scale-[0.98]"
    >
      <SignalTile
        icon={icon}
        label={label}
        value={value}
        tone={tone}
        className="transition-shadow group-hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)] dark:group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
      />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Attention panel — "what needs me now"                                      */
/* -------------------------------------------------------------------------- */

function AttentionPanel({ data }: { data: PortalOverview }) {
  const overdueItems = data.equipment.attention
    .filter(
      (item) =>
        getCalibrationStatus(item.nextCalibrationDate).status === "OVERDUE",
    )
    .slice(0, 4);
  const moreOverdue = data.equipment.overdue - overdueItems.length;
  const quotes = data.serviceOrders.awaitingQuote.slice(0, 4);
  const rejected = data.requests.rejected;

  // Out-of-tolerance events awaiting the customer's §7.1.5.2 impact assessment.
  const ootQuery = useOotEvents("OPEN");
  const ootOpen = ootQuery.data ?? [];
  const ootItems = ootOpen.slice(0, 3);

  const actionCount =
    ootOpen.length +
    data.equipment.overdue +
    quotes.length +
    (rejected > 0 ? 1 : 0);

  if (actionCount === 0) {
    return (
      <Panel className="p-5">
        <div className="flex items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="size-6"
              strokeWidth={2}
            />
          </span>
          <div className="space-y-0.5">
            <p className="font-medium">Tudo em dia</p>
            <p className="text-pretty text-sm text-muted-foreground">
              Nenhuma calibração vencida, avaliação de impacto pendente,
              orçamento pendente ou solicitação recusada no momento.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Ação necessária"
        title="Precisa de atenção"
        action={
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {actionCount}
          </span>
        }
      />
      <div className="mt-4 space-y-1">
        {ootItems.map((event) => (
          <ActionRow
            key={`oot-${event.id}`}
            to="/assets/$id"
            params={{ id: String(event.assetId) }}
            tone="critical"
            icon={AlertDiamondIcon}
            pulse
            title={`Avaliar impacto: ${event.assetTag}`}
            subtitle={`Reprovado como recebido na calibração ${event.jobIdentifier}`}
          />
        ))}

        {overdueItems.map((item) => {
          const status = getCalibrationStatus(item.nextCalibrationDate);
          return (
            <ActionRow
              key={`asset-${item.id}`}
              to="/assets/$id"
              params={{ id: String(item.id) }}
              tone="critical"
              icon={Wrench01Icon}
              pulse
              title={item.name}
              subtitle={`${item.tag} · ${status.description}`}
            />
          );
        })}

        {moreOverdue > 0 ? (
          <ActionRow
            to="/assets"
            search={{ dueStatus: "overdue" }}
            tone="critical"
            icon={Alert02Icon}
            title={`Ver todos os ${data.equipment.overdue} equipamentos vencidos`}
            subtitle="Calibração em atraso — priorize o reenvio"
          />
        ) : null}

        {quotes.map((order) => (
          <ActionRow
            key={`quote-${order.id}`}
            to="/service-orders/$id"
            params={{ id: order.publicId }}
            tone="warning"
            icon={Invoice01Icon}
            title={`Orçamento da ${order.serviceOrderNumber}`}
            subtitle={`${order.assetName ?? "Instrumento"} · aguarda sua aprovação`}
          />
        ))}

        {rejected > 0 ? (
          <ActionRow
            to="/requests"
            search={{ status: "REJECTED" }}
            tone="critical"
            icon={Notebook01Icon}
            title={pluralize(
              rejected,
              "solicitação recusada",
              "solicitações recusadas",
            )}
            subtitle="Revise os motivos e reenvie ao laboratório"
          />
        ) : null}
      </div>
    </Panel>
  );
}

type ActionRowProps = {
  tone: SignalTone;
  icon: IconSvgElement;
  title: string;
  subtitle: string;
  pulse?: boolean;
} & (
  | { to: "/assets/$id"; params: { id: string }; search?: never }
  | { to: "/service-orders/$id"; params: { id: string }; search?: never }
  | { to: "/assets"; search: { dueStatus: "overdue" }; params?: never }
  | { to: "/requests"; search: { status: "REJECTED" }; params?: never }
);

function ActionRow({
  tone,
  icon,
  title,
  subtitle,
  pulse,
  ...link
}: ActionRowProps) {
  return (
    <Link
      {...link}
      className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-[background-color,box-shadow] hover:bg-muted/60 hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
    >
      <span
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center rounded-lg",
          TONE_SURFACE[tone],
          TONE_ICON[tone],
        )}
      >
        <HugeiconsIcon icon={icon} className="size-[18px]" strokeWidth={2} />
        {pulse ? (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-card" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        className="size-4 shrink-0 text-muted-foreground/60 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Recent certificates                                                        */
/* -------------------------------------------------------------------------- */

function certificateState(certificate: OverviewCertificate): {
  tone: SignalTone;
  label: string;
} {
  if (certificate.ready) return { tone: "ok", label: "Disponível" };
  if (certificate.releaseStatus === "PAYMENT_PENDING")
    return { tone: "warning", label: "Liberação pendente" };
  return { tone: "neutral", label: "Gerando PDF" };
}

function RecentCertificates({
  certificates,
}: {
  certificates: PortalOverview["certificates"];
}) {
  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Documentos"
        title="Certificados recentes"
        description={
          certificates.available > 0
            ? pluralize(
                certificates.available,
                "certificado disponível",
                "certificados disponíveis",
              )
            : "Aprovados pelo laboratório."
        }
        action={
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/certificates" />}
          >
            Ver todos
          </Button>
        }
      />
      <div className="mt-4">
        {certificates.recent.length > 0 ? (
          <StaggerGroup className="space-y-1">
            {certificates.recent.map((certificate) => {
              const state = certificateState(certificate);
              return (
                <StaggerItem key={certificate.id}>
                  <Link
                    to="/certificates/$id"
                    params={{ id: certificate.jobId }}
                    className="group flex min-h-16 items-center gap-3 rounded-xl px-3 py-2.5 transition-[background-color,box-shadow] hover:bg-muted/60 hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <HugeiconsIcon
                        icon={File01Icon}
                        className="size-5"
                        strokeWidth={2}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-semibold tabular-nums">
                        {certificate.jobId}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {certificate.assetName} · {certificate.assetTag}
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm tabular-nums text-muted-foreground">
                        {formatDate(certificate.approvedAt)}
                      </p>
                      <StatusPill tone={state.tone} size="sm" className="mt-1">
                        {state.label}
                      </StatusPill>
                    </div>
                    {certificate.ready ? (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs transition-colors group-hover:text-foreground">
                        <HugeiconsIcon
                          icon={DownloadCircle01Icon}
                          className="size-4"
                          strokeWidth={2}
                        />
                      </span>
                    ) : (
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className="size-4 shrink-0 text-muted-foreground/60 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-foreground"
                      />
                    )}
                  </Link>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        ) : (
          <EmptyHint
            icon={File01Icon}
            title="Nenhum certificado ainda"
            description="Quando o laboratório aprovar uma calibração, o certificado aparece aqui."
          />
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* In-progress: requests + service orders                                     */
/* -------------------------------------------------------------------------- */

function OpenRequests({ requests }: { requests: PortalOverview["requests"] }) {
  const open = requests.recent
    .filter(
      (request) =>
        request.status === "PENDING" || request.status === "UNDER_REVIEW",
    )
    .slice(0, 4);

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Atendimento"
        title="Solicitações abertas"
        action={
          <Button variant="ghost" size="xs" render={<Link to="/requests" />}>
            Ver todas
          </Button>
        }
      />
      <div className="mt-4">
        {open.length > 0 ? (
          <StaggerGroup className="space-y-1">
            {open.map((request) => {
              const status = getRequestStatus(request.status);
              return (
                <StaggerItem key={request.id}>
                  <Link
                    to="/requests/$id"
                    params={{ id: String(request.id) }}
                    className="group flex min-h-12 items-center justify-between gap-2 rounded-lg px-3 py-2 transition-[background-color] hover:bg-muted/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        Solicitação{" "}
                        <span className="font-mono tabular-nums">
                          #{request.id}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {pluralize(request.itemCount, "ativo", "ativos")} ·{" "}
                        {formatDate(request.submittedAt)}
                      </p>
                    </div>
                    <StatusPill tone={status.tone} size="sm">
                      {status.label}
                    </StatusPill>
                  </Link>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        ) : (
          <EmptyHint
            icon={Notebook01Icon}
            title="Nenhuma solicitação aberta"
            description="Crie uma solicitação para enviar instrumentos ao laboratório."
          />
        )}
      </div>
    </Panel>
  );
}

function ActiveServiceOrders({
  serviceOrders,
}: {
  serviceOrders: PortalOverview["serviceOrders"];
}) {
  const recent = serviceOrders.recent.slice(0, 4);

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="Manutenção"
        title="Serviços em andamento"
        action={
          <Button
            variant="ghost"
            size="xs"
            render={<Link to="/service-orders" />}
          >
            Ver todas
          </Button>
        }
      />
      <div className="mt-4">
        {recent.length > 0 ? (
          <StaggerGroup className="space-y-1">
            {recent.map((order) => {
              const status = getServiceOrderStatus(order.status);
              return (
                <StaggerItem key={order.id}>
                  <Link
                    to="/service-orders/$id"
                    params={{ id: String(order.id) }}
                    className="group flex min-h-12 items-center justify-between gap-2 rounded-lg px-3 py-2 transition-[background-color] hover:bg-muted/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium tabular-nums">
                        {order.serviceOrderNumber}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {order.assetName ?? "Instrumento"}
                      </p>
                    </div>
                    <StatusPill tone={status.tone} size="sm">
                      {status.label}
                    </StatusPill>
                  </Link>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        ) : (
          <EmptyHint
            icon={ToolsIcon}
            title="Nenhum serviço em andamento"
            description="Instrumentos recebidos para reparo aparecem aqui."
          />
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function EmptyHint({
  icon,
  title,
  description,
}: {
  icon: IconSvgElement;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl bg-muted/30 p-6 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
        <HugeiconsIcon icon={icon} className="size-5" strokeWidth={2} />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-pretty text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, index) => (
          <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <div className="space-y-5">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
