import * as React from 'react'

import { PlusSignIcon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function OrganizationSwitcher({
  organizations,
}: {
  organizations: Array<{
    name: string
    logo: IconSvgElement
    plan: string
  }>
}) {
  const { isMobile } = useSidebar()
  const [activeOrganization, setActiveOrganization] = React.useState(
    organizations[0],
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <HugeiconsIcon
                    icon={activeOrganization.logo}
                    className="size-4"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {activeOrganization.name}
                  </span>
                  <span className="truncate text-xs">
                    {activeOrganization.plan}
                  </span>
                </div>
                <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Organizações
              </DropdownMenuLabel>
              {organizations.map((organization, index) => (
                <DropdownMenuItem
                  key={organization.name}
                  onClick={() => setActiveOrganization(organization)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <HugeiconsIcon
                      icon={organization.logo}
                      className="size-3.5 shrink-0"
                    />
                  </div>
                  {organization.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2">
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">
                Adicionar Organização
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
