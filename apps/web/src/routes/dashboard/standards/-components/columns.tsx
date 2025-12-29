import { type ColumnDef } from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import {
    AlertCircleIcon,
    Cancel01Icon,
    CheckmarkCircle02Icon,
    Edit02Icon,
    MoreHorizontalIcon,
    RefreshIcon,
} from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type StandardStatus = "ACTIVE" | "INACTIVE" | "OUT_OF_TOLERANCE" | "SENT_FOR_CALIBRATION"

export interface ReferenceStandard {
    id: number
    name: string
    type: string | null
    serialNumber: string
    manufacturer: string | null
    model: string | null
    certificateNumber: string
    calibratedBy: string | null
    calibrationDate: string
    nextCalibrationDate: string
    referenceValue: number | null
    uncertainty: number | null
    uncertaintyUnit: string | null
    coverageFactor: number
    distribution: "normal" | "rectangular"
    drift: number | null
    certifiedValues: Array<{
        nominal: string
        value: number
        uncertainty: number
        unit: string
    }> | null
    status: StandardStatus
    isExpired: boolean
    daysUntilExpiry: number
    createdAt: string
    updatedAt: string
}

export interface StandardsTableMeta {
    onStatusChange?: (id: number, status: StandardStatus) => void
    onDelete?: (id: number) => void
}

function getCalibrationBadge(daysUntilExpiry: number, isExpired: boolean) {
    if (isExpired) {
        return { variant: "destructive" as const, label: "Vencido" }
    } else if (daysUntilExpiry <= 30) {
        return {
            variant: "outline" as const,
            label: `${daysUntilExpiry} dias`,
            className: "border-orange-500 text-orange-600",
        }
    } else {
        return {
            variant: "outline" as const,
            label: "Válido",
            className: "border-green-500 text-green-600",
        }
    }
}

function getStatusBadge(status: StandardStatus) {
    switch (status) {
        case "ACTIVE":
            return { variant: "default" as const, label: "Ativo" }
        case "INACTIVE":
            return { variant: "secondary" as const, label: "Inativo" }
        case "OUT_OF_TOLERANCE":
            return { variant: "destructive" as const, label: "Fora de Tolerância" }
        case "SENT_FOR_CALIBRATION":
            return { variant: "outline" as const, label: "Em Calibração" }
        default:
            return { variant: "secondary" as const, label: status }
    }
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString("pt-BR")
}

function formatUncertainty(standard: ReferenceStandard): string {
    if (standard.certifiedValues && standard.certifiedValues.length > 0) {
        return `${standard.certifiedValues.length} valores`
    }
    if (standard.uncertainty != null && standard.uncertaintyUnit) {
        return `${standard.uncertainty} ${standard.uncertaintyUnit}`
    }
    return "-"
}

export const standardsColumns: ColumnDef<ReferenceStandard>[] = [
    {
        accessorKey: "name",
        header: "Nome",
        cell: ({ row }) => (
            <div>
                <Link
                    to="/dashboard/standards/$id/edit"
                    params={{ id: String(row.original.id) }}
                    className="font-medium hover:underline"
                >
                    {row.original.name}
                </Link>
                {row.original.type && (
                    <p className="text-sm text-muted-foreground">{row.original.type}</p>
                )}
            </div>
        ),
    },
    {
        accessorKey: "serialNumber",
        header: "N Série",
        cell: ({ row }) => (
            <span className="font-mono text-sm">{row.original.serialNumber}</span>
        ),
    },
    {
        accessorKey: "certificateNumber",
        header: "Certificado",
        cell: ({ row }) => (
            <div>
                <span className="font-mono text-sm">
                    {row.original.certificateNumber}
                </span>
                {row.original.calibratedBy && (
                    <p className="text-xs text-muted-foreground">
                        {row.original.calibratedBy}
                    </p>
                )}
            </div>
        ),
    },
    {
        id: "uncertainty",
        header: "Incerteza (U)",
        cell: ({ row }) => (
            <span className="font-mono text-sm">{formatUncertainty(row.original)}</span>
        ),
    },
    {
        accessorKey: "nextCalibrationDate",
        header: "Próxima Calibração",
        cell: ({ row }) => {
            const calBadge = getCalibrationBadge(
                row.original.daysUntilExpiry,
                row.original.isExpired,
            )
            return (
                <div className="flex items-center gap-2">
                    <span className="text-sm">
                        {formatDate(row.original.nextCalibrationDate)}
                    </span>
                    <Badge
                        variant={calBadge.variant}
                        className={"className" in calBadge ? calBadge.className : undefined}
                    >
                        {calBadge.label}
                    </Badge>
                </div>
            )
        },
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const statusBadge = getStatusBadge(row.original.status)
            return <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        },
    },
    {
        id: "actions",
        cell: ({ row, table }) => {
            const meta = table.options.meta as StandardsTableMeta | undefined

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                        <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            render={(props) => (
                                <Link
                                    {...props}
                                    to="/dashboard/standards/$id/edit"
                                    params={{ id: String(row.original.id) }}
                                    className={cn(props.className, "w-full flex items-center")}
                                >
                                    <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
                                    Editar
                                </Link>
                            )}
                        />
                        <DropdownMenuItem
                            render={(props) => (
                                <Link
                                    {...props}
                                    to="/dashboard/standards/$id/edit"
                                    params={{ id: String(row.original.id) }}
                                    search={{ renew: true }}
                                    className={cn(props.className, "w-full flex items-center")}
                                >
                                    <HugeiconsIcon icon={RefreshIcon} className="mr-2 h-4 w-4" />
                                    Renovar Certificado
                                </Link>
                            )}
                        />
                        <DropdownMenuSeparator />
                        {row.original.status === "ACTIVE" && (
                            <>
                                <DropdownMenuItem
                                    onClick={() =>
                                        meta?.onStatusChange?.(row.original.id, "SENT_FOR_CALIBRATION")
                                    }
                                >
                                    <HugeiconsIcon icon={RefreshIcon} className="mr-2 h-4 w-4" />
                                    Enviar para Calibração
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() =>
                                        meta?.onStatusChange?.(row.original.id, "OUT_OF_TOLERANCE")
                                    }
                                    className="text-orange-600"
                                >
                                    <HugeiconsIcon
                                        icon={AlertCircleIcon}
                                        className="mr-2 h-4 w-4"
                                    />
                                    Marcar Fora de Tolerância
                                </DropdownMenuItem>
                            </>
                        )}
                        {row.original.status !== "ACTIVE" &&
                            row.original.status !== "INACTIVE" && (
                                <DropdownMenuItem
                                    onClick={() =>
                                        meta?.onStatusChange?.(row.original.id, "ACTIVE")
                                    }
                                >
                                    <HugeiconsIcon
                                        icon={CheckmarkCircle02Icon}
                                        className="mr-2 h-4 w-4"
                                    />
                                    Reativar
                                </DropdownMenuItem>
                            )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => meta?.onDelete?.(row.original.id)}
                            className="text-destructive"
                        >
                            <HugeiconsIcon icon={Cancel01Icon} className="mr-2 h-4 w-4" />
                            Remover
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
