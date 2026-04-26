import { createFileRoute } from "@tanstack/react-router";
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
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/service-order-access/$token")({
  component: PublicServiceOrderAccessPage,
});

type PublicOrder = {
  serviceOrderNumber: string;
  status: string;
  openedAt: string;
  claimedDefect: string | null;
  assetSnapshot?: {
    assetName?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
  } | null;
  evaluations?: Array<{
    diagnosis: string | null;
    clientVisibleNotes: string | null;
  }>;
  quotes?: Array<{
    id: number;
    quoteNumber: string;
    version: number;
    status: string;
    totalCents: number;
    validUntil: string | null;
    items?: Array<{
      id: number;
      description: string;
      quantity: string;
      unit: string;
      unitPriceCents: number;
      totalPriceCents: number;
    }>;
  }>;
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

function PublicServiceOrderAccessPage() {
  const { token } = Route.useParams();
  const queryClient = useQueryClient();
  const [rejectionReason, setRejectionReason] = useState("");

  const orderQuery = useQuery({
    queryKey: ["public-service-order", token],
    queryFn: async (): Promise<PublicOrder> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/public/service-order-access/${token}`,
      );

      if (!response.ok) {
        throw new Error("Link expirado, revogado ou inválido.");
      }

      const result = (await response.json()) as { data: PublicOrder };
      return result.data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/public/service-order-access/${token}/approve-quote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) throw new Error("Falha ao aprovar orçamento.");
      return response.json();
    },
    onSuccess: async () => {
      toast.success("Orçamento aprovado.");
      await queryClient.invalidateQueries({ queryKey: ["public-service-order", token] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erro ao aprovar.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/public/service-order-access/${token}/reject-quote`,
        {
          method: "POST",
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
      await queryClient.invalidateQueries({ queryKey: ["public-service-order", token] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erro ao recusar.");
    },
  });

  const order = orderQuery.data;
  const quote = order?.quotes?.[0];
  const evaluation = order?.evaluations?.[0];
  const canAnswer = quote?.status === "sent";

  if (orderQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
        Carregando ordem de serviço...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Link indisponível</CardTitle>
            <CardDescription>
              {orderQuery.error instanceof Error
                ? orderQuery.error.message
                : "Não foi possível carregar a ordem de serviço."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <main className="mx-auto max-w-4xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{order.serviceOrderNumber}</CardTitle>
            <CardDescription>
              Entrada em {formatDate(order.openedAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Info label="Instrumento" value={order.assetSnapshot?.assetName} />
            <Info
              label="Identificação"
              value={[
                order.assetSnapshot?.manufacturer,
                order.assetSnapshot?.model,
                order.assetSnapshot?.serialNumber,
              ]
                .filter(Boolean)
                .join(" | ")}
            />
            <Info label="Defeito reclamado" value={order.claimedDefect} />
            <Info label="Status" value={order.status} />
          </CardContent>
        </Card>

        {evaluation && (
          <Card>
            <CardHeader>
              <CardTitle>Avaliação técnica</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Info label="Diagnóstico" value={evaluation.diagnosis} />
              <Info label="Observações" value={evaluation.clientVisibleNotes} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Orçamento</CardTitle>
            <CardDescription>
              {quote ? `${quote.quoteNumber} v${quote.version}` : "Não disponível"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {quote ? (
              <>
                <div className="rounded-md bg-muted p-4">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-3xl font-semibold">
                    {formatMoney(quote.totalCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Validade: {formatDate(quote.validUntil)}
                  </p>
                </div>

                <div className="space-y-3">
                  {quote.items?.map((item) => (
                    <div key={item.id} className="border-b pb-3 last:border-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">{item.description}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.quantity} {item.unit} x{" "}
                            {formatMoney(item.unitPriceCents)}
                          </p>
                        </div>
                        <p className="font-medium">
                          {formatMoney(item.totalPriceCents)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {canAnswer && (
                  <div className="grid gap-3 pt-2 sm:grid-cols-2">
                    <Button
                      onClick={() => approveMutation.mutate()}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                    >
                      Aprovar orçamento
                    </Button>
                    <div className="space-y-3">
                      <Textarea
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        placeholder="Motivo da recusa, opcional"
                      />
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => rejectMutation.mutate()}
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                      >
                        Recusar orçamento
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum orçamento foi publicado para este link.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value?.trim() || "-"}</p>
    </div>
  );
}
