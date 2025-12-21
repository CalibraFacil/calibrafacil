import {
  Book02Icon,
  Building02Icon,
  ChartIcon,
  CropIcon,
  CustomerSupportIcon,
  File01Icon,
  Home01Icon,
  MapsIcon,
  PieChartIcon,
  Settings05Icon,
  ShoppingBag01Icon,
  ShoppingCart01Icon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'

import { OrganizationSwitcher } from './organization-switcher'
import { NavMain } from './nav-main'
import { NavProjects } from './nav-projects'
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

const data = {
  user: {
    name: 'Usuário Exemplo',
    email: 'maintainer@example.com',
    avatar: '/avatars/pedro.jpg',
  },
  organizations: [
    {
      name: 'Acme Inc',
      logo: Building02Icon,
      plan: 'Enterprise',
    },
    {
      name: 'Acme Corp.',
      logo: Building02Icon,
      plan: 'Startup',
    },
    {
      name: 'Evil Corp.',
      logo: Building02Icon,
      plan: 'Free',
    },
  ],
  navMain: [
    {
      title: 'Painel de Controle',
      url: '/dashboard',
      icon: <HugeiconsIcon icon={Home01Icon} />,
      isActive: true,
    },
    {
      title: 'Analytics',
      url: '#',
      icon: <HugeiconsIcon icon={ChartIcon} />,
      items: [
        { title: 'Reports', url: '#' },
        { title: 'Metrics', url: '#' },
      ],
    },
    {
      title: 'Orders',
      url: '#',
      icon: <HugeiconsIcon icon={ShoppingBag01Icon} />,
      items: [
        { title: 'All Orders', url: '#' },
        { title: 'Pending', url: '#' },
        { title: 'Completed', url: '#' },
      ],
    },
    {
      title: 'Products',
      url: '#',
      icon: <HugeiconsIcon icon={ShoppingCart01Icon} />,
      items: [
        { title: 'All Products', url: '#' },
        { title: 'Categories', url: '#' },
      ],
    },
    {
      title: 'Invoices',
      url: '#',
      icon: <HugeiconsIcon icon={File01Icon} />,
    },
    {
      title: 'Customers',
      url: '#',
      icon: <HugeiconsIcon icon={UserIcon} />,
    },
    {
      title: 'Configurações',
      url: '/dashboard/settings',
      icon: <HugeiconsIcon icon={Settings05Icon} />,
    },
  ],
  navSecondary: [
    {
      title: 'Suporte',
      url: '/support',
      icon: <HugeiconsIcon icon={CustomerSupportIcon} />,
    },
    {
      title: 'Documentação',
      url: '/documentation',
      icon: <HugeiconsIcon icon={Book02Icon} />,
    },
  ],
  projects: [
    {
      name: 'Design Engineering',
      url: '#',
      icon: CropIcon,
    },
    {
      name: 'Sales & Marketing',
      url: '#',
      icon: PieChartIcon,
    },
    {
      name: 'Travel',
      url: '#',
      icon: MapsIcon,
    },
  ],
}

export function AppSidebar() {
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher organizations={data.organizations} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.projects} />
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {data.navSecondary.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={
                      item.url.startsWith('#') ? (
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
          <NavUser user={data.user} />
        </SidebarFooter>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
