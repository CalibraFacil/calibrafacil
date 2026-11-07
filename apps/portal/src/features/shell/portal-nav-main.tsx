import { Link, useLocation } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@calibra-facil/ui/utils";
import { useOverview } from "@/features/dashboard/queries";
import { portalNavSections, type PortalNavBadge } from "@/lib/route-registry";
import { PORTAL_ICONS } from "@/components/portal-icons";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@calibra-facil/ui/sidebar";

const sections = portalNavSections();

// Badge tones use the SignalTone literal palette (matching instrument-panel /
// status-pill) so the nav's attention signals read exactly like the console:
// overdue = critical, awaitingQuote = warning — the two "needs-action" signals.
const BADGE_TONE: Record<PortalNavBadge, string> = {
  overdue: "bg-destructive/10 text-destructive",
  awaitingQuote: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export function PortalNavMain() {
  const location = useLocation();
  const { data: overview } = useOverview();

  const badgeCounts: Record<PortalNavBadge, number> = {
    overdue: overview?.equipment.overdue ?? 0,
    awaitingQuote: overview?.serviceOrders.awaitingQuoteApproval ?? 0,
  };

  return (
    <>
      {sections.map((section) => (
        <SidebarGroup key={section.id}>
          {section.label ? (
            <SidebarGroupLabel className="font-mono text-[11px] uppercase tracking-[0.16em]">
              {section.label}
            </SidebarGroupLabel>
          ) : null}
          <SidebarMenu>
            {section.items.map((item) => {
              const isActive =
                location.pathname === item.to ||
                (item.to !== "/" && location.pathname.startsWith(item.to));
              const count = item.badge ? badgeCounts[item.badge] : 0;

              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} />}
                    isActive={isActive}
                  >
                    <HugeiconsIcon
                      icon={PORTAL_ICONS[item.icon]}
                      strokeWidth={2}
                    />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.badge && count > 0 ? (
                    <SidebarMenuBadge
                      className={cn(
                        "font-mono tabular-nums",
                        BADGE_TONE[item.badge],
                      )}
                    >
                      {count}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
