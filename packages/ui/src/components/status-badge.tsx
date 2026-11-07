import type { SignalTone } from "@calibra-facil/shared/status-vocabulary";
import type { ComponentProps } from "react";

import { STATUS_TONE } from "../lib/status-tone";
import { cn } from "../lib/utils";
import { Badge } from "./badge";

/** A status pill painted by its tone (see `@calibra-facil/shared/status-vocabulary`). */
function StatusBadge({
  tone,
  className,
  ...props
}: ComponentProps<typeof Badge> & { tone: SignalTone }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap border-transparent",
        STATUS_TONE[tone].surface,
        className,
      )}
      {...props}
    />
  );
}

export { StatusBadge };
