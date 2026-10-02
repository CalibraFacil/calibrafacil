import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  GithubIcon,
  Menu01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { CONTRIBUTING_URL, REPOSITORY_URL, RUN_LOCALLY_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

import { BrandLockup } from "./brand";

const navLinks: { label: string; href: string; external?: boolean }[] = [
  { label: "O fluxo", href: "/#fluxo" },
  { label: "Módulos", href: "/#modulos" },
  { label: "Arquitetura", href: "/#arquitetura" },
  { label: "Rodar localmente", href: RUN_LOCALLY_URL },
  { label: "Contribuir", href: CONTRIBUTING_URL, external: true },
];

function externalProps(external?: boolean) {
  return external ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-6 md:px-8">
        <a href="/" className="flex items-center select-none">
          <BrandLockup markClassName="size-[22px]" textClassName="text-sm" />
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              {...externalProps(link.external)}
              className="rounded-md px-2.5 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button
            size="sm"
            render={
              <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <HugeiconsIcon icon={GithubIcon} data-icon="inline-start" />
            GitHub
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={mobileOpen}
          aria-controls="landing-mobile-menu"
        >
          <HugeiconsIcon icon={mobileOpen ? Cancel01Icon : Menu01Icon} />
        </Button>
      </div>

      <div
        id="landing-mobile-menu"
        aria-hidden={!mobileOpen}
        inert={mobileOpen ? undefined : true}
        className={cn(
          "overflow-hidden border-t border-border/60 transition-[max-height,opacity] duration-200 ease-in-out md:hidden",
          mobileOpen ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="flex flex-col gap-1 px-6 py-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              {...externalProps(link.external)}
              className="rounded-md px-3 py-2.5 text-[15px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-4">
            <Button
              className="w-full"
              render={
                <a
                  href={REPOSITORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileOpen(false)}
                />
              }
            >
              <HugeiconsIcon icon={GithubIcon} data-icon="inline-start" />
              Ver no GitHub
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
