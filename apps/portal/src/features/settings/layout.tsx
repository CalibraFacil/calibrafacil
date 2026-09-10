import { Outlet } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings-nav";

/**
 * Settings shell, mirroring the lab dashboard's settings layout: page header,
 * then a sticky vertical nav beside the active sub-page (native select on
 * mobile). Sub-pages are real routes under /settings/*.
 */
export function SettingsLayout() {
  return (
    <div className="portal-shell space-y-6">
      <PageHeader
        title="Configurações"
        description="Sua conta, a aparência do portal e como você recebe as atualizações do laboratório."
      />
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <SettingsNav />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
