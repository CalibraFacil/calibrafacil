import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Book02Icon,
  Settings05Icon,
} from "@hugeicons/core-free-icons";

import { PortalOrgSwitcher } from "./portal-org-switcher";
import { PortalNavMain } from "./portal-nav-main";
import { PortalNavUser } from "./portal-nav-user";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navSecondary = [
  {
    title: "Configurações",
    url: "/settings",
    icon: <HugeiconsIcon icon={Settings05Icon} />,
  },
  {
    title: "Documentação",
    url: "https://docs.calibrafacil.com",
    icon: <HugeiconsIcon icon={Book02Icon} />,
  },
];

export function PortalSidebar() {
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <PortalOrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <PortalNavMain />
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {navSecondary.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={
                      item.url.startsWith("http") ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ) : (
                        <Link to={item.url} />
                      )
                    }
                    size="sm"
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarFooter>
          <PortalNavUser />
        </SidebarFooter>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
