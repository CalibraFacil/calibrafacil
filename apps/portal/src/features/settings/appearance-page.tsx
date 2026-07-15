import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerIcon,
  Moon02Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/instrument-panel";
import { getStoredTheme, setTheme, type Theme } from "./theme";

/**
 * Theme picker in the instrument-panel language: each option is a miniature of
 * the portal itself (sidebar, console panel, mono readout) rendered with fixed
 * palettes, so the preview always depicts the theme it applies, not the theme
 * currently active. "Sistema" is a diagonal split of the two.
 */

const THEME_OPTIONS: Array<{
  value: Theme;
  label: string;
  description: string;
  icon: typeof Sun02Icon;
}> = [
  {
    value: "light",
    label: "Claro",
    description: "Sempre claro",
    icon: Sun02Icon,
  },
  {
    value: "dark",
    label: "Escuro",
    description: "Sempre escuro",
    icon: Moon02Icon,
  },
  {
    value: "system",
    label: "Sistema",
    description: "Acompanha o dispositivo",
    icon: ComputerIcon,
  },
];

type PreviewMode = "light" | "dark";

const PREVIEW_PALETTE: Record<
  PreviewMode,
  {
    shell: string;
    grid: string;
    sidebar: string;
    surface: string;
    hairline: string;
    bar: string;
    barSoft: string;
    accent: string;
    accentSoft: string;
    text: string;
  }
> = {
  light: {
    shell: "#f1f5f9",
    grid: "rgba(15,23,42,0.06)",
    sidebar: "#e2e8f0",
    surface: "#ffffff",
    hairline: "rgba(15,23,42,0.12)",
    bar: "#cbd5e1",
    barSoft: "#e8edf3",
    accent: "#4f46e5",
    accentSoft: "rgba(79,70,229,0.14)",
    text: "#0f172a",
  },
  dark: {
    shell: "#0b1220",
    grid: "rgba(255,255,255,0.07)",
    sidebar: "#141d31",
    surface: "#1a2439",
    hairline: "rgba(255,255,255,0.14)",
    bar: "#475569",
    barSoft: "#2b3750",
    accent: "#818cf8",
    accentSoft: "rgba(129,140,248,0.22)",
    text: "#e2e8f0",
  },
};

/** A tiny portal mock: blueprint shell, sidebar rail, console panel + readout. */
function ThemePreviewSurface({ mode }: { mode: PreviewMode }) {
  const c = PREVIEW_PALETTE[mode];
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ backgroundColor: c.shell }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to right, ${c.grid} 1px, transparent 1px), linear-gradient(to bottom, ${c.grid} 1px, transparent 1px)`,
          backgroundSize: "12px 12px",
          maskImage:
            "radial-gradient(140% 140% at 0% 0%, black, transparent 75%)",
        }}
      />
      {/* Sidebar rail */}
      <div
        className="absolute top-2.5 bottom-2.5 left-2.5 w-6 rounded-[5px] p-1.5"
        style={{ backgroundColor: c.sidebar }}
      >
        <div
          className="size-2 rounded-[3px]"
          style={{ backgroundColor: c.accent }}
        />
        <div
          className="mt-1.5 h-1 rounded-full"
          style={{ backgroundColor: c.bar }}
        />
        <div
          className="mt-1 h-1 rounded-full"
          style={{ backgroundColor: c.bar }}
        />
        <div
          className="mt-1 h-1 w-3/4 rounded-full"
          style={{ backgroundColor: c.bar }}
        />
      </div>
      {/* Console panel */}
      <div
        className="absolute top-2.5 right-2.5 bottom-2.5 left-11 rounded-md p-2"
        style={{
          backgroundColor: c.surface,
          boxShadow: `inset 0 0 0 1px ${c.hairline}, 0 4px 12px rgba(2,6,23,${mode === "dark" ? "0.5" : "0.08"})`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div
            className="h-1 w-9 rounded-full"
            style={{ backgroundColor: c.bar }}
          />
          <div
            className="h-2 w-5 rounded-full"
            style={{ backgroundColor: c.accentSoft }}
          />
        </div>
        <p
          className="mt-1.5 font-mono text-[11px] leading-none font-semibold tabular-nums"
          style={{ color: c.text }}
        >
          ±0,08 <span style={{ color: c.bar }}>mg</span>
        </p>
        <div className="mt-2 flex gap-1.5">
          <div
            className="h-3.5 flex-1 rounded-[4px]"
            style={{ backgroundColor: c.accentSoft }}
          />
          <div
            className="h-3.5 flex-1 rounded-[4px]"
            style={{ backgroundColor: c.barSoft }}
          />
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ value }: { value: Theme }) {
  if (value === "system") {
    return (
      <>
        <ThemePreviewSurface mode="light" />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ clipPath: "polygon(100% 0, 100% 100%, 32% 100%)" }}
        >
          <ThemePreviewSurface mode="dark" />
        </div>
      </>
    );
  }
  return <ThemePreviewSurface mode={value} />;
}

export function AppearanceSettingsPage() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());

  const handleSelect = (value: Theme) => {
    setThemeState(value);
    setTheme(value);
  };

  return (
    <Panel className="p-5">
      <PanelHeader
        title="Tema"
        description="Escolha como o portal se apresenta neste dispositivo. A interface muda na hora."
      />
      <div
        role="radiogroup"
        aria-label="Tema do portal"
        className="mt-4 grid gap-3 sm:grid-cols-3"
      >
        {THEME_OPTIONS.map((option) => {
          const selected = theme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => handleSelect(option.value)}
              className={cn(
                "group overflow-hidden rounded-xl text-left transition-[box-shadow,transform] outline-none active:scale-[0.98]",
                "focus-visible:ring-ring/50 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2",
                selected
                  ? "shadow-[0_0_0_2px_var(--primary)]"
                  : "shadow-[0_0_0_1px_rgba(15,23,42,0.12)] hover:shadow-[0_0_0_1px_rgba(15,23,42,0.28)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.14)] dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.3)]",
              )}
            >
              <div className="relative h-24">
                <ThemePreview value={option.value} />
              </div>
              <div className="border-foreground/10 bg-card flex items-center gap-2.5 border-t px-3 py-2.5">
                <HugeiconsIcon
                  icon={option.icon}
                  strokeWidth={2}
                  className={cn(
                    "size-4 shrink-0",
                    selected ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm leading-tight font-medium">
                    {option.label}
                  </p>
                  <p className="text-muted-foreground text-xs leading-tight">
                    {option.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "ml-auto flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-primary bg-primary"
                      : "border-foreground/25 group-hover:border-foreground/40",
                  )}
                >
                  {selected ? (
                    <span className="bg-primary-foreground size-1.5 rounded-full" />
                  ) : null}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
