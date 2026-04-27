import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { getApiBaseUrl } from "@/lib/utils";
import { type Asset, assetsColumns } from "./-components/columns";

export const Route = createFileRoute("/_authenticated/assets/")({
  component: AssetsPage,
});

type AssetsResponse = {
  data: Array<Asset>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

function AssetsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-assets", page, limit, search],
    queryFn: async (): Promise<AssetsResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (search) {
        params.set("query", search);
      }

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets?${params.toString()}`,
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Meus Ativos</CardTitle>
              <CardDescription>
                Visualize os ativos e instrumentos da sua organização.
              </CardDescription>
            </div>
            <Button render={<Link to="/requests/new" />}>
              <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
              Solicitar Calibração
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-50 flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                placeholder="Buscar por nome, tag, série..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>

            {search && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="h-9"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="mr-2 size-4" />
                Limpar filtros
              </Button>
            )}
          </div>

          {/* Error state */}
          {error && (
            <div className="text-destructive py-8 text-center">
              Erro ao carregar ativos. Tente novamente.
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && data?.data?.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Wrench01Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum ativo encontrado</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? "Nenhum ativo corresponde aos filtros aplicados."
                    : "Quando houver ativos vinculados à sua organização, eles aparecerão aqui."}
                </EmptyDescription>
              </EmptyHeader>
              {search && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setPage(1);
                    }}
                  >
                    Limpar filtros
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}

          {/* Data table */}
          {!isLoading && !error && data?.data && data.data.length > 0 && (
            <DataTable
              columns={assetsColumns}
              data={data.data}
              pagination={data.pagination}
              onPageChange={setPage}
              onRowClick={(asset) => {
                void navigate({
                  to: "/assets/$id",
                  params: { id: String(asset.id) },
                });
              }}
              itemName="ativos"
            />
          )}

          {/* Loading state when no data yet */}
          {isLoading && !data && (
            <DataTable columns={assetsColumns} data={[]} isLoading={true} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
