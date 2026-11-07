import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { formatAddress } from "@calibra-facil/shared/address";
import { Button } from "@calibra-facil/ui/button";
import { Card, CardContent } from "@calibra-facil/ui/card";
import { Spinner } from "@calibra-facil/ui/spinner";
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
} from "@calibra-facil/ui/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import {
  CALIBRATION_REQUEST_STATUS,
  VISIT_STATUS,
} from "@calibra-facil/schemas/machines";
import { useRequestDetail } from "./queries";
import {
  formatCalendarDate,
  formatInstant,
} from "@calibra-facil/shared/format";

export function RequestDetailPage({ id }: { id: string }) {
  const { data, isLoading, error } = useRequestDetail(id);

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

  const isCarrier = data.deliveryMethod === "carrier";
  const isOnsite = data.deliveryMethod === "onsite";
  const hasRemittance =
    isCarrier &&
    Boolean(
      data.invoiceRemittanceNumber ||
      data.invoiceRemittanceKey ||
      data.carrierName ||
      data.invoiceRemittanceIssuedAt,
    );
  const deliveryMethodLabel = isCarrier
    ? "Envio por transportadora"
    : isOnsite
      ? "Calibração no local (em loco)"
      : "Entrega no laboratório";
  const onsiteAddressText = formatAddress(data.onsiteAddress);

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
            <StatusPill tone={CALIBRATION_REQUEST_STATUS.tone(data.status)}>
              {CALIBRATION_REQUEST_STATUS.label(data.status)}
            </StatusPill>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Enviada em{" "}
            <span className="font-mono tabular-nums">
              {formatInstant(data.submittedAt, "date-medium")}
            </span>
          </p>
        </div>

        <Button variant="outline" render={<Link to="/requests/new" />}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nova solicitação
        </Button>
      </div>

      <Panel className="p-5">
        <PanelHeader title="Detalhes da solicitação" />
        <BlueprintGrid className="mt-4 sm:grid-cols-2">
          <BlueprintField label="Cliente">{data.customerName}</BlueprintField>
          <BlueprintField label="Forma de envio">
            {deliveryMethodLabel}
          </BlueprintField>
          <BlueprintField label="Prazo solicitado" mono>
            {formatCalendarDate(data.requestedDueDate, "date-medium")}
          </BlueprintField>
          <BlueprintField label="Enviada em" mono>
            {formatInstant(data.submittedAt, "date-medium")}
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
                Recusada em {formatInstant(data.rejectedAt, "date-medium")}
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {hasRemittance ? (
        <Panel className="p-5">
          <PanelHeader
            title="Nota fiscal de remessa para conserto"
            description="Dados informados para o envio via transportadora."
          />
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            <BlueprintField label="Número da nota" mono>
              {data.invoiceRemittanceNumber || "—"}
            </BlueprintField>
            <BlueprintField label="Data de emissão" mono>
              {formatInstant(data.invoiceRemittanceIssuedAt, "date-medium")}
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

      {isOnsite ? (
        <Panel className="p-5">
          <PanelHeader
            title="Visita técnica no local"
            description="O laboratório confirma a data e designa o técnico."
          />
          <BlueprintGrid className="mt-4 sm:grid-cols-2">
            <BlueprintField label="Data preferida" mono>
              {formatCalendarDate(data.preferredVisitDate, "date-medium")}
            </BlueprintField>
            {data.visit ? (
              <BlueprintField label="Situação da visita">
                {VISIT_STATUS.label(data.visit.status)}
              </BlueprintField>
            ) : null}
            {data.visit?.scheduledAt ? (
              <BlueprintField label="Data confirmada" mono>
                {formatCalendarDate(data.visit.scheduledAt, "date-medium")}
              </BlueprintField>
            ) : null}
            {data.visit?.technicianName ? (
              <BlueprintField label="Técnico">
                {data.visit.technicianName}
              </BlueprintField>
            ) : null}
            <BlueprintField
              label="Endereço da visita"
              className="sm:col-span-2"
            >
              {onsiteAddressText || "Endereço cadastrado do cliente"}
            </BlueprintField>
          </BlueprintGrid>
        </Panel>
      ) : null}

      <Panel className="p-5">
        <PanelHeader
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
