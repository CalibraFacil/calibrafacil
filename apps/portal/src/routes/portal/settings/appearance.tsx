import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerIcon,
  Moon02Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/portal/settings/appearance")({
  head: () => ({
    meta: [{ title: "Aparencia | Portal do Cliente" }],
  }),
  component: AppearancePage,
});

type Theme = "light" | "dark" | "system";

const THEME_KEY = "theme";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");

  if (theme === "system") {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    root.classList.add(systemTheme);
  } else {
    root.classList.add(theme);
  }
}

function AppearancePage() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    applyTheme(newTheme);
  };

  const themes: Array<{ value: Theme; label: string; icon: typeof Sun02Icon }> =
    [
      { value: "light", label: "Claro", icon: Sun02Icon },
      { value: "dark", label: "Escuro", icon: Moon02Icon },
      { value: "system", label: "Sistema", icon: ComputerIcon },
    ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Aparencia</CardTitle>
          <CardDescription>
            Personalize a aparencia do portal do cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Tema</h3>
            <p className="text-sm text-muted-foreground">
              Selecione o tema de sua preferencia.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {themes.map((t) => (
                <Button
                  key={t.value}
                  variant={theme === t.value ? "default" : "outline"}
                  onClick={() => handleThemeChange(t.value)}
                  className="flex items-center gap-2"
                >
                  <HugeiconsIcon icon={t.icon} className="size-4" />
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
