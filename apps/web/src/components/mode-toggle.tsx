import { HugeiconsIcon } from '@hugeicons/react'
import { Moon01Icon, Sun01Icon } from '@hugeicons/core-free-icons'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
    >
      <HugeiconsIcon
        icon={isDark ? Sun01Icon : Moon01Icon}
        className="h-[1.2rem] w-[1.2rem]"
      />
      <span className="sr-only">Alternar tema</span>
    </Button>
  )
}
