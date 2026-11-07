import {
  AlertDiamondIcon,
  ArrowDown01Icon,
  Building06Icon,
  HierarchyIcon,
  Key01Icon,
  LinkSquare02Icon,
  Mail01Icon,
  Notification01Icon,
  Settings02Icon,
  ShieldKeyIcon,
  UserGroupIcon,
  UserIcon,
  PenTool01Icon,
  Certificate01Icon,
  SecurityCheckIcon,
  ThermometerIcon,
  FingerPrintIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { useIsMobile } from '@calibra-facil/ui/use-mobile'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@calibra-facil/ui/collapsible'
import {
  NativeSelect,
  NativeSelectOption,
} from '@calibra-facil/ui/native-select'
import {
  getSettingsNavGroups,
  type SettingsNavRouteId,
} from '@/app/router/route-registry'
import { cn } from '@calibra-facil/ui/utils'

const settingsNavIcons = {
  '/dashboard/settings/profile': UserIcon,
  '/dashboard/settings/notifications': Notification01Icon,
  '/dashboard/settings/appearance': Settings02Icon,
  '/dashboard/settings/security': ShieldKeyIcon,
  '/dashboard/settings/authentication': Key01Icon,
  '/dashboard/settings/passkeys': FingerPrintIcon,
  '/dashboard/settings/organization': Building06Icon,
  '/dashboard/settings/units': HierarchyIcon,
  '/dashboard/settings/members': UserGroupIcon,
  '/dashboard/settings/environment': ThermometerIcon,
  '/dashboard/settings/accredited-scope': SecurityCheckIcon,
  '/dashboard/settings/certificate-numbering': Certificate01Icon,
  '/dashboard/settings/signature': PenTool01Icon,
  '/dashboard/settings/certificates': Certificate01Icon,
  '/dashboard/settings/certificate-release': SecurityCheckIcon,
  '/dashboard/settings/automatic-send': Mail01Icon,
  '/dashboard/settings/portal-domain': LinkSquare02Icon,
  '/dashboard/settings/email-domain': Mail01Icon,
  '/dashboard/settings/integrations': LinkSquare02Icon,
  '/dashboard/settings/danger': AlertDiamondIcon,
} satisfies Record<SettingsNavRouteId, typeof UserIcon>

interface SettingsNavItem {
  value: string
  label: string
  href: SettingsNavRouteId
  icon: React.ReactNode
}

interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

const dangerRoute = '/dashboard/settings/danger'

function toNavItem(item: {
  to: SettingsNavRouteId
  value: string
  label: string
}): SettingsNavItem {
  return {
    value: item.value,
    label: item.label,
    href: item.to,
    icon: (
      <HugeiconsIcon
        icon={settingsNavIcons[item.to]}
        className={cn('size-4', item.to === dangerRoute && 'text-destructive')}
      />
    ),
  }
}

// Titles, grouping and order come from the route registry; only the icons are
// local. The "Avançado" group holds the danger zone, which sits apart.
const registryGroups = getSettingsNavGroups()
const advancedGroup = registryGroups.find((group) => group.id === 'advanced')
const dangerEntry = advancedGroup?.items.find((item) => item.to === dangerRoute)
if (!advancedGroup || !dangerEntry) {
  throw new Error('The route registry has no settings danger zone')
}

const settingsNavGroups: Array<SettingsNavGroup> = registryGroups
  .filter((group) => group.id !== 'advanced')
  .map((group) => ({ label: group.label, items: group.items.map(toNavItem) }))

const dangerNavItem = toNavItem(dangerEntry)
const advancedLabel = advancedGroup.label

const allNavItems: SettingsNavItem[] = [
  ...settingsNavGroups.flatMap((group) => group.items),
  dangerNavItem,
]

function navItemClass(isActive: boolean, isDanger = false) {
  return cn(
    'flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-[background-color,color] active:scale-[0.99]',
    isActive
      ? isDanger
        ? 'bg-destructive/10 font-medium text-destructive'
        : 'bg-primary/10 font-medium text-primary'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  )
}

export function SettingsNav() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()

  const currentTab =
    allNavItems.find((item) => location.pathname.startsWith(item.href))
      ?.value ?? 'profile'

  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(settingsNavGroups.map((group) => group.label)),
  )
  const setGroupOpen = (label: string, open: boolean) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (open) {
        next.add(label)
      } else {
        next.delete(label)
      }
      return next
    })
  }

  if (isMobile) {
    return (
      <NativeSelect
        value={currentTab}
        onChange={(e) => {
          const item = allNavItems.find((i) => i.value === e.target.value)
          if (item) {
            navigate({ to: item.href })
          }
        }}
        className="w-full"
      >
        {settingsNavGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map((item) => (
              <NativeSelectOption key={item.value} value={item.value}>
                {item.label}
              </NativeSelectOption>
            ))}
          </optgroup>
        ))}
        <optgroup label={advancedLabel}>
          <NativeSelectOption value={dangerNavItem.value}>
            {dangerNavItem.label}
          </NativeSelectOption>
        </optgroup>
      </NativeSelect>
    )
  }

  return (
    <nav
      className="w-56 shrink-0 md:sticky md:top-4 md:self-start"
      aria-label="Configurações"
    >
      <div className="flex flex-col gap-1.5">
        {settingsNavGroups.map((group) => {
          const isOpen = openGroups.has(group.label)
          return (
            <Collapsible
              key={group.label}
              open={isOpen}
              onOpenChange={(open) => setGroupOpen(group.label, open)}
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:text-foreground">
                <span>{group.label}</span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className={cn(
                    'size-3.5 transition-transform duration-200',
                    isOpen && 'rotate-180',
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const isActive = location.pathname.startsWith(item.href)
                    return (
                      <li key={item.value}>
                        <Link
                          to={item.href}
                          className={navItemClass(isActive)}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          {item.icon}
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )
        })}

        <div className="border-t pt-3">
          <Link
            to={dangerNavItem.href}
            className={navItemClass(
              location.pathname.startsWith(dangerNavItem.href),
              true,
            )}
            aria-current={
              location.pathname.startsWith(dangerNavItem.href)
                ? 'page'
                : undefined
            }
          >
            {dangerNavItem.icon}
            {dangerNavItem.label}
          </Link>
        </div>
      </div>
    </nav>
  )
}
