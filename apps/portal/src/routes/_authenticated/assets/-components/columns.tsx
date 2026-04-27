import { type ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";

type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

export interface Asset {
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
}

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  MAINTENANCE: "Manutenção",
  SCRAPPED: "Descartado",
};

const statusVariants: Record<
  AssetStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  ACTIVE: "default",
  INACTIVE: "secondary",
  MAINTENANCE: "outline",
  SCRAPPED: "destructive",
};

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("pt-BR");
}

export const assetsColumns: ColumnDef<Asset>[] = [
  {
    accessorKey: "tag",
    header: "Tag",
    cell: ({ row }) => (
      <span className="font-mono font-medium tabular-nums">
        {row.original.tag}
      </span>
    ),
  },
  {
    accessorKey: "assetTypeName",
    header: "Tipo",
    cell: ({ row }) => (
      <Badge variant="secondary">{row.original.assetTypeName}</Badge>
    ),
  },
  {
    accessorKey: "name",
    header: "Nome",
  },
  {
    accessorKey: "manufacturer",
    header: "Fabricante",
    cell: ({ row }) => row.original.manufacturer || "-",
  },
  {
    accessorKey: "serialNumber",
    header: "N. Série",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">{row.original.serialNumber}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusVariants[row.original.status]}>
        {statusLabels[row.original.status]}
      </Badge>
    ),
  },
  {
    accessorKey: "nextCalibrationDate",
    header: "Próx. Calibração",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatDate(row.original.nextCalibrationDate)}
      </span>
    ),
  },
];
