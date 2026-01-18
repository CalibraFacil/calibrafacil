import { Link, useLocation } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  File01Icon,
  Home01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NavItem = {
  title: string;
  url: string;
  icon: React.ReactNode;
  badge?: string;
  disabled?: boolean;
};

const navItems: Array<NavItem> = [
  {
    title: "Painel",
    url: "/",
    icon: <HugeiconsIcon icon={Home01Icon} />,
  },
  {
    title: "Ativos",
    url: "/assets",
    icon: <HugeiconsIcon icon={Wrench01Icon} />,
  },
  {
    title: "Certificados",
    url: "/certificates",
    icon: <HugeiconsIcon icon={File01Icon} />,
  },
];

export function PortalNavMain() {
  const location = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Portal</SidebarGroupLabel>

      <SidebarMenu>
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.url ||
            (item.url !== "/" && location.pathname.startsWith(item.url));

          return (
            <SidebarMenuItem key={item.title}>
              {item.disabled ? (
                <SidebarMenuButton
                  isActive={false}
                  className="opacity-60 cursor-not-allowed"
                  disabled
                >
                  {item.icon}
                  <span>{item.title}</span>
                  {item.badge && (
                    <SidebarMenuBadge className="bg-muted text-muted-foreground text-[10px] px-1.5">
                      {item.badge}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  render={<Link to={item.url} />}
                  isActive={isActive}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
