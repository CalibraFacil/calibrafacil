import {
  Analytics01Icon,
  AlertCircleIcon,
  Book02Icon,
  BoxIcon,
  Building02Icon,
  ClipboardIcon,
  CreditCardIcon,
  Location01Icon,
  File02Icon,
  RepairIcon,
  Files01Icon,
  Wallet03Icon,
  Home01Icon,
  Notebook01Icon,
  RulerIcon,
  Settings05Icon,
  TaskAdd02Icon,
  DocumentValidationIcon,
  UserGroupIcon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useActiveOrganization } from '@calibra-facil/auth/client'

import {
  dashboardManagementNavItems,
  dashboardPrimaryNavItems,
  dashboardSecondaryNavItems,
  filterDashboardNavItems,
  type DashboardIconId,
  type DashboardNavItem,
} from '@/app/router/route-meta'
import { OrganizationSwitcher } from './organization-switcher'
import { isDesktopRuntime } from '@/runtime/desktop'
import { NavMain } from './nav-main'
import { NavUser } from './nav-user'
import { SidebarSearch } from './sidebar-search'

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

const dashboardIconMap = {
  analytics: Analytics01Icon,
  assets: Wrench01Icon,
  building: Building02Icon,
  clipboard: ClipboardIcon,
  creditCard: CreditCardIcon,
  customers: UserIcon,
  documentation: Book02Icon,
  file: File02Icon,
  home: Home01Icon,
  jobs: RepairIcon,
  materials: BoxIcon,
  methods: Notebook01Icon,
  personnel: UserGroupIcon,
  quality: AlertCircleIcon,
  requests: DocumentValidationIcon,
  ruler: RulerIcon,
  services: TaskAdd02Icon,
  serviceOrders: Files01Icon,
  settings: Settings05Icon,
  visits: Location01Icon,
  wallet: Wallet03Icon,
} satisfies Record<DashboardIconId, typeof Home01Icon>

function toNavMainItems(items: DashboardNavItem[]) {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    // What the guided tour points at (features/onboarding/interface-tour.ts).
    tourId: `nav-${item.icon}`,
    icon: <HugeiconsIcon icon={dashboardIconMap[item.icon]} />,
    items: item.items?.map((subItem) => ({
      title: subItem.title,
      url: subItem.url,
      icon: <HugeiconsIcon icon={dashboardIconMap[subItem.icon]} />,
    })),
  }))
}

export function AppSidebar() {
  const { data: activeOrg } = useActiveOrganization()
  const currentRole =
    typeof activeOrg?.members?.[0]?.role === 'string'
      ? activeOrg.members[0].role
      : 'member'
  const canAccessAdminOrOwner =
    currentRole === 'owner' || currentRole === 'admin'
  // Finance is a cloud-only module; the desktop shell never lists it.
  const canAccessFinance = canAccessAdminOrOwner && !isDesktopRuntime()

  const navAccess = { canAccessFinance, canAccessAdminOrOwner }
  const navMain = toNavMainItems(
    filterDashboardNavItems(dashboardPrimaryNavItems, navAccess),
  )
  const managementItems = toNavMainItems(
    filterDashboardNavItems(dashboardManagementNavItems, navAccess),
  )
  const secondaryItems = toNavMainItems(
    filterDashboardNavItems(dashboardSecondaryNavItems, navAccess),
  )

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher />
        <SidebarSearch />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavMain items={managementItems} label="Gestão" />
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryItems.map((item) => (
                <SidebarMenuItem key={item.title} data-tour={item.tourId}>
                  <SidebarMenuButton
                    render={
                      item.url.startsWith('http') ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ) : item.url.startsWith('#') ? (
                        <a href={item.url} />
                      ) : (
                        <Link to={item.url} />
                      )
                    }
                    size="sm"
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
