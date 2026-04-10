import { Link, createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import {
  PaintBoardIcon,
  LinkSquare02Icon,
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
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/settings/appearance')({
  head: () => ({
    meta: [{ title: 'Aparência | Configuracoes | CalibraFácil' }],
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
    const option = themeOptions.find((item) => item.value === newTheme)
    if (option) {
      toast.success(`Tema alterado para ${option.label}`)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tema do dashboard</CardTitle>
          <CardDescription>
            Ajuste apenas a aparência da interface interna. Branding de
            certificados e domínio do portal agora ficam em superfícies
            dedicadas.
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

      <Card>
        <CardHeader>
          <CardTitle>Branding e Portal</CardTitle>
          <CardDescription>
            A gestão de templates de certificado e do domínio do portal foi
            separada em workspaces próprios para dar mais clareza ao lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-muted/20 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <HugeiconsIcon icon={PaintBoardIcon} className="size-5" />
              </div>
              <div>
                <p className="font-medium">Branding</p>
                <p className="text-sm text-muted-foreground">
                  Templates estruturados, preview e gestão do template padrão.
                </p>
              </div>
            </div>
            <Button
              className="mt-4"
              variant="outline"
              nativeButton={false}
              render={<Link to="/dashboard/settings/branding" />}
            >
              Abrir branding
            </Button>
          </div>

          <div className="rounded-xl border bg-muted/20 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <HugeiconsIcon icon={LinkSquare02Icon} className="size-5" />
              </div>
              <div>
                <p className="font-medium">Portal Domain</p>
                <p className="text-sm text-muted-foreground">
                  Configure hostname, DNS, verificação e ativação do portal do
                  cliente.
                </p>
              </div>
            </div>
            <Button
              className="mt-4"
              variant="outline"
              nativeButton={false}
              render={<Link to="/dashboard/settings/portal-domain" />}
            >
              Abrir domínio do portal
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visualização</CardTitle>
          <CardDescription>
            Prévia rápida de como a interface aparece com o tema selecionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border p-4">
            <div className="space-y-4">
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

              <div className="grid gap-3 sm:grid-cols-3">
                {['Ordens', 'Solicitações', 'Clientes'].map((label) => (
                  <div key={label} className="rounded-lg border bg-card p-3">
                    <div className="h-2 w-20 rounded bg-muted-foreground/20" />
                    <div className="mt-2 h-8 w-full rounded bg-muted" />
                    <p className="mt-3 text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border">
                <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2">
                  <div className="h-3 w-24 rounded bg-muted-foreground/30" />
                  <div className="h-3 w-20 rounded bg-muted-foreground/30" />
                  <div className="h-3 w-16 rounded bg-muted-foreground/30" />
                </div>
                {[1, 2, 3].map((row) => (
                  <div
                    key={row}
                    className="flex items-center gap-4 border-b px-4 py-3 last:border-0"
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
