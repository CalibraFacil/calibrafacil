import {
  Building02Icon,
  CustomerSupportIcon,
  DashboardSquare01Icon,
  Invoice02Icon,
  LeftToRightListDashIcon,
  ShieldKeyIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation } from '@tanstack/react-router'

import { NavUser } from './nav-user'
import { BrandMark } from '@/components/brand'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { usePathPrewarmIntent } from '@/lib/use-route-prewarm-intent'

type IconType = Parameters<typeof HugeiconsIcon>[0]['icon']

type NavItem = {
  title: string
  url: string
  icon: IconType
  exact?: boolean
}

const operationsItems: ReadonlyArray<NavItem> = [
  {
    title: 'Comando',
    url: '/backoffice',
    icon: DashboardSquare01Icon,
    exact: true,
  },
  { title: 'Contas', url: '/backoffice/accounts', icon: Building02Icon },
  { title: 'Suporte', url: '/backoffice/support', icon: CustomerSupportIcon },
]

const platformItems: ReadonlyArray<NavItem> = [
  {
    title: 'Receita',
    url: '/backoffice/commercial-checkouts',
    icon: Invoice02Icon,
  },
  { title: 'Equipe', url: '/backoffice/users', icon: UserGroupIcon },
  { title: 'Auditoria', url: '/backoffice/audit', icon: ShieldKeyIcon },
]

export function BackofficeSidebar() {
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="px-2 pt-2">
        {/* Expanded: logo + wordmark; the box hides on the icon rail. */}
        <div className="flex items-center gap-2.5 overflow-hidden rounded-lg border bg-sidebar-accent/40 px-3 py-2 group-data-[collapsible=icon]:hidden">
          <BrandMark className="size-8 shrink-0" alt="" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Centro de operações
            </p>
            <p className="truncate text-sm font-semibold">Backoffice</p>
          </div>
        </div>
        {/* Collapsed: just the centered logo mark, sized to the rail. */}
        <div className="hidden justify-center group-data-[collapsible=icon]:flex">
          <BrandMark className="size-8" alt="Backoffice" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavSection label="Operação" items={operationsItems} />
        <NavSection label="Plataforma" items={platformItems} />
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link to="/dashboard" />} size="sm">
                  <HugeiconsIcon icon={LeftToRightListDashIcon} />
                  <span>Ir para o dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function NavSection({
  label,
  items,
}: {
  label: string
  items: ReadonlyArray<NavItem>
}) {
  const location = useLocation()

  const isActive = (item: NavItem) =>
    item.exact
      ? location.pathname === item.url
      : location.pathname === item.url ||
        location.pathname.startsWith(`${item.url}/`)

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <NavRow key={item.url} item={item} active={isActive(item)} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const prewarmIntentHandlers = usePathPrewarmIntent(item.url)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to={item.url} />}
        isActive={active}
        tooltip={item.title}
        {...prewarmIntentHandlers}
      >
        <HugeiconsIcon icon={item.icon} />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
