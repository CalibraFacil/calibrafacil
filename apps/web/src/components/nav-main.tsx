import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

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
            <NavMainCollapsible
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
  icon?: React.ReactNode
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
  url,
  isActive,
  title,
}: {
  url: string
  isActive: boolean
  title: string
}) {
  const prewarmIntentHandlers = usePathPrewarmIntent(
    url.startsWith('#') ? null : url,
  )

  return (
    <SidebarMenuSubButton
      render={url.startsWith('#') ? <a href={url} /> : <Link to={url} />}
      isActive={isActive}
      {...prewarmIntentHandlers}
    >
      <span>{title}</span>
    </SidebarMenuSubButton>
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
  const [open, setOpen] = useState(isActive)

  useEffect(() => {
    if (isActive) {
      setOpen(true)
    }
  }, [isActive])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
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
                  <NavMainSubLink
                    isActive={matchesPath(subItem.url)}
                    title={subItem.title}
                    url={subItem.url}
                  />
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </>
      ) : (
        <NavMainLink
          isActive={matchesPath(item.url)}
          icon={item.icon}
          title={item.title}
          url={item.url}
        />
      )}
    </Collapsible>
  )
}
