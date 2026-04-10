import {
  BriefcaseIcon,
  CustomerSupportIcon,
  Home01Icon,
  Invoice02Icon,
  LeftToRightListDashIcon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'

import { NavMain } from './nav-main'
import { NavUser } from './nav-user'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

const platformItems = [
  {
    title: 'Visão Geral',
    url: '/backoffice',
    icon: <HugeiconsIcon icon={Home01Icon} />,
  },
  {
    title: 'Organizações',
    url: '/backoffice/organizations',
    icon: <HugeiconsIcon icon={BriefcaseIcon} />,
  },
  {
    title: 'Usuários',
    url: '/backoffice/users',
    icon: <HugeiconsIcon icon={UserIcon} />,
  },
]

const operationsItems = [
  {
    title: 'Comercial',
    url: '/backoffice/commercial-checkouts',
    icon: <HugeiconsIcon icon={Invoice02Icon} />,
  },
  {
    title: 'Customer Success',
    url: '/backoffice/customer-success',
    icon: <HugeiconsIcon icon={CustomerSupportIcon} />,
    items: [
      { title: 'Contas', url: '/backoffice/customer-success' },
      { title: 'Tickets', url: '/backoffice/customer-success/tickets' },
    ],
  },
  {
    title: 'Suporte',
    url: '/backoffice/support',
    icon: <HugeiconsIcon icon={UserGroupIcon} />,
  },
]

export function BackofficeSidebar() {
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="px-2 pt-2">
        <div className="rounded-lg border bg-sidebar-accent/40 px-3 py-2">
          <p className="text-sm font-semibold">Backoffice</p>
          <p className="text-xs text-muted-foreground">
            Operação interna da plataforma
          </p>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={platformItems} label="Plataforma" />
        <NavMain items={operationsItems} label="Operação" />
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
