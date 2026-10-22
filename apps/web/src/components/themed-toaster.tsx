import { useTheme } from 'next-themes'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Loading03Icon,
  MultiplicationSignCircleIcon,
} from '@hugeicons/core-free-icons'
import { Toaster } from '@calibra-facil/ui/sonner'
import type { ComponentProps } from 'react'

type ToasterProps = ComponentProps<typeof Toaster>

function toToasterTheme(theme: string): ToasterProps['theme'] {
  switch (theme) {
    case 'light':
    case 'dark':
    case 'system':
      return theme
    default:
      return 'system'
  }
}

const ICONS: ToasterProps['icons'] = {
  success: (
    <HugeiconsIcon
      icon={CheckmarkCircle02Icon}
      strokeWidth={2}
      className="size-4"
    />
  ),
  info: (
    <HugeiconsIcon
      icon={InformationCircleIcon}
      strokeWidth={2}
      className="size-4"
    />
  ),
  warning: (
    <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4" />
  ),
  error: (
    <HugeiconsIcon
      icon={MultiplicationSignCircleIcon}
      strokeWidth={2}
      className="size-4"
    />
  ),
  loading: (
    <HugeiconsIcon
      icon={Loading03Icon}
      strokeWidth={2}
      className="size-4 animate-spin"
    />
  ),
}

/**
 * The shared toaster, following the lab app's light/dark switch and wearing
 * its icon set. The package toaster takes `theme` and `icons` as props (the
 * portal has no theme switcher and must keep the icon runtime out of its
 * initial bundle), so next-themes and the toast icons stay in this app.
 */
export function ThemedToaster(props: ToasterProps) {
  const { theme = 'system' } = useTheme()

  return <Toaster theme={toToasterTheme(theme)} icons={ICONS} {...props} />
}
