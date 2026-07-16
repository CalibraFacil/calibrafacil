import {
  AlertDiamondIcon,
  ArrowDown01Icon,
  Building06Icon,
  CreditCardIcon,
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

import { useIsMobile } from '@/hooks/use-mobile'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

interface SettingsNavItem {
  value: string
  label: string
  href: string
  icon: React.ReactNode
}

interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

const settingsNavGroups: Array<SettingsNavGroup> = [
  {
    label: 'Conta',
    items: [
      {
        value: 'profile',
        label: 'Perfil',
        href: '/dashboard/settings/profile',
        icon: <HugeiconsIcon icon={UserIcon} className="size-4" />,
      },
      {
        value: 'notifications',
        label: 'Notificações',
        href: '/dashboard/settings/notifications',
        icon: <HugeiconsIcon icon={Notification01Icon} className="size-4" />,
      },
      {
        value: 'appearance',
        label: 'Aparência',
        href: '/dashboard/settings/appearance',
        icon: <HugeiconsIcon icon={Settings02Icon} className="size-4" />,
      },
      {
        value: 'security',
        label: 'Segurança',
        href: '/dashboard/settings/security',
        icon: <HugeiconsIcon icon={ShieldKeyIcon} className="size-4" />,
      },
      {
        value: 'authentication',
        label: 'Autenticação',
        href: '/dashboard/settings/authentication',
        icon: <HugeiconsIcon icon={Key01Icon} className="size-4" />,
      },
      {
        value: 'passkeys',
        label: 'Passkeys',
        href: '/dashboard/settings/passkeys',
        icon: <HugeiconsIcon icon={FingerPrintIcon} className="size-4" />,
      },
    ],
  },
  {
    label: 'Organização',
    items: [
      {
        value: 'organization',
        label: 'Geral',
        href: '/dashboard/settings/organization',
        icon: <HugeiconsIcon icon={Building06Icon} className="size-4" />,
      },
      {
        value: 'units',
        label: 'Unidades & governança',
        href: '/dashboard/settings/units',
        icon: <HugeiconsIcon icon={HierarchyIcon} className="size-4" />,
      },
      {
        value: 'members',
        label: 'Membros & convites',
        href: '/dashboard/settings/members',
        icon: <HugeiconsIcon icon={UserGroupIcon} className="size-4" />,
      },
      {
        value: 'environment',
        label: 'Ambiente',
        href: '/dashboard/settings/environment',
        icon: <HugeiconsIcon icon={ThermometerIcon} className="size-4" />,
      },
      {
        value: 'accredited-scope',
        label: 'Escopo acreditado (CMC)',
        href: '/dashboard/settings/accredited-scope',
        icon: <HugeiconsIcon icon={SecurityCheckIcon} className="size-4" />,
      },
    ],
  },
  {
    label: 'Certificados',
    items: [
      {
        value: 'certificate-numbering',
        label: 'Numeração',
        href: '/dashboard/settings/certificate-numbering',
        icon: <HugeiconsIcon icon={Certificate01Icon} className="size-4" />,
      },
    ],
  },
  {
    label: 'Assinatura',
    items: [
      {
        value: 'signature',
        label: 'Assinatura digital',
        href: '/dashboard/settings/signature',
        icon: <HugeiconsIcon icon={PenTool01Icon} className="size-4" />,
      },
      {
        value: 'certificates',
        label: 'Certificados ICP',
        href: '/dashboard/settings/certificates',
        icon: <HugeiconsIcon icon={Certificate01Icon} className="size-4" />,
      },
    ],
  },
  {
    label: 'Plataforma',
    items: [
      {
        value: 'portal-domain',
        label: 'Domínio do portal',
        href: '/dashboard/settings/portal-domain',
        icon: <HugeiconsIcon icon={LinkSquare02Icon} className="size-4" />,
      },
      {
        value: 'email-domain',
        label: 'Domínio de e-mail',
        href: '/dashboard/settings/email-domain',
        icon: <HugeiconsIcon icon={Mail01Icon} className="size-4" />,
      },
      {
        value: 'integrations',
        label: 'Integrações',
        href: '/dashboard/settings/integrations',
        icon: <HugeiconsIcon icon={LinkSquare02Icon} className="size-4" />,
      },
    ],
  },
  {
    label: 'Plano',
    items: [
      {
        value: 'subscription',
        label: 'Plano e cobrança',
        href: '/dashboard/settings/subscription',
        icon: <HugeiconsIcon icon={CreditCardIcon} className="size-4" />,
      },
    ],
  },
]

const dangerNavItem: SettingsNavItem = {
  value: 'danger',
  label: 'Zona de perigo',
  href: '/dashboard/settings/danger',
  icon: (
    <HugeiconsIcon
      icon={AlertDiamondIcon}
      className="size-4 text-destructive"
    />
  ),
}

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
        <optgroup label="Avançado">
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
