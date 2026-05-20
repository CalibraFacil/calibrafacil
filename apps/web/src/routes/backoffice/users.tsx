import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ColumnDef,
  type ExpandedState,
  type Row,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { toast } from 'sonner'

import { parsePlatformRoles } from '@calibra-facil/auth/access'
import { useBackofficeSession } from '@calibra-facil/auth/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DataTableColumnHeader } from '@/components/ui/data-table-column-header'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { calibraApi, resolveCloudApiUrl } from '@/utils/api'
import { useMountEffect } from '@/hooks/use-mount-effect'

export const Route = createFileRoute('/backoffice/users')({
  validateSearch: (search: Record<string, unknown>) => ({
    impersonationError:
      typeof search.impersonationError === 'string'
        ? search.impersonationError
        : undefined,
  }),
  component: BackofficeUsersPage,
})

type BackofficeUserMembership = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  memberRole: string
}

type BackofficeUser = {
  id: string
  name: string
  email: string
  role?: string | null
  banned?: boolean | null
  createdAt?: string | Date | null
  memberships: BackofficeUserMembership[]
}

type OrganizationOption = {
  id: string
  name: string
  slug: string
}

type UserFilters = {
  search: string
  organizationId: string
  platformRole:
    | 'all'
    | 'user'
    | 'platform_operator'
    | 'platform_admin'
    | 'platform_access'
  membershipScope:
    | 'all'
    | 'lab_members'
    | 'no_lab_membership'
    | 'backoffice_only'
}

type AssignablePlatformRole = 'user' | 'platform_operator' | 'platform_admin'

type EntityMutation<TVariables> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
}

const platformRoleOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'platform_access', label: 'Com backoffice' },
  { value: 'platform_admin', label: 'Admins' },
  { value: 'platform_operator', label: 'Operadores' },
  { value: 'user', label: 'Sem backoffice' },
] as const

const membershipScopeOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'lab_members', label: 'Com LAB' },
  { value: 'no_lab_membership', label: 'Sem LAB' },
  { value: 'backoffice_only', label: 'Só backoffice' },
] as const

function getAssignablePlatformRole(
  role: BackofficeUser['role'],
): AssignablePlatformRole {
  return role === 'platform_admin' || role === 'platform_operator'
    ? role
    : 'user'
}

function getPlatformRoleLabel(role: BackofficeUser['role']) {
  switch (getAssignablePlatformRole(role)) {
    case 'platform_admin':
      return 'Admin'
    case 'platform_operator':
      return 'Operador'
    default:
      return 'Sem backoffice'
  }
}

function getPlatformRoleHint(user: BackofficeUser) {
  const role = getAssignablePlatformRole(user.role)

  if (role === 'user') {
    return user.memberships.length > 0
      ? 'Opera apenas no LAB'
      : 'Conta sem acesso interno'
  }

  return user.memberships.length > 0
    ? 'Conta híbrida: plataforma + LAB'
    : 'Conta exclusivamente interna'
}

function getMembershipSummary(user: BackofficeUser) {
  if (user.memberships.length === 0) {
    return 'Sem vínculo LAB'
  }

  if (user.memberships.length === 1) {
    return user.memberships[0]?.organizationName ?? '1 laboratório'
  }

  return `${user.memberships[0]?.organizationName ?? '1 laboratório'} +${user.memberships.length - 1}`
}

function formatCreatedAt(value: BackofficeUser['createdAt']) {
  if (!value) {
    return 'Data indisponível'
  }

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Data indisponível'
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
  }).format(date)
}

