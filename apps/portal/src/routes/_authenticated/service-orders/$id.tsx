import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  File01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  type SignalTone,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { Timeline, type TimelineItem } from "@/components/timeline";
import {
  FinancialSummaryCard,
  isFinancialSummary,
  type PortalFinancialSummary,
} from "@/features/service-orders/financial-summary-card";
import { getServiceOrderStatus } from "@/lib/status-labels";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/service-orders/$id")({
  component: ServiceOrderDetailPage,
});

type QuoteItem = {
  id: number;
  type: string;
  description: string;
  quantity: string | number;
  unit: string;
  unitPriceCents: number;
  totalPriceCents: number;
  warrantyCovered: boolean;
};

type ExecutionItem = {
  id: number;
  type: string;
  description: string;
  quantity: string | number;
  unit: string;
  unitPriceCents: number;
  totalPriceCents: number;
};

type ServiceOrderDetail = {
  id: number;
  serviceOrderNumber: string;
  status: string;
  openedAt: string;
  evaluatedAt?: string | null;
  repairStartedAt?: string | null;
  repairFinishedAt?: string | null;
  readyAt?: string | null;
  deliveredAt?: string | null;
  deliveredToName?: string | null;
  deliveryNotes?: string | null;
  claimedDefect: string | null;
  intakeCondition: string | null;
  accessories: string | null;
  clientVisibleNotes: string | null;
  removedSealingMarkNumber?: string | null;
  affixedSealingMarkNumber?: string | null;
  inmetroRepairMarkNumber?: string | null;
  inmetroRepairMarkNotes?: string | null;
  warrantyUntil?: string | null;
  warrantyTerms?: string | null;
  assetSnapshot?: {
    assetName?: string | null;
    assetType?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    patrimonyNumber?: string | null;
  } | null;
  evaluations?: Array<{
    id: number;
    diagnosis: string | null;
    detectedIssues: string | null;
    clientVisibleNotes: string | null;
    evaluatedAt: string | null;
  }>;
  execution?: {
    id: number;
    startedAt: string | null;
    finishedAt: string | null;
    servicePerformed: string | null;
    partsUsedSummary: string | null;
    technicalNotes: string | null;
    result: string | null;
    calibrationRequiredAfterRepair?: boolean;
    items?: Array<ExecutionItem>;
  } | null;
  quotes?: Array<{
    id: number;
    quoteNumber: string;
    version: number;
    status: string;
    totalCents: number;
    validUntil: string | null;
    clientMessage: string | null;
    warrantyTerms: string | null;
    items?: Array<QuoteItem>;
  }>;
  intakeDocuments?: Array<{
    id: number;
    documentNumber: string;
    version: number;
    pdfR2Key: string | null;
  }>;
  deliveryDocuments?: Array<{
    id: number;
    documentNumber: string;
    version: number;
    pdfR2Key: string | null;
  }>;
  certificateLinks?: Array<{
    id: number;
    certificateJobId: number;
    jobId?: string | null;
  }>;
  events?: Array<{ id: number; eventType: string; createdAt: string }>;
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  service: "Serviço",
  part: "Peça",
  external_service: "Serviço externo",
  freight: "Frete",
  discount: "Desconto",
  evaluation_fee: "Taxa de avaliação",
  other: "Outro",
};

const RESULT_META: Record<string, { label: string; tone: SignalTone }> = {
  repaired: { label: "Reparado", tone: "ok" },
  not_repaired: { label: "Não reparado", tone: "critical" },
  condemned: { label: "Condenado", tone: "critical" },
  returned_without_service: { label: "Devolvido sem serviço", tone: "neutral" },
  sent_to_third_party: { label: "Enviado a terceiros", tone: "warning" },
};

