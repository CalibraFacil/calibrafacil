import { PageHeader } from "@/components/page-header";
import { StaggerGroup, StaggerItem } from "@/components/instrument-panel";
import { NotificationPreferencesSection } from "@/features/notifications/preferences-section";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-section";

/**
 * Unified settings page: account, appearance and notification preferences in
 * one column, no tabs. The section ids are anchor targets for redirects from
 * the legacy tab URLs (/settings/appearance, /settings/notifications) and for
 * e-mail unsubscribe links; scroll-mt clears the sticky header.
 */
export function SettingsPage() {
  return (
    <div className="portal-shell-sm space-y-6">
      <PageHeader
        eyebrow="Portal"
        title="Configurações"
        description="Sua conta, a aparência do portal e como você recebe as atualizações do laboratório."
      />
      <StaggerGroup className="space-y-6">
        <StaggerItem>
          <div id="conta" className="scroll-mt-24">
            <AccountSection />
          </div>
        </StaggerItem>
        <StaggerItem>
          <div id="aparencia" className="scroll-mt-24">
            <AppearanceSection />
          </div>
        </StaggerItem>
        <StaggerItem>
          <div id="notificacoes" className="scroll-mt-24">
            <NotificationPreferencesSection />
          </div>
        </StaggerItem>
      </StaggerGroup>
    </div>
  );
}
