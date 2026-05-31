import { Link, useLocation } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  File01Icon,
  Home01Icon,
  Notebook01Icon,
  ToolsIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import { cn } from "@/lib/utils";
import { useOverview } from "@/features/dashboard/queries";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type BadgeKey = "overdue" | "awaitingQuote";

type NavItem = {
  title: string;
  url: string;
  icon: IconSvgElement;
  badgeKey?: BadgeKey;
};

type NavSection = {
  label?: string;
  items: Array<NavItem>;
};

const sections: Array<NavSection> = [
  {
    items: [{ title: "Painel", url: "/", icon: Home01Icon }],
  },
  {
    label: "Calibração",
    items: [
      {
        title: "Equipamentos",
        url: "/assets",
        icon: Wrench01Icon,
        badgeKey: "overdue",
      },
      { title: "Certificados", url: "/certificates", icon: File01Icon },
      { title: "Solicitações", url: "/requests", icon: Notebook01Icon },
    ],
  },
  {
    label: "Serviços",
    items: [
      {
        title: "Manutenção",
        url: "/service-orders",
        icon: ToolsIcon,
        badgeKey: "awaitingQuote",
      },
    ],
  },
];

// Badge tones use the SignalTone literal palette (matching instrument-panel /
// status-pill) so the nav's attention signals read exactly like the console:
// overdue = critical, awaitingQuote = warning — the two "needs-action" signals.
const BADGE_TONE: Record<BadgeKey, string> = {
  overdue: "bg-destructive/10 text-destructive",
  awaitingQuote: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export function PortalNavMain() {
  const location = useLocation();
  const { data: overview } = useOverview();

  const badgeCounts: Record<BadgeKey, number> = {
    overdue: overview?.equipment.overdue ?? 0,
    awaitingQuote: overview?.serviceOrders.awaitingQuoteApproval ?? 0,
  };

  return (
    <>
      {sections.map((section, index) => (
        <SidebarGroup key={section.label ?? `section-${index}`}>
          {section.label ? (
            <SidebarGroupLabel className="font-mono text-[11px] uppercase tracking-[0.16em]">
              {section.label}
            </SidebarGroupLabel>
          ) : null}
          <SidebarMenu>
            {section.items.map((item) => {
              const isActive =
                location.pathname === item.url ||
                (item.url !== "/" && location.pathname.startsWith(item.url));
              const count = item.badgeKey ? badgeCounts[item.badgeKey] : 0;

              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={<Link to={item.url} />}
                    isActive={isActive}
                  >
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.badgeKey && count > 0 ? (
                    <SidebarMenuBadge
                      className={cn(
                        "font-mono tabular-nums",
                        BADGE_TONE[item.badgeKey],
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
