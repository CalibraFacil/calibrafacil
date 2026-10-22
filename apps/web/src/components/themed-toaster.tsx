import { useTheme } from 'next-themes'
import { Toaster } from '@calibra-facil/ui/sonner'
import type { ComponentProps } from 'react'

type ToasterTheme = ComponentProps<typeof Toaster>['theme']

function toToasterTheme(theme: string): ToasterTheme {
  switch (theme) {
    case 'light':
    case 'dark':
    case 'system':
      return theme
    default:
      return 'system'
  }
}

/**
 * The shared toaster, following the lab app's light/dark switch. The package
 * toaster takes its theme as a prop (the portal has no theme switcher), so the
 * next-themes dependency stays in this app.
 */
export function ThemedToaster(props: ComponentProps<typeof Toaster>) {
  const { theme = 'system' } = useTheme()

  return <Toaster theme={toToasterTheme(theme)} {...props} />
}