// Customer-relevant events only; operational noise (views, status_changed,
// tag_printed, email/finance) is filtered out of the timeline.
const EVENT_META: Record<string, { label: string; tone: SignalTone }> = {
  "service_order.created": { label: "Ordem de serviço aberta", tone: "info" },
  "service_order.technician_assigned": {
    label: "Técnico designado",
    tone: "info",
  },
  "service_order.intake_document_issued": {
    label: "Comprovante de entrada emitido",
    tone: "info",
  },
  "service_order.evaluation_started": {
    label: "Avaliação iniciada",
    tone: "info",
  },
  "service_order.evaluation_completed": {
    label: "Avaliação concluída",
    tone: "info",
  },
  "service_order.quote_created": { label: "Orçamento criado", tone: "info" },
  "service_order.quote_sent": {
    label: "Orçamento enviado para aprovação",
    tone: "warning",
  },
  "service_order.quote_approved_by_client": {
    label: "Orçamento aprovado por você",
    tone: "ok",
  },
  "service_order.quote_approved_manually": {
    label: "Orçamento aprovado",
    tone: "ok",
  },
  "service_order.quote_rejected_by_client": {
    label: "Orçamento recusado por você",
    tone: "critical",
  },
  "service_order.quote_rejected_manually": {
    label: "Orçamento recusado",
    tone: "critical",
  },
  "service_order.repair_started": { label: "Reparo iniciado", tone: "info" },
  "service_order.repair_finished": {
    label: "Reparo concluído",
    tone: "info",
  },
  "service_order.repair_mark_updated": {
    label: "Marca de Reparo atualizada",
    tone: "info",
  },
  "service_order.ready_for_pickup": {
    label: "Pronta para retirada",
    tone: "ok",
  },
  "service_order.delivered": { label: "Entregue", tone: "ok" },
  "service_order.closed": { label: "Encerrada", tone: "neutral" },
  "service_order.reopened": { label: "Reaberta", tone: "warning" },
  "service_order.canceled": { label: "Cancelada", tone: "critical" },
  "service_order.certificate_linked": {
    label: "Certificado vinculado",
    tone: "ok",
  },
  "service_order.delivery_document_issued": {
    label: "Comprovante de entrega emitido",
    tone: "info",
  },
};

function ServiceOrderDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [rejectionReason, setRejectionReason] = useState("");

  const orderQuery = useQuery({
    queryKey: ["portal-service-order", id],
    queryFn: async (): Promise<ServiceOrderDetail> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/service-orders/${id}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar ordem de serviço.");
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("data" in result)) {
        throw new Error("Resposta inválida.");
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- portal SO endpoint returns the ServiceOrderDetail DTO.
      return result.data as ServiceOrderDetail;
    },
  });

  const financialSummaryQuery = useQuery({
    queryKey: ["portal-service-order", id, "financial-summary"],
    queryFn: async (): Promise<PortalFinancialSummary> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/service-orders/${id}/financial-summary`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar informações financeiras.");
      }
      const result: unknown = await response.json();
      const data =
        result && typeof result === "object" && "data" in result
          ? result.data
          : null;
      if (!isFinancialSummary(data)) {
        throw new Error("Resposta financeira inválida.");
      }
      return data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (quoteId: number) => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/service-orders/${id}/quotes/${quoteId}/approve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) throw new Error("Falha ao aprovar orçamento.");
      return response.json();
    },
    onSuccess: async () => {
      toast.success("Orçamento aprovado.");
      await queryClient.invalidateQueries({
        queryKey: ["portal-service-order", id],
      });
      await queryClient.invalidateQueries({ queryKey: ["portal-overview"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erro ao aprovar.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (quoteId: number) => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/service-orders/${id}/quotes/${quoteId}/reject`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rejectionReason }),
        },
      );
      if (!response.ok) throw new Error("Falha ao recusar orçamento.");
      return response.json();
    },
    onSuccess: async () => {
      toast.success("Orçamento recusado.");
      setRejectionReason("");
      await queryClient.invalidateQueries({
        queryKey: ["portal-service-order", id],
      });
      await queryClient.invalidateQueries({ queryKey: ["portal-overview"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erro ao recusar.");
    },
  });

  const order = orderQuery.data;

  if (orderQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="portal-shell-sm space-y-4">
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/service-orders" />}
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
          Manutenção
        </Button>
        <Card>
          <CardContent className="text-destructive py-12 text-center">
            Ordem de serviço não encontrada ou indisponível para este acesso.
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = getServiceOrderStatus(order.status);
  const latestQuote = order.quotes?.[0];
  const latestEvaluation = order.evaluations?.[0];
  const execution = order.execution;
  const canAnswerQuote = latestQuote?.status === "sent";

  const seals = [
    {
      label: "Marca de selagem retirada",
      value: order.removedSealingMarkNumber,
    },
    { label: "Marca de selagem aposta", value: order.affixedSealingMarkNumber },
    {
      label: "Marca de Reparo",
      value: order.inmetroRepairMarkNumber,
    },
  ].filter((seal) => seal.value?.trim());

  const timeline: Array<TimelineItem> = [...(order.events ?? [])]
    .filter((event) => EVENT_META[event.eventType])
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map((event, index, all) => {
      const meta = EVENT_META[event.eventType];
      return {
        title: meta.label,
        meta: formatDateTime(event.createdAt),
        tone: meta.tone,
        state: index === all.length - 1 ? "current" : "done",
      };
    });

  return (
    <div className="portal-shell space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/service-orders" />}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
            Manutenção
          </Button>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
              {order.serviceOrderNumber}
            </h1>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Entrada em{" "}
            <span className="font-mono tabular-nums">
              {formatDate(order.openedAt)}
            </span>
          </p>
        </div>
      </div>

      {/* Quote awaiting the customer's decision — surfaced at the top */}
      {canAnswerQuote && latestQuote ? (
        <Panel className="ring-warning/40 p-5">
          <PanelHeader
            title="Orçamento aguardando sua aprovação"
            description={`${latestQuote.quoteNumber} · validade ${formatDate(latestQuote.validUntil)}`}
            action={
              <span className="text-warning font-mono text-xl font-semibold tabular-nums">
                {formatCurrency(latestQuote.totalCents)}
              </span>
            }
          />
          <div className="mt-4 space-y-3">
            <QuoteItems items={latestQuote.items} />
            {latestQuote.clientMessage?.trim() ? (
              <TextBlock
                label="Mensagem do laboratório"
                value={latestQuote.clientMessage}
              />
            ) : null}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button
                className="flex-1 active:scale-[0.98]"
                onClick={() => approveMutation.mutate(latestQuote.id)}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
                Aprovar orçamento
              </Button>
            </div>
            <Textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Motivo da recusa (opcional)"
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => rejectMutation.mutate(latestQuote.id)}
              disabled={approveMutation.isPending || rejectMutation.isPending}
            >
              Recusar orçamento
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
        {/* Main column — the repair story */}
        <div className="space-y-5">
          <Panel className="p-5">
            <PanelHeader
              title="Equipamento recebido"
              description="Dados congelados no recebimento da OS."
            />
            <BlueprintGrid className="mt-4 sm:grid-cols-2">
              <BlueprintField label="Instrumento">
                {order.assetSnapshot?.assetName || "—"}
              </BlueprintField>
              <BlueprintField label="Tipo">
                {order.assetSnapshot?.assetType || "—"}
              </BlueprintField>
              <BlueprintField label="Fabricante">
                {order.assetSnapshot?.manufacturer || "—"}
              </BlueprintField>
              <BlueprintField label="Modelo">
                {order.assetSnapshot?.model || "—"}
              </BlueprintField>
              <BlueprintField label="Série" mono>
                {order.assetSnapshot?.serialNumber || "—"}
              </BlueprintField>
              <BlueprintField label="Patrimônio" mono>
                {order.assetSnapshot?.patrimonyNumber || "—"}
              </BlueprintField>
            </BlueprintGrid>
          </Panel>

          <Panel className="p-5">
            <PanelHeader title="Defeito e condição" />
            <div className="mt-4 space-y-4">
              <TextBlock
                label="Defeito reclamado"
                value={order.claimedDefect}
              />
              <TextBlock
                label="Condição aparente"
                value={order.intakeCondition}
              />
              <TextBlock label="Acessórios" value={order.accessories} />
              <TextBlock label="Observações" value={order.clientVisibleNotes} />
            </div>
          </Panel>

          {latestEvaluation ? (
            <Panel className="p-5">
              <PanelHeader
                title="Diagnóstico"
                description={
                  latestEvaluation.evaluatedAt
                    ? `Avaliado em ${formatDate(latestEvaluation.evaluatedAt)}`
                    : undefined
                }
              />
              <div className="mt-4 space-y-4">
                <TextBlock
                  label="Diagnóstico"
                  value={latestEvaluation.diagnosis}
                />
                <TextBlock
                  label="Problemas detectados"
                  value={latestEvaluation.detectedIssues}
                />
                <TextBlock
                  label="Observações"
                  value={latestEvaluation.clientVisibleNotes}
                />
              </div>
            </Panel>
          ) : null}

          {execution ? (
            <Panel className="p-5">
              <PanelHeader
                title="Reparo realizado"
                description={
                  execution.finishedAt
                    ? `Concluído em ${formatDate(execution.finishedAt)}`
                    : execution.startedAt
                      ? `Iniciado em ${formatDate(execution.startedAt)}`
                      : undefined
                }
                action={
                  execution.result && RESULT_META[execution.result] ? (
                    <StatusPill tone={RESULT_META[execution.result].tone}>
                      {RESULT_META[execution.result].label}
                    </StatusPill>
                  ) : null
                }
              />
              <div className="mt-4 space-y-4">
                <TextBlock
                  label="Serviço realizado"
                  value={execution.servicePerformed}
                />
                <TextBlock
                  label="Peças utilizadas"
                  value={execution.partsUsedSummary}
                />
                <TextBlock
                  label="Notas técnicas"
                  value={execution.technicalNotes}
                />

                {execution.items && execution.items.length > 0 ? (
                  <div>
                    <p className="text-muted-foreground font-mono text-[11px] font-medium uppercase tracking-[0.1em]">
                      Itens do reparo
                    </p>
                    <div className="mt-2 space-y-1">
                      {execution.items.map((item) => (
                        <LineItem key={item.id} item={item} />
                      ))}
                    </div>
                  </div>
                ) : null}

                {execution.calibrationRequiredAfterRepair ? (
                  <p className="text-muted-foreground bg-muted/40 rounded-lg p-2.5 text-xs">
                    Recalibração recomendada após o reparo.
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : null}

          {seals.length > 0 ? (
            <Panel className="p-5">
              <PanelHeader
                title="Marcas de Reparo e de Selagem"
                description="Marcas de selagem do instrumento, incluindo a Marca de Reparo do Inmetro quando aplicável."
              />
              <BlueprintGrid className="mt-4 sm:grid-cols-2">
                {seals.map((seal) => (
                  <BlueprintField key={seal.label} label={seal.label} mono>
                    {seal.value}
                  </BlueprintField>
                ))}
              </BlueprintGrid>
              {order.inmetroRepairMarkNotes?.trim() ? (
                <p className="text-muted-foreground mt-3 text-xs text-pretty">
                  {order.inmetroRepairMarkNotes}
                </p>
              ) : null}
            </Panel>
          ) : null}

          {order.warrantyUntil || order.warrantyTerms?.trim() ? (
            <Panel className="p-5">
              <PanelHeader title="Cobertura do serviço" />
              <div className="mt-4 space-y-4">
                {order.warrantyUntil ? (
                  <BlueprintGrid className="sm:grid-cols-2">
                    <BlueprintField label="Garantia até" mono>
                      {formatDate(order.warrantyUntil)}
                    </BlueprintField>
                  </BlueprintGrid>
                ) : null}
                <TextBlock label="Termos" value={order.warrantyTerms} />
              </div>
            </Panel>
          ) : null}
        </div>

        {/* Sidebar — timeline, money, documents */}
        <div className="space-y-5">
          {timeline.length > 0 ? (
            <Panel className="p-5">
              <PanelHeader title="Linha do tempo" />
              <div className="mt-4">
                <Timeline items={timeline} />
              </div>
            </Panel>
          ) : null}

          {latestQuote && !canAnswerQuote ? (
            <Panel className="p-5">
              <PanelHeader
                title={`Orçamento ${latestQuote.quoteNumber}`}
                action={
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {formatCurrency(latestQuote.totalCents)}
                  </span>
                }
              />
              <div className="mt-4">
                <QuoteItems items={latestQuote.items} />
              </div>
            </Panel>
          ) : null}

          <FinancialSummaryCard
            summary={financialSummaryQuery.data}
            isLoading={financialSummaryQuery.isLoading}
            isError={financialSummaryQuery.isError}
          />

          <Panel className="p-5">
            <PanelHeader title="Comprovantes" />
            <div className="mt-4 space-y-2">
              {(order.intakeDocuments?.length ?? 0) === 0 &&
              (order.deliveryDocuments?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nenhum documento disponível ainda.
                </p>
              ) : (
                <>
                  {order.intakeDocuments?.map((doc) => (
                    <DocRow
                      key={`intake-${doc.id}`}
                      label={`Entrada ${doc.documentNumber}`}
                      ready={Boolean(doc.pdfR2Key)}
                    />
                  ))}
                  {order.deliveryDocuments?.map((doc) => (
                    <DocRow
                      key={`delivery-${doc.id}`}
                      label={`Entrega ${doc.documentNumber}`}
                      ready={Boolean(doc.pdfR2Key)}
                    />
                  ))}
                </>
              )}
            </div>
          </Panel>

          {order.certificateLinks && order.certificateLinks.length > 0 ? (
            <Panel className="p-5">
              <PanelHeader title="Certificados" />
              <div className="mt-4 space-y-2">
                {order.certificateLinks.map((link) => (
                  <Link
                    key={link.id}
                    to="/certificates/$id"
                    params={{ id: link.jobId || String(link.certificateJobId) }}
                    className="group flex min-h-12 items-center gap-3 rounded-xl p-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] transition-[background-color] hover:bg-muted/50 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                  >
                    <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                      <HugeiconsIcon
                        icon={File01Icon}
                        className="size-4"
                        strokeWidth={2}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums">
                      {link.jobId || `Certificado ${link.certificateJobId}`}
                    </span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="text-muted-foreground/60 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                      strokeWidth={2}
                    />
                  </Link>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <p className="text-muted-foreground font-mono text-[11px] font-medium uppercase tracking-[0.1em]">
        {label}
      </p>
      <p className="mt-1 text-sm whitespace-pre-wrap text-pretty">{value}</p>
    </div>
  );
}

function LineItem({ item }: { item: QuoteItem | ExecutionItem }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm">{item.description}</p>
        <p className="text-muted-foreground text-xs">
          <span className="bg-muted text-muted-foreground mr-1.5 rounded px-1 py-0.5 text-[10px] font-medium">
            {ITEM_TYPE_LABEL[item.type] ?? item.type}
          </span>
          <span className="font-mono tabular-nums">
            {item.quantity} {item.unit} × {formatCurrency(item.unitPriceCents)}
          </span>
        </p>
      </div>
      <span className="shrink-0 font-mono text-sm font-medium tabular-nums">
        {formatCurrency(item.totalPriceCents)}
      </span>
    </div>
  );
}

function QuoteItems({ items }: { items?: Array<QuoteItem> }) {
  if (!items || items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Sem itens detalhados.</p>
    );
  }
  return (
    <div className="divide-border/70 divide-y">
      {items.map((item) => (
        <LineItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function DocRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl p-2.5 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
      <span className="truncate">{label}</span>
      <StatusPill tone={ready ? "ok" : "neutral"} size="sm" dot={!ready}>
        {ready ? "Disponível" : "Processando"}
      </StatusPill>
    </div>
  );
}
