import { useDeferredValue, useState } from 'react'
import { Building01Icon } from '@hugeicons/core-free-icons'

import { parsePlatformRoles } from '@calibra-facil/auth/access'
import { useBackofficeSession } from '@calibra-facil/auth/client'
import {
  useBackofficeOrganizationOptionsData,
  useBackofficeUsersData,
} from '@/features/backoffice/queries'
import type { BackofficeUser } from '@/features/backoffice/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ConsoleEmpty,
  ConsolePageHeader,
  ConsoleSearch,
  SectionPanel,
  StatusChip,
} from '@/features/backoffice/console'
import { cn } from '@/lib/utils'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { toast } from 'sonner'
import {
  USERS_VIEWS,
  USER_VIEW_FILTERS,
  getInitials,
  getMembershipSummary,
  getPlatformRoleHint,
  getPlatformRoleLabel,
  getSessionRole,
  getAssignablePlatformRole,
  type UsersView,
} from './model'
import { useUserMutations } from './mutations'
import { CreateUserDialog } from './create-user-dialog'
import { UserActionsMenu } from './user-actions-menu'

export function BackofficeUsersPage({
  impersonationError,
}: {
  impersonationError?: string
}) {
  const { data: session } = useBackofficeSession()
  const mutations = useUserMutations()

  const [view, setView] = useState<UsersView>('team')
  const [search, setSearch] = useState('')
  const [organizationId, setOrganizationId] = useState('')
  const deferredSearch = useDeferredValue(search)

  const canManageRoles = parsePlatformRoles(
    getSessionRole(session?.user),
  ).includes('platform_admin')
  const currentUserId = session?.user?.id

  const viewFilters = USER_VIEW_FILTERS[view]
  const organizationsQuery = useBackofficeOrganizationOptionsData()
  const usersQuery = useBackofficeUsersData({
    search: deferredSearch,
    organizationId,
    platformRole: viewFilters.platformRole,
    membershipScope: viewFilters.membershipScope,
  })

  const users = usersQuery.data?.users ?? []
  const total = usersQuery.data?.total ?? 0
  const showLabFilter = view !== 'team'

  return (
    <div className="space-y-5">
      {impersonationError ? (
        <ToastOnMount key={impersonationError} message={impersonationError} />
      ) : null}

      <ConsolePageHeader
        eyebrow="Governança"
        title="Equipe & usuários"
        description="Time interno e usuários de laboratório, separados — com papéis, acesso e ações no lugar certo."
        actions={
          canManageRoles ? (
            <CreateUserDialog createUser={mutations.createUser} />
          ) : null
        }
      />

      <SectionPanel
        eyebrow="Base de usuários"
        title="Diretório"
        description="Escolha a população, busque e aja diretamente em cada conta."
        contentClassName="space-y-4"
      >
        {/* Population segmented control — the internal team vs lab users */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-muted/60 p-1">
            {USERS_VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,color]',
                  view === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <StatusChip tone="neutral">
            {total} {total === 1 ? 'usuário' : 'usuários'}
          </StatusChip>
        </div>

        {/* Toolbar — search + lab filter (only where lab users are shown) */}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <ConsoleSearch
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome ou email…"
          />
          {showLabFilter ? (
            <NativeSelect
              className="sm:w-64"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              <NativeSelectOption value="">
                Todos os laboratórios
              </NativeSelectOption>
              {(organizationsQuery.data?.data ?? []).map((organization) => (
                <NativeSelectOption key={organization.id} value={organization.id}>
                  {organization.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Usuário</th>
                <th className="px-4 py-2.5 font-medium">Acesso</th>
                <th className="px-4 py-2.5 font-medium">Laboratórios</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="w-12 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {usersQuery.isPending ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <tr key={index} className="border-b border-border/40">
                    <td className="px-4 py-3" colSpan={5}>
                      <Skeleton className="h-9 w-full rounded-lg" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10">
                    <ConsoleEmpty
                      icon={Building01Icon}
                      title="Nenhum usuário"
                      description="Ajuste a população ou a busca para encontrar contas."
                    />
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isCurrentUser={user.id === currentUserId}
                    canManageRoles={canManageRoles}
                    mutations={mutations}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionPanel>
    </div>
  )
}

function UserRow({
  user,
  isCurrentUser,
  canManageRoles,
  mutations,
}: {
  user: BackofficeUser
  isCurrentUser: boolean
  canManageRoles: boolean
  mutations: ReturnType<typeof useUserMutations>
}) {
  const role = getAssignablePlatformRole(user.role)
  const roleTone = role === 'platform_admin' ? 'info' : role === 'platform_operator' ? 'neutral' : 'neutral'

  return (
    <tr className="border-b border-border/40 align-middle last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="text-xs font-medium">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{user.name}</span>
              {isCurrentUser ? (
                <StatusChip tone="info">Você</StatusChip>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusChip tone={roleTone}>{getPlatformRoleLabel(user.role)}</StatusChip>
        <p className="mt-1 text-xs text-muted-foreground">
          {getPlatformRoleHint(user)}
        </p>
      </td>
      <td className="px-4 py-3">
        <MembershipsCell user={user} />
      </td>
      <td className="px-4 py-3">
        {user.banned ? (
          <StatusChip tone="critical">Banida</StatusChip>
        ) : (
          <StatusChip tone="ok">Ativa</StatusChip>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <UserActionsMenu
          user={user}
          isCurrentUser={isCurrentUser}
          canManageRoles={canManageRoles}
          mutations={mutations}
        />
      </td>
    </tr>
  )
}

function MembershipsCell({ user }: { user: BackofficeUser }) {
  if (user.memberships.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="min-h-8 max-w-52" />
        }
      >
        <span className="truncate">{getMembershipSummary(user)}</span>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Vínculos de laboratório
        </p>
        {user.memberships.map((membership) => (
          <div
            key={`${user.id}-${membership.organizationId}`}
            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {membership.organizationName}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                /{membership.organizationSlug}
              </p>
            </div>
            <StatusChip tone="neutral">{membership.memberRole}</StatusChip>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function ToastOnMount({ message }: { message: string }) {
  useMountEffect(() => {
    toast.error(message)
  })
  return null
}
