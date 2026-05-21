import { Outlet } from '@tanstack/react-router'

import { SettingsProvider } from '@/contexts/settings-context'
import { SettingsNav } from '@/components/settings-nav'

export function SettingsLayout() {
  return (
    <SettingsProvider>
      <div className="space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Configurações
          </h1>
          <p className="text-muted-foreground">
            Gerencie sua conta e preferências.
          </p>
        </div>

        {/* Settings content with vertical tabs */}
        <div className="flex flex-col gap-8 md:flex-row md:gap-12">
          <SettingsNav />
          <div className="flex-1 min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    </SettingsProvider>
  )
}
