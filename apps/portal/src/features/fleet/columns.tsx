import { type ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";

import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { StatusPill } from "@/components/status-pill";
import { getInstrumentStatus } from "@/lib/calibration-status";
import { formatDate } from "@/lib/format";
import type { FleetAsset } from "./types";

/**
 * Sortable column ids deliberately match the `sortBy` values accepted by
 * `/api/portal/assets` — the page maps the table's sorting state straight to
 * query params. Columns outside that enum keep `enableSorting: false`.
 */
export const fleetColumns: ColumnDef<FleetAsset>[] = [
  {
    accessorKey: "tag",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Tag" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs font-medium tabular-nums">
        {row.original.tag}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Instrumento" />
    ),
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
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {row.original.serialNumber}
      </span>
    ),
  },
  {
    id: "calibrationStatus",
    header: "Status",
    cell: ({ row }) => {
      const status = getInstrumentStatus(row.original);
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
    // Sorting by the last calibration date orders the fleet by how recently
    // each instrument was certified — the server has no per-certificate sort.
    accessorKey: "lastCalibrationDate",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Último certificado" />
    ),
    cell: ({ row }) => {
      const certificate = row.original.lastCertificate;
      if (!certificate) {
        return <span className="text-muted-foreground text-sm">—</span>;
      }
      return (
        <div className="text-sm">
          <Link
            to="/certificates/$id"
            params={{ id: String(certificate.id) }}
            className="font-mono tabular-nums hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {certificate.jobId}
          </Link>
          <p className="text-muted-foreground text-xs">
            {formatDate(certificate.approvedAt)}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "nextCalibrationDate",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Próx. calibração" />
    ),
    cell: ({ row }) => {
      const status = getInstrumentStatus({
        nextCalibrationDate: row.original.nextCalibrationDate,
      });
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
