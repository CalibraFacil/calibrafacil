import { type ColumnDef } from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import {
    AlertCircleIcon,
    Calendar03Icon,
    MoreHorizontalIcon,
    ViewIcon,
} from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type JobStatus =
    | "DRAFT"
    | "IN_PROGRESS"
    | "REVIEW"
    | "APPROVED"
    | "REJECTED"
    | "CANCELED"

export interface Job {
    id: number
    jobId: string
    status: JobStatus
    dueDate: string | null
    performedAt: string | null
    createdAt: string
    updatedAt: string
    approvedAt: string | null
    customerId: number
    customerName: string | null
    assetId: number
    assetName: string | null
    assetTag: string | null
    serviceId: number
    serviceName: string | null
    technicianId: string | null
    technicianName: string | null
    methodName: string | null
    methodVersion: number | null
    isOverdue: boolean | null
    daysUntilDue: number | null
}

const statusLabels: Record<JobStatus, string> = {
    DRAFT: "Rascunho",
    IN_PROGRESS: "Em Execução",
    REVIEW: "Em Revisão",
    APPROVED: "Aprovado",
    REJECTED: "Rejeitado",
    CANCELED: "Cancelado",
}

const statusVariants: Record<
    JobStatus,
    "default" | "secondary" | "destructive" | "outline"
> = {
    DRAFT: "secondary",
    IN_PROGRESS: "default",
    REVIEW: "outline",
    APPROVED: "default",
    REJECTED: "destructive",
    CANCELED: "secondary",
}

function formatDate(dateString: string | null): string {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("pt-BR")
}

export const jobsColumns: ColumnDef<Job>[] = [
    {
        accessorKey: "jobId",
        header: "OS",
        cell: ({ row }) => (
            <Link
                to="/dashboard/jobs/$id"
                params={{ id: String(row.original.id) }}
                className="font-mono font-medium hover:underline"
            >
                {row.original.jobId}
            </Link>
        ),
    },
    {
        accessorKey: "customerName",
        header: "Cliente",
        cell: ({ row }) => row.original.customerName || "-",
    },
    {
        accessorKey: "assetName",
        header: "Ativo",
        cell: ({ row }) => (
            <div>
                <span className="font-medium">{row.original.assetName}</span>
                {row.original.assetTag && (
                    <span className="text-sm text-muted-foreground ml-2">
                        ({row.original.assetTag})
                    </span>
                )}
            </div>
        ),
    },
    {
        accessorKey: "serviceName",
        header: "Serviço",
        cell: ({ row }) => (
            <div>
                {row.original.serviceName || "-"}
                {row.original.methodName && (
                    <span className="block text-xs text-muted-foreground">
                        {row.original.methodName} v{row.original.methodVersion}
                    </span>
                )}
            </div>
        ),
    },
    {
        accessorKey: "technicianName",
        header: "Técnico",
        cell: ({ row }) =>
            row.original.technicianName || (
                <span className="text-muted-foreground italic">Não atribuído</span>
            ),
    },
    {
        accessorKey: "dueDate",
        header: "Prazo",
        cell: ({ row }) => (
            <div className="flex items-center gap-2">
                {row.original.isOverdue && (
                    <HugeiconsIcon
                        icon={AlertCircleIcon}
                        className="h-4 w-4 text-destructive"
                    />
                )}
                <span
                    className={
                        row.original.isOverdue ? "text-destructive font-medium" : ""
                    }
                >
                    {formatDate(row.original.dueDate)}
                </span>
                {row.original.daysUntilDue !== null &&
                    row.original.daysUntilDue <= 7 &&
                    row.original.daysUntilDue > 0 && (
                        <Badge variant="outline" className="text-xs">
                            {row.original.daysUntilDue}d
                        </Badge>
                    )}
            </div>
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
        id: "actions",
        cell: ({ row }) => (
            <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                    <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        render={(props) => (
                            <Link
                                {...props}
                                to="/dashboard/jobs/$id"
                                params={{ id: String(row.original.id) }}
                                className={cn(props.className, "w-full flex items-center")}
                            >
                                <HugeiconsIcon icon={ViewIcon} className="mr-2 h-4 w-4" />
                                Ver Detalhes
                            </Link>
                        )}
                    />
                    {row.original.status === "DRAFT" && (
                        <DropdownMenuItem
                            render={(props) => (
                                <Link
                                    {...props}
                                    to="/dashboard/jobs/$id/execute"
                                    params={{ id: String(row.original.id) }}
                                    className={cn(props.className, "w-full flex items-center")}
                                >
                                    <HugeiconsIcon icon={Calendar03Icon} className="mr-2 h-4 w-4" />
                                    Iniciar Execução
                                </Link>
                            )}
                        />
                    )}
                    {(row.original.status === "IN_PROGRESS" || row.original.status === "REJECTED") && (
                        <DropdownMenuItem
                            render={(props) => (
                                <Link
                                    {...props}
                                    to="/dashboard/jobs/$id/execute"
                                    params={{ id: String(row.original.id) }}
                                    className={cn(props.className, "w-full flex items-center")}
                                >
                                    <HugeiconsIcon icon={Calendar03Icon} className="mr-2 h-4 w-4" />
                                    Continuar Execução
                                </Link>
                            )}
                        />
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        ),
    },
]
