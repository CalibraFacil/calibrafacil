import { SERVICE_ORDER_STATUS } from "@calibra-facil/shared/service-orders";
import type { SignalTone } from "@calibra-facil/shared/status-vocabulary";

/**
 * A service order's label and tone (`SERVICE_ORDER_STATUS`). A status this build
 * does not know is shown as such, with the raw value, instead of reading as a
 * plausible state like "Em andamento".
 */
export function getServiceOrderStatus(status: string): {
  label: string;
  tone: SignalTone;
} {
  const known = SERVICE_ORDER_STATUS.parse(status);
  return known
    ? {
        label: SERVICE_ORDER_STATUS.label(known),
        tone: SERVICE_ORDER_STATUS.tone(known),
      }
    : { label: `Status desconhecido (${status})`, tone: "warning" };
}
