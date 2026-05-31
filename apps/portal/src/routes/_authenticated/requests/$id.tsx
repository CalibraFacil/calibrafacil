import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { getRequestStatus, type RequestStatus } from "@/lib/status-labels";
import { formatDate } from "@/lib/format";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/requests/$id")({
  component: RequestDetailPage,
});

type RequestItem = {
  id: number;
  assetId: number;
  assetName: string;
  assetTag: string;
  assetSerialNumber: string;
  assetManufacturer: string | null;
  assetModel: string | null;
  assetTypeName: string | null;
  convertedJobId: number | null;
  convertedJobCode: string | null;
  convertedJobStatus: string | null;
  convertedServiceName: string | null;
};

type RequestDetail = {
  id: number;
  status: RequestStatus;
  observations: string | null;
  requestedDueDate: string | null;
  deliveryMethod: "dropoff" | "carrier";
  invoiceRemittanceNumber: string | null;
  invoiceRemittanceKey: string | null;
  invoiceRemittanceIssuedAt: string | null;
  carrierName: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  convertedAt: string | null;
  customerName: string;
  items: Array<RequestItem>;
};

function RequestDetailPage() {
  const { id } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-request-detail", id],
    queryFn: async (): Promise<RequestDetail> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/requests/${id}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar solicitação");
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="text-destructive py-8 text-center">
          Erro ao carregar solicitação.
        </CardContent>
      </Card>
    );
  }

  const status = getRequestStatus(data.status);
  const isCarrier = data.deliveryMethod === "carrier";
  const hasRemittance =
    isCarrier &&
    Boolean(
      data.invoiceRemittanceNumber ||
      data.invoiceRemittanceKey ||
      data.carrierName ||
      data.invoiceRemittanceIssuedAt,
    );

  return (
    <div className="portal-shell-sm space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" render={<Link to="/requests" />}>
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
            Solicitações
          </Button>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Solicitação{" "}
              <span className="font-mono tabular-nums">#{data.id}</span>
            </h1>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Enviada em{" "}
            <span className="font-mono tabular-nums">
              {formatDate(data.submittedAt)}
            </span>
          </p>
        </div>

        <Button variant="outline" render={<Link to="/requests/new" />}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nova solicitação
        </Button>
      </div>

      <Panel className="p-5">
        <PanelHeader eyebrow="Resumo" title="Detalhes da solicitação" />
        <BlueprintGrid className="mt-4 sm:grid-cols-2">
          <BlueprintField label="Cliente">{data.customerName}</BlueprintField>
          <BlueprintField label="Forma de envio">
            {isCarrier ? "Envio por transportadora" : "Entrega no laboratório"}
          </BlueprintField>
          <BlueprintField label="Prazo solicitado" mono>
            {formatDate(data.requestedDueDate)}
          </BlueprintField>
          <BlueprintField label="Enviada em" mono>
            {formatDate(data.submittedAt)}
          </BlueprintField>
        </BlueprintGrid>

        {data.observations?.trim() ? (
          <div className="mt-4">
            <p className="text-muted-foreground font-mono text-[11px] font-medium uppercase tracking-[0.1em]">
              Observações
            </p>
            <p className="mt-1 text-sm text-pretty">{data.observations}</p>
          </div>
        ) : null}

        {data.status === "REJECTED" ? (
          <div className="bg-destructive/10 mt-4 rounded-xl p-3">
            <p className="text-destructive text-sm font-medium">
              Motivo da recusa
            </p>
            <p className="mt-1 text-sm text-pretty">
              {data.rejectionReason?.trim() ||
                "Solicitação recusada sem motivo informado."}
            </p>
            {data.rejectedAt ? (
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                Recusada em {formatDate(data.rejectedAt)}
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {hasRemittance ? (
        <Panel className="p-5">
          <PanelHeader
            eyebrow="Logística"
            title="Nota fiscal de remessa para conserto"
            description="Dados informados para o envio via transportadora."
          />
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            <BlueprintField label="Número da nota" mono>
              {data.invoiceRemittanceNumber || "—"}
            </BlueprintField>
            <BlueprintField label="Data de emissão" mono>
              {formatDate(data.invoiceRemittanceIssuedAt)}
            </BlueprintField>
            <BlueprintField
              label="Chave de acesso"
              mono
              className="sm:col-span-2"
            >
              {data.invoiceRemittanceKey || "—"}
            </BlueprintField>
            <BlueprintField label="Transportadora">
              {data.carrierName || "—"}
            </BlueprintField>
          </BlueprintGrid>
        </Panel>
      ) : null}

      <Panel className="p-5">
        <PanelHeader
          eyebrow="Equipamentos"
          title="Ativos solicitados"
          action={
            <span className="text-muted-foreground font-mono text-sm tabular-nums">
              {data.items.length}
            </span>
          }
        />
        <div className="mt-4 space-y-2">
          {data.items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{item.assetName}</span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {item.assetTag}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                Série{" "}
                <span className="font-mono tabular-nums">
                  {item.assetSerialNumber}
                </span>
                {item.assetManufacturer ? ` · ${item.assetManufacturer}` : ""}
                {item.assetTypeName ? ` · ${item.assetTypeName}` : ""}
              </p>
              {item.convertedJobCode ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  Convertida na calibração{" "}
                  <span className="font-mono tabular-nums">
                    {item.convertedJobCode}
                  </span>
                  {item.convertedServiceName
                    ? ` · ${item.convertedServiceName}`
                    : ""}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
