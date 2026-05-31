import { Outlet } from '@tanstack/react-router'

import { SettingsProvider } from '@/contexts/settings-context'
import { SettingsNav } from '@/components/settings-nav'

export function SettingsLayout() {
  return (
    <SettingsProvider>
      <div className="space-y-6">
        {/* Page header */}
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Plataforma
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Configurações
          </h1>
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
            Gerencie sua conta, o laboratório e as preferências da plataforma.
          </p>
        </div>

        {/* Settings content with vertical tabs */}
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
          <SettingsNav />
          <div className="min-w-0 flex-1">
            <Outlet />
          </div>
        </div>
      </div>
    </SettingsProvider>
  )
}
