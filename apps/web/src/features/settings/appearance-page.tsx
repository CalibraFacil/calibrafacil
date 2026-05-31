import { useTheme } from 'next-themes'
import {
  CheckmarkCircle02Icon,
  Moon01Icon,
  Settings02Icon,
  Sun01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { toast } from 'sonner'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

type ThemeValue = 'light' | 'dark' | 'system'

interface ThemeOption {
  value: ThemeValue
  label: string
  icon: typeof Sun01Icon
}

const themeOptions: Array<ThemeOption> = [
  { value: 'light', label: 'Claro', icon: Sun01Icon },
  { value: 'dark', label: 'Escuro', icon: Moon01Icon },
  { value: 'system', label: 'Sistema', icon: Settings02Icon },
]

/** A miniature window that always renders its OWN theme, not the active one. */
function ThemeSwatch({ variant }: { variant: ThemeValue }) {
  if (variant === 'system') {
    return (
      <div className="flex h-20 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10">
        <div className="w-1/2 space-y-1.5 bg-white p-2.5">
          <div className="h-1.5 w-10 rounded bg-slate-200" />
          <div className="h-1.5 w-7 rounded bg-slate-200" />
          <div className="h-5 rounded bg-blue-500/20" />
        </div>
        <div className="w-1/2 space-y-1.5 bg-slate-900 p-2.5">
          <div className="h-1.5 w-10 rounded bg-slate-700" />
          <div className="h-1.5 w-7 rounded bg-slate-700" />
          <div className="h-5 rounded bg-blue-400/40" />
        </div>
      </div>
    )
  }

  const dark = variant === 'dark'
  return (
    <div
      className={cn(
        'h-20 space-y-1.5 overflow-hidden rounded-lg p-2.5 ring-1',
        dark ? 'bg-slate-900 ring-white/10' : 'bg-white ring-black/10',
      )}
    >
      <div className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className={cn(
              'size-1.5 rounded-full',
              dark ? 'bg-slate-700' : 'bg-slate-300',
            )}
          />
        ))}
      </div>
      <div
        className={cn(
          'h-1.5 w-3/4 rounded',
          dark ? 'bg-slate-700' : 'bg-slate-200',
        )}
      />
      <div
        className={cn(
          'h-1.5 w-1/2 rounded',
          dark ? 'bg-slate-700' : 'bg-slate-200',
        )}
      />
      <div
        className={cn(
          'h-5 rounded',
          dark ? 'bg-blue-400/40' : 'bg-blue-500/20',
        )}
      />
    </div>
  )
}

export function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme()

  const handleThemeChange = (newTheme: ThemeValue) => {
    setTheme(newTheme)
    const option = themeOptions.find((item) => item.value === newTheme)
    if (option) {
      toast.success(`Tema alterado para ${option.label}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tema</CardTitle>
        <CardDescription>
          A interface muda na hora. O branding de certificados e o domínio do
          portal ficam em superfícies dedicadas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-label="Tema da interface"
          className="grid gap-3 sm:grid-cols-3"
        >
          {themeOptions.map((option) => {
            const selected = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleThemeChange(option.value)}
                className={cn(
                  'rounded-xl p-2 text-left transition-[background-color,box-shadow,transform] active:scale-[0.98]',
                  selected
                    ? 'bg-primary/5 shadow-[0_0_0_1.5px_hsl(var(--primary))]'
                    : 'shadow-[inset_0_0_0_1px_rgba(15,23,42,0.1)] hover:bg-muted/40 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]',
                )}
              >
                <ThemeSwatch variant={option.value} />
                <div className="mt-2.5 flex items-center justify-between gap-2 px-1 pb-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <HugeiconsIcon icon={option.icon} className="size-4" />
                    {option.label}
                  </span>
                  {selected && (
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      className="size-4 text-primary"
                    />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
