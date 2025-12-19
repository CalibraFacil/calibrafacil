import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'

export type NavMainItem = {
  title: string
  url: string
  icon?: React.ReactNode
  isActive?: boolean
  items?: Array<{
    title: string
    url: string
  }>
}

type NavMainProps = {
  items: Array<NavMainItem>
}

export function NavMain({ items }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Dashboard</SidebarGroupLabel>

      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.title}
            defaultOpen={item.isActive}
            render={<SidebarMenuItem />}
          >
            {item.items?.length ? (
              <>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      render={<a href={item.url} />}
                      isActive={item.isActive}
                      className="
                        [&[data-panel-open]>span>svg]:rotate-90
                      "
                    >
                      {item.icon}
                      <span>{item.title}</span>

                      <span className="ml-auto transition-transform">
                        <HugeiconsIcon icon={ArrowRight01Icon} />
                      </span>
                    </SidebarMenuButton>
                  }
                />

                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton render={<a href={subItem.url} />}>
                          {subItem.title}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </>
            ) : (
              <SidebarMenuButton
                render={<a href={item.url} />}
                isActive={item.isActive}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            )}
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
