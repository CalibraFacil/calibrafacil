import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsLayout,
});

const TABS = [
  { to: "/settings/appearance", label: "Aparência" },
  { to: "/settings/notifications", label: "Notificações" },
] as const;

function SettingsLayout() {
  return (
    <div className="portal-shell-sm space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-[background-color,border-color,color] hover:bg-muted hover:text-foreground"
            activeProps={{
              className: "border-transparent bg-primary/10 text-primary",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
