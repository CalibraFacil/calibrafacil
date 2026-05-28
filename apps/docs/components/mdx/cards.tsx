import {
  Card as FumadocsCard,
  Cards as FumadocsCards,
} from "fumadocs-ui/components/card";
import type { ReactNode } from "react";

// Shims for the Astro/Starlight <Card>/<CardGrid> API used in legacy MDX.
// We intentionally drop the Starlight `icon` string prop (named icons like
// "set-square") — Fumadocs Card expects a React node, and visual parity is
// good enough without icons.

export function Card({
  title,
  href,
  children,
}: {
  title?: string;
  icon?: string;
  href?: string;
  children?: ReactNode;
}) {
  return (
    <FumadocsCard title={title} href={href}>
      {children}
    </FumadocsCard>
  );
}

export function CardGrid({ children }: { children?: ReactNode }) {
  return <FumadocsCards>{children}</FumadocsCards>;
}
