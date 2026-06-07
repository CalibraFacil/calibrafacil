import { Link, useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  SidebarFlyoutItem,
  SidebarFlyoutNav,
} from '@/components/sidebar-flyout-nav'
import { cn } from '@/lib/utils'
import { usePathPrewarmIntent } from '@/lib/use-route-prewarm-intent'

export type NavMainItem = {
  title: string
  url: string
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

      <SidebarFlyoutNav>
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
      </SidebarFlyoutNav>
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
  const className = cn(
    'text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring group flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm outline-hidden transition-[background-color,color] focus-visible:ring-2 [&_svg]:size-4 [&_svg]:shrink-0',
    isActive && 'bg-accent text-accent-foreground font-medium',
  )
  const content = (
    <>
      {icon ? (
        <span className="text-muted-foreground group-hover:text-accent-foreground">
          {icon}
        </span>
      ) : null}
      <span>{title}</span>
    </>
  )

  if (url.startsWith('#')) {
    return (
      <a className={className} href={url} {...prewarmIntentHandlers}>
        {content}
      </a>
    )
  }

  return (
    <Link className={className} to={url} {...prewarmIntentHandlers}>
      {content}
    </Link>
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
  const controlId = `sidebar-flyout-${item.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')}`
  const prewarmIntentHandlers = usePathPrewarmIntent(
    item.url.startsWith('#') ? null : item.url,
  )

  if (item.items?.length) {
    return (
      <SidebarFlyoutItem
        controlId={controlId}
        icon={item.icon}
        isActive={isActive}
        itemId={item.title}
        render={item.url.startsWith('#') ? undefined : <Link to={item.url} />}
        title={item.title}
        triggerProps={prewarmIntentHandlers}
        triggerType={item.url.startsWith('#') ? 'button' : 'link'}
      >
        {item.items.map((subItem) => (
          <li key={subItem.title}>
            <NavMainSubLink
              icon={subItem.icon}
              isActive={matchesPath(subItem.url)}
              title={subItem.title}
              url={subItem.url}
            />
          </li>
        ))}
      </SidebarFlyoutItem>
    )
  }

  return (
    <SidebarMenuItem>
      <NavMainLink
        isActive={matchesPath(item.url)}
        icon={item.icon}
        title={item.title}
        url={item.url}
      />
    </SidebarMenuItem>
  )
}
