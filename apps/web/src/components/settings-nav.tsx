import {
  AlertDiamondIcon,
  Building06Icon,
  CreditCardIcon,
  Key01Icon,
  LinkSquare02Icon,
  Notification01Icon,
  PaintBoardIcon,
  Settings02Icon,
  ShieldKeyIcon,
  UserIcon,
  PenTool01Icon,
  Certificate01Icon,
  ThermometerIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'

import { useIsMobile } from '@/hooks/use-mobile'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

interface SettingsNavItem {
  value: string
  label: string
  href: string
  icon: React.ReactNode
}

const settingsNavItems: Array<SettingsNavItem> = [
  {
    value: 'profile',
    label: 'Perfil',
    href: '/dashboard/settings/profile',
    icon: <HugeiconsIcon icon={UserIcon} className="size-4" />,
  },
  {
    value: 'organization',
    label: 'Organização',
    href: '/dashboard/settings/organization',
    icon: <HugeiconsIcon icon={Building06Icon} className="size-4" />,
  },
  {
    value: 'portal-domain',
    label: 'Portal Domain',
    href: '/dashboard/settings/portal-domain',
    icon: <HugeiconsIcon icon={LinkSquare02Icon} className="size-4" />,
  },
  {
    value: 'branding',
    label: 'Branding',
    href: '/dashboard/settings/branding',
    icon: <HugeiconsIcon icon={PaintBoardIcon} className="size-4" />,
  },
  {
    value: 'signature',
    label: 'Assinatura',
    href: '/dashboard/settings/signature',
    icon: <HugeiconsIcon icon={PenTool01Icon} className="size-4" />,
  },
  {
    value: 'certificates',
    label: 'Certificados ICP',
    href: '/dashboard/settings/certificates',
    icon: <HugeiconsIcon icon={Certificate01Icon} className="size-4" />,
  },
  {
    value: 'environment',
    label: 'Ambiente',
    href: '/dashboard/settings/environment',
    icon: <HugeiconsIcon icon={ThermometerIcon} className="size-4" />,
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
    value: 'integrations',
    label: 'Integrações',
    href: '/dashboard/settings/integrations',
    icon: <HugeiconsIcon icon={LinkSquare02Icon} className="size-4" />,
  },
  {
    value: 'appearance',
    label: 'Aparência',
    href: '/dashboard/settings/appearance',
    icon: <HugeiconsIcon icon={Settings02Icon} className="size-4" />,
  },
  {
    value: 'billing',
    label: 'Faturamento',
    href: '/dashboard/settings/billing',
    icon: <HugeiconsIcon icon={CreditCardIcon} className="size-4" />,
  },
  {
    value: 'notifications',
    label: 'Notificações',
    href: '/dashboard/settings/notifications',
    icon: <HugeiconsIcon icon={Notification01Icon} className="size-4" />,
  },
  {
    value: 'danger',
    label: 'Zona de Perigo',
    href: '/dashboard/settings/danger',
    icon: (
      <HugeiconsIcon
        icon={AlertDiamondIcon}
        className="size-4 text-destructive"
      />
    ),
  },
]

export function SettingsNav() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()

  // Find current tab from URL
  const currentTab =
    settingsNavItems.find((item) => location.pathname.startsWith(item.href))
      ?.value ?? 'profile'

  if (isMobile) {
    return (
      <NativeSelect
        value={currentTab}
        onChange={(e) => {
          const item = settingsNavItems.find((i) => i.value === e.target.value)
          if (item) {
            navigate({ to: item.href })
          }
        }}
        className="w-full"
      >
        {settingsNavItems.map((item) => (
          <NativeSelectOption key={item.value} value={item.value}>
            {item.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    )
  }

  return (
    <nav className="w-50 shrink-0" aria-label="Configurações">
      <ul className="flex flex-col gap-1">
        {settingsNavItems.map((item) => {
          const isActive = location.pathname.startsWith(item.href)
          return (
            <li key={item.value}>
              <Link
                to={item.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'hover:bg-muted hover:text-foreground',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
