import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/portal/assets/")({
  head: () => ({
    meta: [{ title: "Meus Ativos | Portal do Cliente" }],
  }),
  component: AssetsPage,
});

type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  MAINTENANCE: "Manutencao",
  SCRAPPED: "Descartado",
};

function getApiBaseUrl(): string {
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `https://${host}:3000`;
}

type Asset = {
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
  comments: string | null;
  createdAt: string;
  updatedAt: string;
};

type AssetsResponse = {
  data: Array<Asset>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

function formatDate(date: string | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("pt-BR");
}

function AssetsPage() {
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-assets", page, limit],
    queryFn: async (): Promise<AssetsResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/assets?page=${page}&limit=${limit}`,
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Meus Ativos</CardTitle>
          <CardDescription>
            Visualize os ativos e instrumentos da sua organizacao.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-8" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="text-destructive py-8 text-center">
              Erro ao carregar ativos. Tente novamente.
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && data?.data?.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              Nenhum ativo encontrado.
            </div>
          )}

          {/* Data table */}
          {!isLoading && !error && data?.data && data.data.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left font-medium">Tag</th>
                      <th className="px-4 py-3 text-left font-medium">Tipo</th>
                      <th className="px-4 py-3 text-left font-medium">Nome</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Fabricante
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        N. Serie
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Prox. Calibração
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((asset) => (
                      <tr key={asset.id} className="border-b hover:bg-muted/50">
                        <td className="px-4 py-3 font-mono font-medium">
                          {asset.tag}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                            {asset.assetTypeName}
                          </span>
                        </td>
                        <td className="px-4 py-3">{asset.name}</td>
                        <td className="px-4 py-3">
                          {asset.manufacturer || "-"}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {asset.serialNumber}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                              asset.status === "ACTIVE"
                                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                : asset.status === "INACTIVE"
                                  ? "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                                  : asset.status === "MAINTENANCE"
                                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                            }`}
                          >
                            {statusLabels[asset.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {formatDate(asset.nextCalibrationDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data.pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-muted-foreground text-sm">
                    Pagina {data.pagination.page} de{" "}
                    {data.pagination.totalPages} ({data.pagination.total}{" "}
                    ativos)
                  </div>
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
                      Proximo
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
