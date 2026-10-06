import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'

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
import { usePathPrewarmIntent } from '@/lib/use-route-prewarm-intent'

export type NavMainItem = {
  title: string
  url: string
  /** `data-tour` value for the guided tour. */
  tourId?: string
  icon?: ReactNode
  items?: Array<{
    icon?: ReactNode
    title: string
    url: string
  }>
}

type NavMainProps = {
  items: Array<NavMainItem>
  label?: string
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
            <NavMainItem
              key={item.title}
              isActive={Boolean(isActive)}
              item={item}
              matchesPath={matchesPath}
            />
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function NavMainLink({
  url,
  isActive,
  icon,
  title,
}: {
  url: string
  isActive: boolean
  icon?: ReactNode
  title: string
}) {
  const prewarmIntentHandlers = usePathPrewarmIntent(
    url.startsWith('#') ? null : url,
  )

  return (
    <SidebarMenuButton
      render={url.startsWith('#') ? <a href={url} /> : <Link to={url} />}
      isActive={isActive}
      tooltip={title}
      {...prewarmIntentHandlers}
    >
      {icon}
      <span>{title}</span>
    </SidebarMenuButton>
  )
}

function NavMainSubLink({
  icon,
  url,
  isActive,
  title,
}: {
  icon?: ReactNode
  url: string
  isActive: boolean
  title: string
}) {
  const prewarmIntentHandlers = usePathPrewarmIntent(
    url.startsWith('#') ? null : url,
  )

  return (
    <SidebarMenuSubButton
      isActive={isActive}
      render={url.startsWith('#') ? <a href={url} /> : <Link to={url} />}
      {...prewarmIntentHandlers}
    >
      {icon}
      <span>{title}</span>
    </SidebarMenuSubButton>
  )
}

function NavMainItem({
  item,
  isActive,
  matchesPath,
}: {
  item: NavMainItem
  isActive: boolean
  matchesPath: (targetUrl: string) => boolean
}) {
  if (item.items?.length) {
    return (
      <NavMainCollapsible
        isActive={isActive}
        item={item}
        matchesPath={matchesPath}
      />
    )
  }

  return (
    <SidebarMenuItem data-tour={item.tourId}>
      <NavMainLink
        isActive={matchesPath(item.url)}
        icon={item.icon}
        title={item.title}
        url={item.url}
      />
    </SidebarMenuItem>
  )
}

function NavMainCollapsible({
  item,
  isActive,
  matchesPath,
}: {
  item: NavMainItem
  isActive: boolean
  matchesPath: (targetUrl: string) => boolean
}) {
  // Open by default when the active route lives inside this group; the user can
  // still toggle it freely afterwards (Base UI tracks the state uncontrolled).
  return (
    <Collapsible
      className="group/collapsible"
      defaultOpen={isActive}
      render={<SidebarMenuItem data-tour={item.tourId} />}
    >
      <CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} />}>
        {item.icon}
        <span>{item.title}</span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="ml-auto text-sidebar-foreground/60 transition-transform duration-200 group-data-open/collapsible:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {item.items?.map((subItem) => (
            <SidebarMenuSubItem key={subItem.title}>
              <NavMainSubLink
                icon={subItem.icon}
                isActive={matchesPath(subItem.url)}
                title={subItem.title}
                url={subItem.url}
              />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}
