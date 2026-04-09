import { type ColumnDef } from "@tanstack/react-table"
import { Link } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import {
    Archive01Icon,
    Copy01Icon,
    Edit02Icon,
    MoreHorizontalIcon,
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

type MethodStatus =
    | "DRAFT"
    | "PENDING_APPROVAL"
    | "TECHNICAL_REVIEWED"
    | "PUBLISHED"
    | "ARCHIVED"

export interface Method {
    id: number
    name: string
    description: string | null
    version: number
    status: MethodStatus
    assetTypeId: number | null
    assetTypeName: string | null
    dataFields: Array<unknown>
    formulas: Array<unknown>
    validations: Array<unknown>
    createdAt: string
    publishedAt: string | null
    parentId: number | null
}

export interface MethodsTableMeta {
    onArchive?: (id: number) => void
    onNewVersion?: (id: number) => void
}

const statusLabels: Record<MethodStatus, string> = {
    DRAFT: "Rascunho",
    PENDING_APPROVAL: "Em aprovação",
    TECHNICAL_REVIEWED: "Revisão técnica",
    PUBLISHED: "Publicado",
    ARCHIVED: "Arquivado",
}

const statusVariants: Record<MethodStatus, "default" | "secondary" | "outline"> = {
    DRAFT: "secondary",
    PENDING_APPROVAL: "outline",
    TECHNICAL_REVIEWED: "outline",
    PUBLISHED: "default",
    ARCHIVED: "outline",
}

export const methodsColumns: ColumnDef<Method>[] = [
    {
        accessorKey: "name",
        header: "Nome",
        cell: ({ row }) => (
            <div>
                <Link
                    to="/dashboard/methods/$id"
                    params={{ id: String(row.original.id) }}
                    className="font-medium hover:underline"
                >
                    {row.original.name}
                </Link>
                {row.original.description && (
                    <p className="text-sm text-muted-foreground truncate max-w-xs">
                        {row.original.description}
                    </p>
                )}
            </div>
        ),
    },
    {
        accessorKey: "assetTypeName",
        header: "Tipo de Instrumento",
        cell: ({ row }) =>
            row.original.assetTypeName || (
                <span className="text-muted-foreground">-</span>
            ),
    },
    {
        accessorKey: "version",
        header: "Versão",
        cell: ({ row }) => `v${row.original.version}`,
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
        id: "fields",
        header: "Campos",
        cell: ({ row }) => (
            <span className="text-muted-foreground">
                {row.original.dataFields.length} campos, {row.original.formulas.length}{" "}
                fórmulas
            </span>
        ),
    },
    {
        id: "actions",
        cell: ({ row, table }) => {
            const meta = table.options.meta as MethodsTableMeta | undefined

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                        <HugeiconsIcon icon={MoreHorizontalIcon} className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {row.original.status === "DRAFT" && (
                            <DropdownMenuItem
                                render={(props) => (
                                    <Link
                                        {...props}
                                        to="/dashboard/methods/$id/edit"
                                        params={{ id: String(row.original.id) }}
                                        className={cn(props.className, "w-full flex items-center")}
                                    >
                                        <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
                                        Editar
                                    </Link>
                                )}
                            />
                        )}
                        {row.original.status === "PUBLISHED" && (
                            <>
                                <DropdownMenuItem
                                    onClick={() => meta?.onNewVersion?.(row.original.id)}
                                >
                                    <HugeiconsIcon icon={Copy01Icon} className="mr-2 h-4 w-4" />
                                    Nova Versão
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => meta?.onArchive?.(row.original.id)}
                                >
                                    <HugeiconsIcon
                                        icon={Archive01Icon}
                                        className="mr-2 h-4 w-4"
                                    />
                                    Arquivar
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
