import {
  Book02Icon,
  Building02Icon,
  ClipboardIcon,
  CropIcon,
  CustomerSupportIcon,
  Home01Icon,
  MapsIcon,
  PieChartIcon,
  Settings05Icon,
  TaskAdd01Icon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'

import { OrganizationSwitcher } from './organization-switcher'
import { NavMain } from './nav-main'
import { NavProjects } from './nav-projects'
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

const data = {
  navMain: [
    {
      title: 'Painel',
      url: '/dashboard',
      icon: <HugeiconsIcon icon={Home01Icon} />,
      isActive: true,
    },
    {
      title: 'Clientes',
      url: '/dashboard/clients',
      icon: <HugeiconsIcon icon={UserIcon} />,
    },
    {
      title: 'Ativos',
      url: '/dashboard/assets',
      icon: <HugeiconsIcon icon={Wrench01Icon} />,
    },
    {
      title: 'Laboratório',
      url: '#',
      icon: <HugeiconsIcon icon={Building02Icon} />,
      items: [
        { title: 'Métodos de Calibração', url: '/dashboard/methods' },
        { title: 'Padrões de Referência', url: '/dashboard/standards' },
      ],
    },
    {
      title: 'Servicos',
      url: '/dashboard/services',
      icon: <HugeiconsIcon icon={TaskAdd01Icon} />,
    },
    {
      title: 'Ordens de Servico',
      url: '/dashboard/jobs',
      icon: <HugeiconsIcon icon={ClipboardIcon} />,
    },
  ],
  navSecondary: [
    {
      title: 'Configurações',
      url: '/dashboard/settings',
      icon: <HugeiconsIcon icon={Settings05Icon} />,
    },
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
      name: 'Engenharia de Métodos',
      url: '#',
      icon: CropIcon,
    },
    {
      name: 'Relatórios',
      url: '#',
      icon: PieChartIcon,
    },
    {
      name: 'Compliance',
      url: '#',
      icon: MapsIcon,
    },
  ],
}

export function AppSidebar() {
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher />
        <SidebarSearch />
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
          <NavUser />
        </SidebarFooter>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
