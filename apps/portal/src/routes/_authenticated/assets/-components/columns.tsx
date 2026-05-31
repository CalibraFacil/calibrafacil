import { type ColumnDef } from "@tanstack/react-table";

import { StatusPill } from "@/components/status-pill";
import { getCalibrationStatus } from "@/lib/calibration-status";
import { formatDate } from "@/lib/format";

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

export const assetsColumns: ColumnDef<Asset>[] = [
  {
    accessorKey: "tag",
    header: "Tag",
    cell: ({ row }) => (
      <span className="font-mono text-xs font-medium tabular-nums">
        {row.original.tag}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "Instrumento",
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {row.original.assetTypeName}
          {row.original.manufacturer ? ` · ${row.original.manufacturer}` : ""}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "serialNumber",
    header: "N. Série",
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {row.original.serialNumber}
      </span>
    ),
  },
  {
    id: "calibrationStatus",
    header: "Calibração",
    cell: ({ row }) => {
      const status = getCalibrationStatus(row.original.nextCalibrationDate);
      return (
        <StatusPill
          tone={status.tone}
          size="sm"
          pulse={status.tone === "critical"}
        >
          {status.label}
        </StatusPill>
      );
    },
  },
  {
    accessorKey: "nextCalibrationDate",
    header: "Próx. calibração",
    cell: ({ row }) => {
      const status = getCalibrationStatus(row.original.nextCalibrationDate);
      return (
        <div className="text-sm">
          <span className="font-mono tabular-nums">
            {formatDate(row.original.nextCalibrationDate)}
          </span>
          {status.daysDelta !== null ? (
            <p className="text-muted-foreground text-xs">
              {status.description}
            </p>
          ) : null}
        </div>
      );
    },
  },
];