function BackofficeUsersPage() {
  const queryClient = useQueryClient()
  const { data: session } = useBackofficeSession()
  const { impersonationError } = Route.useSearch()
  const [draft, setDraft] = useState({
    name: '',
    email: '',
    role: 'platform_operator' as 'platform_operator' | 'platform_admin',
  })
  const [filters, setFilters] = useState<UserFilters>({
    search: '',
    organizationId: '',
    platformRole: 'all',
    membershipScope: 'all',
  })
  const [sorting, setSorting] = useState<SortingState>([])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const deferredSearch = useDeferredValue(filters.search)
  const sessionRole =
    session?.user &&
    typeof (session.user as { role?: unknown }).role === 'string'
      ? ((session.user as { role?: string }).role ?? null)
      : null

  const currentPlatformRoles = useMemo(
    () => parsePlatformRoles(sessionRole),
    [sessionRole],
  )
  const canManageRoles = currentPlatformRoles.includes('platform_admin')

  const organizationsQuery = useQuery({
    queryKey: ['backoffice', 'organizations', 'options'],
    queryFn: async () => {
      const data = await calibraApi.backoffice.listOrganizations<{
        data: OrganizationOption[]
      }>()
      return data.data
    },
  })

  const usersQuery = useQuery({
    queryKey: [
      'backoffice',
      'users',
      {
        search: deferredSearch,
        organizationId: filters.organizationId,
        platformRole: filters.platformRole,
        membershipScope: filters.membershipScope,
      },
    ],
    queryFn: async () =>
      calibraApi.backoffice.listUsers<{
        users: BackofficeUser[]
        total: number
      }>({
        search: deferredSearch || undefined,
        organizationId: filters.organizationId || undefined,
        platformRole: filters.platformRole,
        membershipScope: filters.membershipScope,
      }),
  })

  const invalidateUsers = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['backoffice', 'users'],
    })
  }

  const setRoleMutation = useMutation({
    mutationFn: async ({
      userId,
      role,
    }: {
      userId: string
      role: AssignablePlatformRole
    }) => {
      return calibraApi.backoffice.updateUserRole(userId, role)
    },
    onSuccess: async () => {
      toast.success('Papel de plataforma atualizado')
      await invalidateUsers()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar papel',
      )
    },
  })

  const banMutation = useMutation({
    mutationFn: async (userId: string) => {
      return calibraApi.backoffice.banUser(userId)
    },
    onSuccess: async () => {
      toast.success('Usuário banido')
      await invalidateUsers()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao banir usuário',
      )
    },
  })

  const unbanMutation = useMutation({
    mutationFn: async (userId: string) => {
      return calibraApi.backoffice.unbanUser(userId)
    },
    onSuccess: async () => {
      toast.success('Usuário reabilitado')
      await invalidateUsers()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao reabilitar usuário',
      )
    },
  })

  const impersonateMutation = useMutation({
    mutationFn: async (userId: string) => {
      return calibraApi.backoffice.impersonateUser<{ redirectPath: string }>(
        userId,
      )
    },
    onSuccess: (data) => {
      window.location.assign(resolveCloudApiUrl(data.redirectPath))
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao iniciar impersonação',
      )
    },
  })

  const createUserMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.backoffice.createUser<{
        passwordSetupRequested: boolean
        passwordSetupMessage: string
      }>(draft)
    },
    onSuccess: async (data) => {
      toast.success(
        data.passwordSetupRequested
          ? 'Usuário interno criado e email de definição de senha enviado'
          : data.passwordSetupMessage,
      )
      setDraft({
        name: '',
        email: '',
        role: 'platform_operator',
      })
      await invalidateUsers()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao criar usuário',
      )
    },
  })

  const requestPasswordSetupMutation = useMutation({
    mutationFn: async (userId: string) => {
      return calibraApi.backoffice.requestUserPasswordReset(userId)
    },
    onSuccess: () => {
      toast.success('Email de definição de senha solicitado')
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao solicitar definição de senha',
      )
    },
  })

  const users = usersQuery.data?.users ?? []
  const total = usersQuery.data?.total ?? 0
  const usersWithLabMembership = users.filter(
    (user) => user.memberships.length > 0,
  ).length
  const backofficeOnlyUsers = users.filter(
    (user) =>
      user.memberships.length === 0 &&
      (user.role === 'platform_operator' || user.role === 'platform_admin'),
  ).length

  const columns = useMemo<ColumnDef<BackofficeUser>[]>(
    () => [
      {
        id: 'expander',
        enableSorting: false,
        header: () => <span className="sr-only">Expandir</span>,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-expanded={row.getIsExpanded()}
            aria-label={
              row.getIsExpanded()
                ? `Recolher ${row.original.name}`
                : `Expandir ${row.original.name}`
            }
            onClick={() => row.toggleExpanded()}
          >
            <HugeiconsIcon
              icon={row.getIsExpanded() ? ArrowUp01Icon : ArrowDown01Icon}
              className="size-4 text-muted-foreground"
              strokeWidth={1.8}
            />
          </Button>
        ),
      },
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Usuário" />
        ),
        cell: ({ row }) => {
          const user = row.original
          const isCurrentUser = user.id === session?.user?.id

          return (
            <div className="flex min-w-56 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{user.name}</span>
                {isCurrentUser ? <Badge variant="outline">Você</Badge> : null}
              </div>
              <span className="text-sm text-muted-foreground">
                {user.email}
              </span>
            </div>
          )
        },
      },
      {
        id: 'scope',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Escopo" />
        ),
        accessorFn: (user) => getAssignablePlatformRole(user.role),
        cell: ({ row }) => {
          const user = row.original
          const role = getAssignablePlatformRole(user.role)

          return (
            <div className="flex min-w-48 flex-col gap-2">
              <Badge variant={role === 'user' ? 'secondary' : 'default'}>
                {getPlatformRoleLabel(role)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {getPlatformRoleHint(user)}
              </span>
            </div>
          )
        },
      },
      {
        id: 'memberships',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Laboratórios" />
        ),
        accessorFn: (user) => user.memberships.length,
        cell: ({ row }) => {
          const user = row.original

          return user.memberships.length > 0 ? (
            <div className="flex min-w-56 flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {user.memberships.length} vínculo
                  {user.memberships.length > 1 ? 's' : ''}
                </Badge>
                <span className="truncate text-sm font-medium">
                  {getMembershipSummary(user)}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Abra a linha para ver papéis por laboratório
              </span>
            </div>
          ) : (
            <div className="flex min-w-40 flex-col gap-1">
              <span className="text-sm font-medium">Sem vínculo LAB</span>
              <span className="text-xs text-muted-foreground">
                Usuário fora da malha operacional
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: 'banned',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) =>
          row.original.banned ? (
            <Badge variant="destructive">Banido</Badge>
          ) : (
            <Badge variant="outline">Ativo</Badge>
          ),
      },
    ],
    [session?.user?.id],
  )

  const table = useReactTable({
    data: users,
    columns,
    state: {
      sorting,
      expanded,
    },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  })

  return (
    <div className="flex flex-col gap-4">
      {impersonationError ? (
        <ToastOnMount key={impersonationError} message={impersonationError} />
      ) : null}
      <div>
        <h1 className="text-2xl font-semibold">Usuários</h1>
        <p className="text-sm text-muted-foreground">
          Gestão de usuários de plataforma com contexto operacional por
          laboratório.
        </p>
      </div>

      {canManageRoles ? (
        <Card>
          <CardHeader>
            <CardTitle>Criar usuário interno</CardTitle>
            <CardDescription>
              O backoffice é invite-only. Após criar a conta, o sistema solicita
              a definição de senha por email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                createUserMutation.mutate()
              }}
            >
              <FieldGroup className="md:col-span-2">
                <Field>
                  <FieldLabel htmlFor="platformUserName">Nome</FieldLabel>
                  <Input
                    id="platformUserName"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="platformUserEmail">Email</FieldLabel>
                  <Input
                    id="platformUserEmail"
                    type="email"
                    value={draft.email}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="platformUserRole">Papel</FieldLabel>
                  <NativeSelect
                    id="platformUserRole"
                    value={draft.role}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        role: event.target.value as
                          | 'platform_operator'
                          | 'platform_admin',
                      }))
                    }
                  >
                    <NativeSelectOption value="platform_operator">
                      platform_operator
                    </NativeSelectOption>
                    <NativeSelectOption value="platform_admin">
                      platform_admin
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field className="md:col-span-2">
                  <Button
                    type="submit"
                    disabled={
                      createUserMutation.isPending ||
                      !draft.name.trim() ||
                      !draft.email.trim()
                    }
                  >
                    {createUserMutation.isPending
                      ? 'Criando usuário...'
                      : 'Criar usuário interno'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Base de usuários</CardTitle>
          <CardDescription>
            Visão compacta para acesso de plataforma, vínculo LAB e status da
            conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
            <Field>
              <FieldLabel htmlFor="usersSearch">Busca</FieldLabel>
              <Input
                id="usersSearch"
                placeholder="Nome ou email"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }))
                }
              />
            </Field>
            <div className="flex items-end justify-start lg:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setFilters({
                    search: '',
                    organizationId: '',
                    platformRole: 'all',
                    membershipScope: 'all',
                  })
                }
              >
                Limpar filtros
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Papel de plataforma
                </p>
                <div className="flex flex-wrap gap-2">
                  {platformRoleOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="xs"
                      variant={
                        filters.platformRole === option.value
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          platformRole: option.value,
                        }))
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Vínculo LAB
                </p>
                <div className="flex flex-wrap gap-2">
                  {membershipScopeOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="xs"
                      variant={
                        filters.membershipScope === option.value
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          membershipScope: option.value,
                        }))
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Laboratório
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant={
                      filters.organizationId === '' ? 'default' : 'outline'
                    }
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        organizationId: '',
                      }))
                    }
                  >
                    Todos os laboratórios
                  </Button>
                  {(organizationsQuery.data ?? []).map((organization) => (
                    <Button
                      key={organization.id}
                      type="button"
                      size="xs"
                      variant={
                        filters.organizationId === organization.id
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() =>
                        setFilters((current) => ({
                          ...current,
                          organizationId: organization.id,
                        }))
                      }
                    >
                      {organization.name}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{total} usuários encontrados</Badge>
              <Badge variant="outline">
                {usersWithLabMembership} com vínculo LAB
              </Badge>
              <Badge variant="outline">
                {backofficeOnlyUsers} somente backoffice
              </Badge>
            </div>
            <span className="text-sm text-muted-foreground">
              {filters.organizationId
                ? 'Recorte operacional por laboratório'
                : 'Visão transversal da base'}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <Table className="min-w-[880px]">
              <TableHeader className="bg-muted/30">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {usersQuery.isPending ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={`users-loading-${index}`}>
                      <TableCell>
                        <Skeleton className="h-6 w-6" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="mt-2 h-3 w-52" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-24" />
                        <Skeleton className="mt-2 h-3 w-40" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-28" />
                        <Skeleton className="mt-2 h-3 w-44" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-16" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : table.getRowModel().rows.length > 0 ? (
                  table.getRowModel().rows.map((row) => {
                    const user = row.original
                    const assignableRole = getAssignablePlatformRole(user.role)

                    return (
                      <UserTableRow
                        key={row.id}
                        row={row}
                        user={user}
                        assignableRole={assignableRole}
                        canManageRoles={canManageRoles}
                        banMutation={banMutation}
                        unbanMutation={unbanMutation}
                        impersonateMutation={impersonateMutation}
                        requestPasswordSetupMutation={
                          requestPasswordSetupMutation
                        }
                        setRoleMutation={setRoleMutation}
                      />
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-28 text-center"
                    >
                      Nenhum usuário encontrado para esse recorte.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ToastOnMount({ message }: { message: string }) {
  useMountEffect(() => {
    toast.error(message)
  })

  return null
}

function UserTableRow({
  row,
  user,
  assignableRole,
  canManageRoles,
  banMutation,
  unbanMutation,
  impersonateMutation,
  requestPasswordSetupMutation,
  setRoleMutation,
}: {
  row: Row<BackofficeUser>
  user: BackofficeUser
  assignableRole: AssignablePlatformRole
  canManageRoles: boolean
  banMutation: EntityMutation<string>
  unbanMutation: EntityMutation<string>
  impersonateMutation: EntityMutation<string>
  requestPasswordSetupMutation: EntityMutation<string>
  setRoleMutation: EntityMutation<{
    userId: string
    role: AssignablePlatformRole
  }>
}) {
  return (
    <>
      <TableRow className="align-top">
        {row.getVisibleCells().map((cell) => (
          <TableCell key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
      {row.getIsExpanded() ? (
        <TableRow className="bg-muted/20">
          <TableCell colSpan={row.getVisibleCells().length} className="p-0">
            <div className="grid gap-4 border-t p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(280px,0.9fr)]">
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Resumo operacional
                  </p>
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        Conta criada
                      </span>
                      <span className="font-medium">
                        {formatCreatedAt(user.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        Estado da conta
                      </span>
                      <span className="font-medium">
                        {user.banned ? 'Banida' : 'Ativa'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Escopo</span>
                      <span className="text-right font-medium">
                        {getPlatformRoleHint(user)}
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Identidade
                  </p>
                  <div className="mt-2 rounded-lg border bg-background p-3 text-sm">
                    <p className="font-medium">{user.name}</p>
                    <p className="text-muted-foreground">{user.email}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Vínculos LAB
                </p>
                {user.memberships.length > 0 ? (
                  <div className="space-y-2">
                    {user.memberships.map((membership) => (
                      <div
                        key={`${user.id}-${membership.organizationId}`}
                        className="rounded-lg border bg-background p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              {membership.organizationName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              /{membership.organizationSlug}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {membership.memberRole}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed bg-background p-3 text-sm text-muted-foreground">
                    Este usuário não participa de nenhum laboratório no momento.
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Ações
                </p>
                <div className="rounded-lg border bg-background p-3">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Papel de plataforma
                      </p>
                      <NativeSelect
                        value={assignableRole}
                        onChange={(event) =>
                          setRoleMutation.mutate({
                            userId: user.id,
                            role: event.target.value as AssignablePlatformRole,
                          })
                        }
                        disabled={!canManageRoles}
                      >
                        <NativeSelectOption value="user">
                          user
                        </NativeSelectOption>
                        <NativeSelectOption value="platform_operator">
                          platform_operator
                        </NativeSelectOption>
                        <NativeSelectOption value="platform_admin">
                          platform_admin
                        </NativeSelectOption>
                      </NativeSelect>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => impersonateMutation.mutate(user.id)}
                        disabled={impersonateMutation.isPending}
                      >
                        Impersonar
                      </Button>
                      {user.banned ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unbanMutation.mutate(user.id)}
                          disabled={!canManageRoles || unbanMutation.isPending}
                        >
                          Reabilitar
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => banMutation.mutate(user.id)}
                          disabled={!canManageRoles || banMutation.isPending}
                        >
                          Banir
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          requestPasswordSetupMutation.mutate(user.id)
                        }
                        disabled={
                          !canManageRoles ||
                          requestPasswordSetupMutation.isPending
                        }
                      >
                        Enviar setup
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
