import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  FinancialSummaryCard,
  isFinancialSummary,
  type PortalFinancialSummary,
} from "@/features/service-orders/financial-summary-card";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/service-orders/$id")({
  component: ServiceOrderDetailPage,
});

type ServiceOrderDetail = {
  id: number;
  serviceOrderNumber: string;
  status: string;
  openedAt: string;
  claimedDefect: string | null;
  intakeCondition: string | null;
  accessories: string | null;
  clientVisibleNotes: string | null;
  assetSnapshot?: {
    assetName?: string | null;
    assetType?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    patrimonyNumber?: string | null;
    observedIdentification?: string | null;
  } | null;
  evaluations?: Array<{
    id: number;
    diagnosis: string | null;
    detectedIssues: string | null;
    clientVisibleNotes: string | null;
    evaluatedAt: string | null;
  }>;
  quotes?: Array<{
    id: number;
    quoteNumber: string;
    version: number;
    status: string;
    totalCents: number;
    validUntil: string | null;
    clientMessage: string | null;
    warrantyTerms: string | null;
    items?: Array<{
      id: number;
      type: string;
      description: string;
      quantity: string;
      unit: string;
      unitPriceCents: number;
      totalPriceCents: number;
      warrantyCovered: boolean;
    }>;
  }>;
  intakeDocuments?: Array<{
    id: number;
    documentNumber: string;
    version: number;
    pdfR2Key: string | null;
  }>;
  certificateLinks?: Array<{
    id: number;
    certificateJobId: number;
  }>;
  events?: Array<{
    id: number;
    eventType: string;
    createdAt: string;
  }>;
};

const statusLabels: Record<string, string> = {
  opened: "Aberta",
  awaiting_tech_evaluation: "Aguardando avaliação",
  under_evaluation: "Em avaliação",
  awaiting_quote_approval: "Aguardando aprovação",
  quote_approved: "Orçamento aprovado",
  quote_rejected: "Orçamento recusado",
  repair_in_progress: "Em reparo",
  awaiting_calibration: "Aguardando calibração",
  calibration_in_progress: "Em calibração",
  awaiting_final_review: "Revisão final",
  ready_for_pickup: "Aguardando retirada",
  delivered: "Entregue",
  closed: "Encerrada",
  canceled: "Cancelada",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatMoney(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

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

      // oxlint-disable-next-line typescript/consistent-type-assertions -- portal service-order endpoint returns the ServiceOrderDetail DTO.
      const result = (await response.json()) as { data: ServiceOrderDetail };
      return result.data;
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
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erro ao recusar.");
    },
  });

  const order = orderQuery.data;
  const latestQuote = order?.quotes?.[0];
  const latestEvaluation = order?.evaluations?.[0];
  const canAnswerQuote = latestQuote?.status === "sent";

  if (orderQuery.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando OS...</div>
    );
  }

  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>OS não encontrada</CardTitle>
          <CardDescription>
            A ordem de serviço não está disponível para este acesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link to="/service-orders" />}>
            Voltar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/service-orders" />}
          >
            Voltar
          </Button>
          <h1 className="mt-2 text-2xl font-semibold">
            {order.serviceOrderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {statusLabels[order.status] ?? order.status} | Entrada em{" "}
            {formatDate(order.openedAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Instrumento</CardTitle>
              <CardDescription>
                Dados congelados no recebimento da OS.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Info
                label="Instrumento"
                value={order.assetSnapshot?.assetName}
              />
              <Info label="Tipo" value={order.assetSnapshot?.assetType} />
              <Info
                label="Fabricante"
                value={order.assetSnapshot?.manufacturer}
              />
              <Info label="Modelo" value={order.assetSnapshot?.model} />
              <Info label="Série" value={order.assetSnapshot?.serialNumber} />
              <Info
                label="Patrimônio"
                value={order.assetSnapshot?.patrimonyNumber}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recebimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Info label="Defeito reclamado" value={order.claimedDefect} />
              <Info label="Condição aparente" value={order.intakeCondition} />
              <Info label="Acessórios" value={order.accessories} />
              <Info label="Observações" value={order.clientVisibleNotes} />
            </CardContent>
          </Card>

          {latestEvaluation && (
            <Card>
              <CardHeader>
                <CardTitle>Avaliação técnica</CardTitle>
                <CardDescription>
                  Avaliada em {formatDate(latestEvaluation.evaluatedAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Info label="Diagnóstico" value={latestEvaluation.diagnosis} />
                <Info
                  label="Problemas detectados"
                  value={latestEvaluation.detectedIssues}
                />
                <Info
                  label="Observações"
                  value={latestEvaluation.clientVisibleNotes}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Orçamento</CardTitle>
              <CardDescription>
                {latestQuote
                  ? `${latestQuote.quoteNumber} v${latestQuote.version}`
                  : "Ainda não enviado"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {latestQuote ? (
                <>
                  <div className="rounded-md bg-muted p-4">
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="text-2xl font-semibold">
                      {formatMoney(latestQuote.totalCents)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Validade: {formatDate(latestQuote.validUntil)}
                    </p>
                  </div>

                  <div className="space-y-3">
                    {latestQuote.items?.map((item) => (
                      <div
                        key={item.id}
                        className="border-b pb-3 last:border-0"
                      >
                        <p className="font-medium">{item.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} {item.unit} x{" "}
                          {formatMoney(item.unitPriceCents)}
                        </p>
                        <p className="text-sm font-medium">
                          {formatMoney(item.totalPriceCents)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {latestQuote.clientMessage && (
                    <Info label="Mensagem" value={latestQuote.clientMessage} />
                  )}

                  {canAnswerQuote && (
                    <div className="space-y-3 pt-2">
                      <Button
                        className="w-full"
                        onClick={() => approveMutation.mutate(latestQuote.id)}
                        disabled={
                          approveMutation.isPending || rejectMutation.isPending
                        }
                      >
                        Aprovar orçamento
                      </Button>
                      <Textarea
                        value={rejectionReason}
                        onChange={(event) =>
                          setRejectionReason(event.target.value)
                        }
                        placeholder="Motivo da recusa, opcional"
                      />
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => rejectMutation.mutate(latestQuote.id)}
                        disabled={
                          approveMutation.isPending || rejectMutation.isPending
                        }
                      >
                        Recusar orçamento
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  O orçamento será exibido aqui quando estiver disponível.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {order.intakeDocuments?.length ? (
                order.intakeDocuments.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center justify-between rounded-md border p-3 text-sm"
                  >
                    <span>
                      Comprovante {document.documentNumber} v{document.version}
                    </span>
                    <span className="text-muted-foreground">
                      {document.pdfR2Key ? "Disponível" : "Processando"}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum documento disponível.
                </p>
              )}
            </CardContent>
          </Card>

          <FinancialSummaryCard
            summary={financialSummaryQuery.data}
            isLoading={financialSummaryQuery.isLoading}
            isError={financialSummaryQuery.isError}
          />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm">{value?.trim() || "-"}</p>
    </div>
  );
}
