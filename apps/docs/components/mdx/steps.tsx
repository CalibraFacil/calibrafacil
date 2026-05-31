import { Steps as FumadocsSteps } from "fumadocs-ui/components/steps";
import type { ReactNode } from "react";

// Starlight <Steps> wraps a numbered list. Fumadocs <Steps> formats the
// children similarly when they include an <ol>, so we pass through.
export function Steps({ children }: { children?: ReactNode }) {
  return <FumadocsSteps>{children}</FumadocsSteps>;
}
