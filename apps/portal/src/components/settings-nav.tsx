import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useIsMobile } from "@calibra-facil/ui/use-mobile";
import {
  NativeSelect,
  NativeSelectOption,
} from "@calibra-facil/ui/native-select";
import { cn } from "@calibra-facil/ui/utils";
import { PORTAL_ICONS } from "@/components/portal-icons";
import { settingsNavRoutes } from "@/lib/route-registry";

/**
 * Vertical settings navigation, the portal mirror of the lab dashboard's
 * settings nav (apps/web settings-nav.tsx) minus the collapsible groups:
 * three items don't need grouping. The items are the registry's
 * (`settingsNav`). Mobile collapses to a native select.
 */

const NAV_ITEMS = settingsNavRoutes();

export function SettingsNav() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();

  const currentTab =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.to))?.to ??
    "/settings/profile";

  if (isMobile) {
    return (
      <NativeSelect
        value={currentTab}
        onChange={(event) => {
          const item = NAV_ITEMS.find(
            (candidate) => candidate.to === event.target.value,
          );
          if (item) {
            void navigate({ to: item.to });
          }
        }}
        className="w-full"
      >
        {NAV_ITEMS.map((item) => (
          <NativeSelectOption key={item.to} value={item.to}>
            {item.title}
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
          const isActive = location.pathname.startsWith(item.to);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-[background-color,color] active:scale-[0.99]",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={PORTAL_ICONS[item.icon]}
                  className="size-4"
                />
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
