import {
  AlertCircleIcon,
  Book02Icon,
  Building02Icon,
  Certificate01Icon,
  ClipboardIcon,
  CreditCardIcon,
  CustomerSupportIcon,
  Home01Icon,
  PieChartIcon,
  Settings05Icon,
  TaskAdd01Icon,
  UserIcon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useActiveOrganization } from '@calibra-facil/auth/client'

import { OrganizationSwitcher } from './organization-switcher'
import { NavMain } from './nav-main'
import { NavUser } from './nav-user'
import { SidebarSearch } from './sidebar-search'
import { usePlanAccess } from '@/hooks/use-plan-access'

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
        { title: 'Competências do Pessoal', url: '/dashboard/personnel' },
      ],
    },
    {
      title: 'Serviços',
      url: '/dashboard/services',
      icon: <HugeiconsIcon icon={TaskAdd01Icon} />,
    },
    {
      title: 'Ordens de Serviço',
      url: '/dashboard/jobs',
      icon: <HugeiconsIcon icon={ClipboardIcon} />,
    },
    {
      title: 'Editor de Certificados',
      url: '/dashboard/certificate-designer',
      icon: <HugeiconsIcon icon={Certificate01Icon} />,
    },
    {
      title: 'Solicitações',
      url: '/dashboard/requests',
      icon: <HugeiconsIcon icon={TaskAdd01Icon} />,
    },
    {
      title: 'Qualidade',
      url: '#',
      icon: <HugeiconsIcon icon={AlertCircleIcon} />,
      items: [
        { title: 'Não Conformidades', url: '/dashboard/nc' },
        { title: 'Ações Corretivas (CAPA)', url: '/dashboard/capa' },
      ],
    },
  ],
  navSecondary: [
    {
      title: 'Documentação',
      url: 'https://docs.calibrafacil.com',
      icon: <HugeiconsIcon icon={Book02Icon} />,
    },
  ],
}

export function AppSidebar() {
  const { data: activeOrg } = useActiveOrganization()
  const accessQuery = usePlanAccess()
  const currentRole =
    typeof activeOrg?.members?.[0]?.role === 'string'
      ? activeOrg.members[0].role
      : 'member'
  const canAccessConsolidatedReports =
    currentRole === 'owner' || currentRole === 'admin'
  const canAccessFinance =
    (currentRole === 'owner' || currentRole === 'admin') &&
    Boolean(accessQuery.data?.hasFinancialModule)

  const navMain = canAccessFinance
    ? [
        ...data.navMain,
        {
          title: 'Financeiro',
          url: '#',
          icon: <HugeiconsIcon icon={CreditCardIcon} />,
          items: [
            { title: 'Visão geral', url: '/dashboard/finance' },
            { title: 'Documentos', url: '/dashboard/finance/documents' },
            { title: 'Recebimentos', url: '/dashboard/finance/receipts' },
            { title: 'Contratos', url: '/dashboard/finance/contracts' },
            { title: 'ERP', url: '/dashboard/finance/erp' },
          ],
        },
      ]
    : data.navMain

  const managementItems = [
    ...(canAccessConsolidatedReports
      ? [
          {
            title: 'Relatórios',
            url: '/dashboard/reports',
            icon: <HugeiconsIcon icon={PieChartIcon} />,
          },
        ]
      : []),
    {
      title: 'Customer Success',
      url: '/dashboard/customer-success',
      icon: <HugeiconsIcon icon={CustomerSupportIcon} />,
      items: [
        {
          title: 'Área do laboratório',
          url: '/dashboard/customer-success',
        },
      ],
    },
    {
      title: 'Configurações',
      url: '/dashboard/settings',
      icon: <HugeiconsIcon icon={Settings05Icon} />,
    },
  ]

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
              {data.navSecondary.map((item) => (
                <SidebarMenuItem key={item.title}>
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
