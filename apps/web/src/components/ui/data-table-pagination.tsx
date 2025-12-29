import { Button } from "@/components/ui/button"

interface DataTablePaginationProps {
    page: number
    totalPages: number
    total: number
    limit: number
    onPageChange: (page: number) => void
    itemName?: string
}

export function DataTablePagination({
    page,
    totalPages,
    total,
    limit,
    onPageChange,
    itemName = "itens",
}: DataTablePaginationProps) {
    const startItem = (page - 1) * limit + 1
    const endItem = Math.min(page * limit, total)

    return (
        <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
                Mostrando {startItem} a {endItem} de {total} {itemName}
            </p>
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page === 1}
                >
                    Anterior
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages}
                >
                    Próximo
                </Button>
            </div>
        </div>
    )
}
