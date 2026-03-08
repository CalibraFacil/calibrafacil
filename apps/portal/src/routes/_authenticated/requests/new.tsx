import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { getApiBaseUrl } from "@/lib/utils";

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
};

function formatDate(date: string | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("pt-BR");
}

function NewRequestPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedAssetIds, setSelectedAssetIds] = useState<Array<number>>([]);
  const [search, setSearch] = useState("");
  const [observations, setObservations] = useState("");
  const [requestedDueDate, setRequestedDueDate] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-request-assets"],
    queryFn: async (): Promise<AssetsResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets?limit=100`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar ativos");
      }

      return response.json();
    },
  });

  const visibleAssets = useMemo(() => {
    const assets = data?.data ?? [];
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return assets;
    }

    return assets.filter((asset) =>
      [
        asset.name,
        asset.tag,
        asset.serialNumber,
        asset.manufacturer ?? "",
        asset.assetTypeName,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [data?.data, search]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${getApiBaseUrl()}/api/portal/requests`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assetIds: selectedAssetIds,
          observations: observations || undefined,
          requestedDueDate: requestedDueDate
            ? new Date(`${requestedDueDate}T12:00:00`).toISOString()
            : undefined,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          (result as { error?: string }).error || "Erro ao criar solicitação",
        );
      }

      return result as { id: number };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["portal-requests"] });
      toast.success("Solicitação enviada com sucesso");
      navigate({
        to: "/requests/$id",
        params: { id: String(result.id) },
      });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const toggleAsset = (assetId: number) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Nova Solicitação
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione os ativos que precisam de calibração e informe seus
          requisitos.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ativos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Buscar ativos por nome, tag ou série..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-8" />
            </div>
          )}

          {error && (
            <div className="py-6 text-center text-destructive">
              Erro ao carregar ativos.
            </div>
          )}

          {!isLoading && !error && visibleAssets.length === 0 && (
            <div className="py-6 text-center text-muted-foreground">
              Nenhum ativo encontrado.
            </div>
          )}

          {!isLoading && !error && visibleAssets.length > 0 && (
            <div className="space-y-3">
              {visibleAssets.map((asset) => {
                const selected = selectedAssetIds.includes(asset.id);

                return (
                  <label
                    key={asset.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAsset(asset.id)}
                      className="mt-1 size-4 rounded border-input"
                    />
                    <div className="space-y-1">
                      <div className="font-medium">
                        {asset.name}{" "}
                        <span className="text-muted-foreground">
                          ({asset.tag})
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {asset.assetTypeName} · Série {asset.serialNumber}
                        {asset.manufacturer && ` · ${asset.manufacturer}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Próxima calibração:{" "}
                        {formatDate(asset.nextCalibrationDate)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detalhes da Solicitação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Prazo solicitado</label>
            <Input
              type="date"
              value={requestedDueDate}
              onChange={(e) => setRequestedDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Observações</label>
            <Textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Descreva requisitos, condições do equipamento ou observações relevantes."
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <span>{selectedAssetIds.length} ativo(s) selecionado(s)</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/requests" })}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={
                  selectedAssetIds.length === 0 || createMutation.isPending
                }
              >
                {createMutation.isPending
                  ? "Enviando..."
                  : "Enviar Solicitação"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
