import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Download04Icon,
  File01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
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
    return (
      <span className="text-xs text-muted-foreground">Gerando...</span>
    );
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
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-certificates", page, limit],
    queryFn: async (): Promise<CertificatesResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/certificates?page=${page}&limit=${limit}`,
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

  const filteredData = useMemo(() => {
    if (!data?.data || !search.trim()) return data?.data ?? [];

    const searchLower = search.toLowerCase().trim();
    return data.data.filter(
      (cert) =>
        cert.jobId.toLowerCase().includes(searchLower) ||
        cert.assetName.toLowerCase().includes(searchLower) ||
        cert.assetTag.toLowerCase().includes(searchLower) ||
        cert.serviceName.toLowerCase().includes(searchLower) ||
        (cert.assetManufacturer?.toLowerCase().includes(searchLower) ?? false) ||
        cert.assetSerialNumber.toLowerCase().includes(searchLower),
    );
  }, [data?.data, search]);

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
          <DataTableColumnHeader column={column} title="Servico" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.serviceName}</span>
        ),
      },
      {
        accessorKey: "approvedAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Data" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.approvedAt)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: () => (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3" />
            Aprovado
          </span>
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
    navigate({ to: "/certificates/$id", params: { id: String(certificate.id) } });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Certificados</h1>
          <p className="text-sm text-muted-foreground">
            Acesse e baixe seus certificados de calibracao.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <HugeiconsIcon
            icon={Search01Icon}
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Buscar certificados..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
          <p className="text-sm text-destructive">
            Erro ao carregar certificados. Tente novamente.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && data?.data?.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <HugeiconsIcon
              icon={File01Icon}
              className="size-6 text-muted-foreground"
            />
          </div>
          <h3 className="text-lg font-medium">Nenhum certificado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Seus certificados de calibracao aparecerao aqui.
          </p>
        </div>
      )}

      {/* Data table */}
      {!error && (data?.data?.length ?? 0) > 0 && (
        <DataTable
          columns={columns}
          data={filteredData}
          isLoading={isLoading}
          onRowClick={handleRowClick}
          pagination={
            !search.trim() && data?.pagination
              ? data.pagination
              : undefined
          }
          onPageChange={setPage}
          itemName="certificados"
        />
      )}

      {/* Search results count */}
      {search.trim() && filteredData.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {filteredData.length} resultado{filteredData.length !== 1 ? "s" : ""} encontrado{filteredData.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* No search results */}
      {search.trim() && filteredData.length === 0 && !isLoading && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum certificado encontrado para "{search}".
          </p>
        </div>
      )}
    </div>
  );
}
