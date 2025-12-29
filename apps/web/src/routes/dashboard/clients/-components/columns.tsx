import { type ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"

export interface Client {
    id: number
    name: string
    taxId: string | null
    email: string | null
    authOrganizationId: string | null
}

export const clientsColumns: ColumnDef<Client>[] = [
    {
        accessorKey: "name",
        header: "Nome",
        cell: ({ row }) => (
            <span className="font-medium">{row.original.name}</span>
        ),
    },
    {
        accessorKey: "taxId",
        header: "CNPJ/CPF",
        cell: ({ row }) => row.original.taxId || "-",
    },
    {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => row.original.email || "-",
    },
    {
        accessorKey: "authOrganizationId",
        header: "Portal",
        cell: ({ row }) =>
            row.original.authOrganizationId ? (
                <Badge variant="secondary">Vinculado</Badge>
            ) : (
                <Badge variant="outline">Não vinculado</Badge>
            ),
    },
]
