import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Calendar03Icon,
  Download04Icon,
  File01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/certificates/")({
  component: CertificatesPage,
});

type Certificate = {
  id: number;
  jobId: string;
  status: string;
  performedAt: string | null;
  approvedAt: string | null;
  certificateUrl: string | null;
  verificationToken: string;
  assetId: number;
  assetName: string;
  assetTag: string;
  assetManufacturer: string | null;
  assetModel: string | null;
  assetSerialNumber: string;
  serviceName: string;
  labName: string;
};

type CertificatesResponse = {
  data: Array<Certificate>;
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
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function DownloadButton({ certificate }: { certificate: Certificate }) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isDownloading || !certificate.certificateUrl) return;

    setIsDownloading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates/${certificate.id}/download`,
        { credentials: "include" },
      );

      if (!response.ok) throw new Error("Falha ao baixar");

      const { url, filename } = await response.json();

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Download error:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  if (!certificate.certificateUrl) {
    return <Badge variant="outline">Gerando</Badge>;
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
      onClick={handleDownload}
      disabled={isDownloading}
    >
      {isDownloading ? (
        <Spinner className="size-4" />
      ) : (
        <HugeiconsIcon icon={Download04Icon} className="size-4" />
      )}
      <span className="sr-only">Baixar PDF</span>
    </Button>
  );
}

function CertificatesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const limit = 20;
  const hasFilters = Boolean(search || dateFrom || dateTo);

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-certificates", page, limit, search, dateFrom, dateTo],
    queryFn: async (): Promise<CertificatesResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (search) {
        params.set("query", search);
      }

      if (dateFrom) {
        params.set("dateFrom", dateFrom);
      }

      if (dateTo) {
        params.set("dateTo", dateTo);
      }

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates?${params.toString()}`,
        {
          credentials: "include",
        },
      );
      if (!response.ok) {
        throw new Error("Falha ao carregar certificados");
      }
      return response.json();
    },
  });

  const columns: ColumnDef<Certificate>[] = useMemo(
    () => [
      {
        accessorKey: "jobId",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Certificado" />
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <HugeiconsIcon
                icon={File01Icon}
                className="size-4 text-primary"
              />
            </div>
            <span className="font-medium">{row.original.jobId}</span>
          </div>
        ),
      },
      {
        accessorKey: "assetName",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Instrumento" />
        ),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.assetName}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.assetTag}
              {row.original.assetManufacturer && (
                <span> · {row.original.assetManufacturer}</span>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "serviceName",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Serviço" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.serviceName}
          </span>
        ),
      },
      {
        accessorKey: "approvedAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Data" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatDate(row.original.approvedAt)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: () => (
          <Badge variant="default">
            Aprovado
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => <DownloadButton certificate={row.original} />,
      },
    ],
    [],
  );

  const handleRowClick = (certificate: Certificate) => {
    navigate({
      to: "/certificates/$id",
      params: { id: String(certificate.id) },
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Certificados</CardTitle>
          <CardDescription>
            Acesse e baixe seus certificados de calibração.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-50 flex-1 sm:max-w-sm">
              <HugeiconsIcon
                icon={Search01Icon}
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Buscar por certificado, instrumento ou serviço..."
                aria-label="Buscar por certificado, instrumento ou serviço"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <HugeiconsIcon
                  icon={Calendar03Icon}
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="date"
                  aria-label="Filtrar certificados aprovados a partir de"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-9 sm:w-42"
                />
              </div>
              <div className="relative">
                <HugeiconsIcon
                  icon={Calendar03Icon}
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="date"
                  aria-label="Filtrar certificados aprovados até"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-9 sm:w-42"
                />
              </div>
            </div>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setDateFrom("");
                  setDateTo("");
                  setPage(1);
                }}
                className="h-9"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="mr-2 size-4" />
                Limpar filtros
              </Button>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
              Erro ao carregar certificados. Tente novamente.
            </div>
          )}

          {!isLoading && !error && data?.data?.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={File01Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum certificado encontrado</EmptyTitle>
                <EmptyDescription>
                  {hasFilters
                    ? "Nenhum certificado corresponde aos filtros aplicados."
                    : "Seus certificados de calibração aparecerão aqui."}
                </EmptyDescription>
              </EmptyHeader>
              {hasFilters && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setDateFrom("");
                      setDateTo("");
                      setPage(1);
                    }}
                  >
                    Limpar filtros
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}

          {!error && (data?.data?.length ?? 0) > 0 && (
            <DataTable
              columns={columns}
              data={data?.data ?? []}
              isLoading={isLoading}
              onRowClick={handleRowClick}
              pagination={data?.pagination}
              onPageChange={setPage}
              itemName="certificados"
            />
          )}

          {isLoading && !data && (
            <DataTable columns={columns} data={[]} isLoading={true} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
