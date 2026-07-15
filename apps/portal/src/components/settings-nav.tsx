import {
  Notification01Icon,
  PaintBoardIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useIsMobile } from "@/hooks/use-mobile";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/**
 * Vertical settings navigation, the portal mirror of the lab dashboard's
 * settings nav (apps/web settings-nav.tsx) minus the collapsible groups:
 * three items don't need grouping. Mobile collapses to a native select.
 */

type SettingsNavItem = {
  value: string;
  label: string;
  href: string;
  icon: React.ReactNode;
};

const NAV_ITEMS: Array<SettingsNavItem> = [
  {
    value: "profile",
    label: "Perfil",
    href: "/settings/profile",
    icon: <HugeiconsIcon icon={UserIcon} className="size-4" />,
  },
  {
    value: "appearance",
    label: "Aparência",
    href: "/settings/appearance",
    icon: <HugeiconsIcon icon={PaintBoardIcon} className="size-4" />,
  },
  {
    value: "notifications",
    label: "Notificações",
    href: "/settings/notifications",
    icon: <HugeiconsIcon icon={Notification01Icon} className="size-4" />,
  },
];

export function SettingsNav() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();

  const currentTab =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.href))?.value ??
    "profile";

  if (isMobile) {
    return (
      <NativeSelect
        value={currentTab}
        onChange={(event) => {
          const item = NAV_ITEMS.find(
            (candidate) => candidate.value === event.target.value,
          );
          if (item) {
            void navigate({ to: item.href });
          }
        }}
        className="w-full"
      >
        {NAV_ITEMS.map((item) => (
          <NativeSelectOption key={item.value} value={item.value}>
            {item.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }

  return (
    <nav
      className="w-56 shrink-0 md:sticky md:top-20 md:self-start"
      aria-label="Configurações"
    >
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname.startsWith(item.href);
          return (
            <li key={item.value}>
              <Link
                to={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-[background-color,color] active:scale-[0.99]",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
