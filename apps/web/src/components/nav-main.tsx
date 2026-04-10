import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation } from '@tanstack/react-router'

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
  items?: Array<{
    title: string
    url: string
  }>
}

type NavMainProps = {
  items: Array<NavMainItem>
  label?: string
}

function renderNavLink(url: string) {
  if (url.startsWith('#')) {
    return <a href={url} />
  }

  return <Link to={url} />
}

export function NavMain({ items, label = 'Dashboard' }: NavMainProps) {
  const location = useLocation()

  const matchesPath = (targetUrl: string) => {
    if (targetUrl.startsWith('#')) {
      return false
    }

    if (targetUrl === '/dashboard') {
      return location.pathname === targetUrl
    }

    return (
      location.pathname === targetUrl ||
      location.pathname.startsWith(`${targetUrl}/`)
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>

      <SidebarMenu>
        {items.map((item) => {
          const isActive =
            matchesPath(item.url) ||
            item.items?.some((sub) => matchesPath(sub.url))

          return (
            <Collapsible
              key={item.title}
              defaultOpen={isActive}
              render={<SidebarMenuItem />}
            >
              {item.items?.length ? (
                <>
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuButton
                        isActive={isActive}
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
                          <SidebarMenuSubButton
                            render={renderNavLink(subItem.url)}
                            isActive={matchesPath(subItem.url)}
                          >
                            <span>{subItem.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </>
              ) : (
                <SidebarMenuButton
                  render={renderNavLink(item.url)}
                  isActive={matchesPath(item.url)}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              )}
            </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
