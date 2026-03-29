import {
  BriefcaseIcon,
  CheckmarkBadge01Icon,
  CreditCardIcon,
  Logout01Icon,
  Notification02Icon,
  SparklesIcon,
  UnfoldMoreIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  backofficeSignOut,
  signOut,
  useBackofficeSession,
  useSession,
} from '@calibra-facil/auth/client'
import { canAccessBackoffice } from '@calibra-facil/auth/access'
import { Link, useLocation } from '@tanstack/react-router'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/utils/api'

export function NavUser() {
  const { isMobile } = useSidebar()
  const location = useLocation()
  const isBackofficePath = location.pathname.startsWith('/backoffice')
  const labSessionQuery = useSession()
  const backofficeSessionQuery = useBackofficeSession()
  const session = isBackofficePath
    ? backofficeSessionQuery.data
    : labSessionQuery.data
  const isPending = isBackofficePath
    ? backofficeSessionQuery.isPending
    : labSessionQuery.isPending

  const getInitials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()

  const handleSignOut = async () => {
    if (isBackofficePath) {
      await backofficeSignOut()
    } else {
      await signOut()
    }
    window.location.replace(
      isBackofficePath ? '/backoffice/sign-in' : '/sign-in',
    )
  }

  const handleStopImpersonating = async () => {
    const res = await api.api.backoffice.impersonation.stop.$post()
    if (res.ok) {
      window.location.assign('/backoffice')
    }
  }

  if (isPending) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="grid flex-1 gap-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  if (!session?.user) {
    return null
  }

  const user = session.user
  const roleCandidate = (user as { role?: unknown }).role
  const userRole = typeof roleCandidate === 'string' ? roleCandidate : null
  const impersonatedBy =
    typeof (session.session as { impersonatedBy?: unknown }).impersonatedBy ===
    'string'
      ? ((session.session as { impersonatedBy?: string }).impersonatedBy ?? null)
      : null
  const showBackoffice = !impersonatedBy && canAccessBackoffice(userRole)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <div className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground flex items-center gap-2">
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.image ?? ''} alt={user.name} />
                <AvatarFallback className="rounded-lg">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto size-4" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={user.image ?? ''} alt={user.name} />
                    <AvatarFallback className="rounded-lg">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <HugeiconsIcon icon={SparklesIcon} />
                Atualizar para Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {showBackoffice ? (
                <DropdownMenuItem>
                  <HugeiconsIcon icon={BriefcaseIcon} />
                  <Link to="/backoffice">Backoffice</Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem>
                <HugeiconsIcon icon={CheckmarkBadge01Icon} />
                <Link to="/dashboard/settings/profile">Conta</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <HugeiconsIcon icon={CreditCardIcon} />
                <Link to="/dashboard/settings/billing">Faturamento</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <HugeiconsIcon icon={Notification02Icon} />
                <Link to="/dashboard/settings/notifications">Notificações</Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {impersonatedBy ? (
              <>
                <DropdownMenuItem onClick={handleStopImpersonating}>
                  <HugeiconsIcon icon={BriefcaseIcon} />
                  Parar impersonação
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onClick={handleSignOut}>
              <HugeiconsIcon icon={Logout01Icon} />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
