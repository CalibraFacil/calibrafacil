import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  Moon01Icon,
  Settings02Icon,
  Sun01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/settings/appearance')({
  head: () => ({
    meta: [{ title: 'Aparencia | Configuracoes | CalibraFacil' }],
  }),
  component: AppearanceSettingsPage,
})

interface ThemeOption {
  value: string
  label: string
  description: string
  icon: React.ReactNode
}

const themeOptions: Array<ThemeOption> = [
  {
    value: 'light',
    label: 'Claro',
    description: 'Tema claro para uso diurno',
    icon: <HugeiconsIcon icon={Sun01Icon} className="h-6 w-6" />,
  },
  {
    value: 'dark',
    label: 'Escuro',
    description: 'Tema escuro para reduzir o cansaço visual',
    icon: <HugeiconsIcon icon={Moon01Icon} className="h-6 w-6" />,
  },
  {
    value: 'system',
    label: 'Sistema',
    description: 'Usar a configuração do sistema operacional',
    icon: <HugeiconsIcon icon={Settings02Icon} className="h-6 w-6" />,
  },
]

function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme()

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme)
    const option = themeOptions.find((o) => o.value === newTheme)
    if (option) {
      toast.success(`Tema alterado para ${option.label}`)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tema</CardTitle>
          <CardDescription>
            Selecione o tema da interface que você prefere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleThemeChange(option.value)}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-lg border p-4 text-center transition-colors hover:bg-muted',
                  theme === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border',
                )}
              >
                <div
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-lg',
                    theme === option.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted',
                  )}
                >
                  {option.icon}
                </div>
                <div>
                  <p className="font-medium">{option.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Theme Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Visualização</CardTitle>
          <CardDescription>
            Veja como a interface aparece com o tema selecionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border p-4">
            <div className="space-y-4">
              {/* Preview Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary" />
                  <div>
                    <p className="text-sm font-medium">CalibraFácil</p>
                    <p className="text-xs text-muted-foreground">
                      Gestão de Calibrações
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-md bg-muted" />
                  <div className="h-8 w-8 rounded-md bg-muted" />
                </div>
              </div>

              {/* Preview Content */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-card p-3">
                  <div className="h-2 w-16 rounded bg-muted-foreground/20" />
                  <div className="mt-2 h-8 w-full rounded bg-muted" />
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="h-2 w-20 rounded bg-muted-foreground/20" />
                  <div className="mt-2 h-8 w-full rounded bg-muted" />
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="h-2 w-12 rounded bg-muted-foreground/20" />
                  <div className="mt-2 h-8 w-full rounded bg-muted" />
                </div>
              </div>

              {/* Preview Table */}
              <div className="rounded-lg border">
                <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2">
                  <div className="h-3 w-24 rounded bg-muted-foreground/30" />
                  <div className="h-3 w-20 rounded bg-muted-foreground/30" />
                  <div className="h-3 w-16 rounded bg-muted-foreground/30" />
                </div>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 border-b last:border-0 px-4 py-3"
                  >
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-3 w-20 rounded bg-muted" />
                    <div className="h-5 w-16 rounded-full bg-primary/20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
