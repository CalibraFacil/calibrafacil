import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  Building02Icon,
  Cancel01Icon,
  DeliveryTruck01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { getCalibrationStatus } from "@/lib/calibration-status";
import { pluralize } from "@/lib/format";
import { cn, getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/requests/new")({
  component: NewRequestPage,
});

type PortalAsset = {
  id: number;
  name: string;
  tag: string;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  assetTypeName: string;
  nextCalibrationDate: string | null;
};

type AssetsResponse = {
  data: Array<PortalAsset>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type DeliveryMethod = "dropoff" | "carrier";

function getResponseErrorMessage(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const error = Object.fromEntries(Object.entries(result)).error;
  return typeof error === "string" ? error : null;
}

function getCreatedRequestId(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Resposta inválida ao criar solicitação");
  }
  const id = Object.fromEntries(Object.entries(result)).id;
  if (typeof id !== "number") {
    throw new Error("Resposta inválida ao criar solicitação");
  }
  return id;
}

function NewRequestPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedAssets, setSelectedAssets] = useState<Array<PortalAsset>>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [observations, setObservations] = useState("");
  const [requestedDueDate, setRequestedDueDate] = useState("");
  const [deliveryMethod, setDeliveryMethod] =
    useState<DeliveryMethod>("dropoff");
  const [nfNumber, setNfNumber] = useState("");
  const [nfKey, setNfKey] = useState("");
  const [carrier, setCarrier] = useState("");
  const [nfIssuedAt, setNfIssuedAt] = useState("");
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-request-assets", page, limit, deferredSearch],
    queryFn: async (): Promise<AssetsResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (deferredSearch) params.set("query", deferredSearch);

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets?${params.toString()}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Falha ao carregar ativos");
      return response.json();
    },
  });

  const selectedIds = useMemo(
    () => new Set(selectedAssets.map((asset) => asset.id)),
    [selectedAssets],
  );
  const nfKeyDigits = nfKey.replace(/\D/g, "");
  const isCarrier = deliveryMethod === "carrier";
  const nfKeyInvalid =
    isCarrier && nfKeyDigits.length > 0 && nfKeyDigits.length !== 44;

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${getApiBaseUrl()}/api/portal/requests`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetIds: selectedAssets.map((asset) => asset.id),
          observations: observations || undefined,
          requestedDueDate: requestedDueDate
            ? new Date(`${requestedDueDate}T12:00:00`).toISOString()
            : undefined,
          deliveryMethod,
          invoiceRemittanceNumber: isCarrier
            ? nfNumber || undefined
            : undefined,
          invoiceRemittanceKey: isCarrier
            ? nfKeyDigits || undefined
            : undefined,
          carrierName: isCarrier ? carrier || undefined : undefined,
          invoiceRemittanceIssuedAt:
            isCarrier && nfIssuedAt
              ? new Date(`${nfIssuedAt}T12:00:00`).toISOString()
              : undefined,
        }),
      });

      const result: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          getResponseErrorMessage(result) || "Erro ao criar solicitação",
        );
      }
      return { id: getCreatedRequestId(result) };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["portal-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["portal-overview"] });
      toast.success("Solicitação enviada com sucesso");
      navigate({ to: "/requests/$id", params: { id: String(result.id) } });
    },
    onError: (mutationError) => {
      toast.error(mutationError.message);
    },
  });

  function toggleAsset(asset: PortalAsset) {
    setSelectedAssets((current) =>
      current.some((item) => item.id === asset.id)
        ? current.filter((item) => item.id !== asset.id)
        : [...current, asset],
    );
  }

  function removeAsset(id: number) {
    setSelectedAssets((current) => current.filter((item) => item.id !== id));
  }

  const pageAssets = data?.data ?? [];
  const pageOverdue = pageAssets.filter(
    (asset) =>
      getCalibrationStatus(asset.nextCalibrationDate).status === "OVERDUE" &&
      !selectedIds.has(asset.id),
  );

  function selectAllOverdue() {
    setSelectedAssets((current) => [...current, ...pageOverdue]);
  }

  const canSubmit =
    selectedAssets.length > 0 && !nfKeyInvalid && !createMutation.isPending;

  return (
    <div className="portal-shell space-y-6">
      <PageHeader
        eyebrow="Solicitação"
        title="Nova solicitação de calibração"
        description="Selecione os equipamentos, informe como vai enviá-los e envie ao laboratório."
        actions={
          <Button variant="outline" size="sm" render={<Link to="/requests" />}>
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
            Voltar
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(360px,0.82fr)] lg:items-start">
        {/* Step 1 — pick equipment */}
        <Panel className="p-5">
          <PanelHeader
            eyebrow="Etapa 1 · Equipamentos"
            title="Selecione os equipamentos"
            description="Marque os instrumentos que precisam de calibração."
            action={
              pageOverdue.length > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={selectAllOverdue}
                  className="text-destructive"
                >
                  Selecionar{" "}
                  {pluralize(pageOverdue.length, "vencido", "vencidos")}
                </Button>
              ) : null
            }
          />

          <div className="mt-4 space-y-4">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                strokeWidth={2}
              />
              <Input
                placeholder="Buscar por nome, tag ou série..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner className="size-7" />
              </div>
            ) : error ? (
              <div className="bg-destructive/10 text-destructive rounded-xl p-4 text-center text-sm">
                Erro ao carregar equipamentos.
              </div>
            ) : pageAssets.length === 0 ? (
              <div className="text-muted-foreground bg-muted/40 rounded-xl p-6 text-center text-sm">
                {deferredSearch
                  ? "Nenhum equipamento encontrado para esta busca."
                  : "Nenhum equipamento disponível."}
              </div>
            ) : (
              <div className="space-y-2">
                {pageAssets.map((asset) => {
                  const selected = selectedIds.has(asset.id);
                  const status = getCalibrationStatus(
                    asset.nextCalibrationDate,
                  );
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleAsset(asset)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl p-3 text-left transition-[background-color,box-shadow]",
                        selected
                          ? "bg-primary/5 shadow-[inset_0_0_0_1px_var(--color-primary)]"
                          : "shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] hover:bg-muted/50 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]",
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        className="pointer-events-none mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {asset.name}
                          </span>
                          <span className="text-muted-foreground font-mono text-xs tabular-nums">
                            {asset.tag}
                          </span>
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          {asset.assetTypeName} · Série{" "}
                          <span className="font-mono tabular-nums">
                            {asset.serialNumber}
                          </span>
                          {asset.manufacturer ? ` · ${asset.manufacturer}` : ""}
                        </p>
                      </div>
                      <StatusPill
                        tone={status.tone}
                        size="sm"
                        className="mt-0.5"
                      >
                        {status.label}
                      </StatusPill>
                    </button>
                  );
                })}

                {data && data.pagination.totalPages > 1 ? (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      Página {data.pagination.page} de{" "}
                      {data.pagination.totalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPage((p) =>
                            Math.min(data.pagination.totalPages, p + 1),
                          )
                        }
                        disabled={page === data.pagination.totalPages}
                      >
                        Próxima
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </Panel>

        {/* Step 2 — review, shipping & submit (sticky) */}
        <div className="space-y-5 lg:sticky lg:top-20">
          <Panel className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Selecionados</h2>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  selectedAssets.length > 0
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {selectedAssets.length}
              </span>
            </div>

            {selectedAssets.length > 0 ? (
              <ul className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1">
                {selectedAssets.map((asset) => (
                  <li
                    key={asset.id}
                    className="flex items-center gap-2 rounded-lg py-1.5 pr-1 pl-2 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {asset.name}{" "}
                      <span className="text-muted-foreground font-mono text-xs tabular-nums">
                        {asset.tag}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remover ${asset.name}`}
                      onClick={() => removeAsset(asset.id)}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm text-pretty">
                Selecione os equipamentos ao lado. Eles continuam marcados ao
                trocar de página ou buscar.
              </p>
            )}
          </Panel>

          <Panel className="p-5">
            <PanelHeader eyebrow="Etapa 2 · Envio" title="Como vai enviar?" />

            <div className="mt-4 grid grid-cols-2 gap-2">
              <DeliveryOption
                active={deliveryMethod === "dropoff"}
                icon={Building02Icon}
                title="Levar ao laboratório"
                description="Entrega no balcão"
                onClick={() => setDeliveryMethod("dropoff")}
              />
              <DeliveryOption
                active={isCarrier}
                icon={DeliveryTruck01Icon}
                title="Transportadora"
                description="Envio com nota fiscal"
                onClick={() => setDeliveryMethod("carrier")}
              />
            </div>

            {isCarrier ? (
              <div className="mt-3 space-y-3 rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Nota fiscal de remessa para conserto
                </p>

                <Field label="Número da nota">
                  <Input
                    inputMode="numeric"
                    placeholder="Ex.: 12345"
                    value={nfNumber}
                    onChange={(event) => setNfNumber(event.target.value)}
                    className="font-mono tabular-nums"
                  />
                </Field>

                <Field
                  label="Chave de acesso"
                  hint={
                    nfKeyDigits.length > 0 ? (
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          nfKeyInvalid
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {nfKeyDigits.length}/44
                      </span>
                    ) : (
                      <span className="text-muted-foreground">44 dígitos</span>
                    )
                  }
                >
                  <Input
                    inputMode="numeric"
                    placeholder="Chave de acesso da NF-e"
                    value={nfKey}
                    onChange={(event) => setNfKey(event.target.value)}
                    aria-invalid={nfKeyInvalid}
                    className="font-mono tabular-nums"
                  />
                  {nfKeyInvalid ? (
                    <p className="text-destructive text-xs">
                      A chave de acesso deve ter 44 dígitos.
                    </p>
                  ) : null}
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Transportadora">
                    <Input
                      placeholder="Opcional"
                      value={carrier}
                      onChange={(event) => setCarrier(event.target.value)}
                    />
                  </Field>
                  <Field label="Data de emissão">
                    <Input
                      type="date"
                      value={nfIssuedAt}
                      onChange={(event) => setNfIssuedAt(event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-3 border-t pt-4">
              <Field label="Prazo desejado" hint="opcional">
                <Input
                  type="date"
                  value={requestedDueDate}
                  onChange={(event) => setRequestedDueDate(event.target.value)}
                />
              </Field>
              <Field label="Observações" hint="opcional">
                <Textarea
                  value={observations}
                  onChange={(event) => setObservations(event.target.value)}
                  placeholder="Requisitos, condições do equipamento ou observações relevantes."
                />
              </Field>
            </div>
          </Panel>

          <Button
            className={cn("w-full", ACTION_BUTTON_CLASS)}
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <>
                <Spinner className="mr-2" />
                Enviando...
              </>
            ) : (
              `Enviar solicitação${
                selectedAssets.length > 0 ? ` · ${selectedAssets.length}` : ""
              }`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeliveryOption({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: IconSvgElement;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-xl p-3 text-left transition-[background-color,box-shadow,transform] active:scale-[0.98]",
        active
          ? "bg-primary/5 shadow-[inset_0_0_0_1.5px_var(--color-primary)]"
          : "shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] hover:bg-muted/50 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]",
      )}
    >
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={cn(
          "size-5",
          active ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="text-sm font-medium">{title}</span>
      <span className="text-muted-foreground text-xs">{description}</span>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        {hint ? <span className="text-xs">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
