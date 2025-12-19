import {
  ChartIcon,
  ChartRingIcon,
  File01Icon,
  Home01Icon,
  Settings05Icon,
  ShoppingBag01Icon,
  ShoppingCart01Icon,
  UserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { NavMain } from './nav-main'
import { ModeToggle } from './mode-toggle'

import type { ReactNode } from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'

export function AppSidebar({ children }: { children: ReactNode }) {
  const data = {
    navMain: [
      {
        title: 'Dashboard',
        url: '#',
        icon: <HugeiconsIcon icon={Home01Icon} />,
        isActive: true,
        items: [
          { title: 'Overview', url: '#' },
          { title: 'Analytics', url: '#' },
        ],
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
        title: 'Settings',
        url: '#',
        icon: <HugeiconsIcon icon={Settings05Icon} />,
      },
    ],
    navSecondary: [
      {
        title: 'Support',
        url: '#',
        icon: <HugeiconsIcon icon={ChartRingIcon} />,
      },
      {
        title: 'Feedback',
        url: '#',
        icon: <HugeiconsIcon icon={ChartRingIcon} />,
      },
    ],
  }

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarContent>
          <NavMain items={data.navMain} />
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                {data.navSecondary.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton render={<a href={item.url} />} size="sm">
                      {item.icon}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-16 items-center justify-between gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <ModeToggle />
        </header>

        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
