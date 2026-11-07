import { OOT_NOTIFICATION_STATUSES } from "@calibra-facil/schemas/machines";
import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";

/**
 * ISO/IEC 17025 §7.10 out-of-tolerance notifications read from the customer's
 * perspective (the laboratory's own wording is `OOT_NOTIFICATION_STATUS` in
 * `@calibra-facil/schemas/machines`): SENT means the ball is in the customer's
 * court (confirm receipt, so warning), ACKNOWLEDGED means done, and the
 * laboratory-internal pre-send stages (PENDING/GENERATED) are plain processing.
 */
export const OOT_NOTIFICATION_CUSTOMER_STATUS = defineStatusVocabulary(
  OOT_NOTIFICATION_STATUSES,
  {
    PENDING: { label: "Em processamento", tone: "neutral" },
    GENERATED: { label: "Em processamento", tone: "neutral" },
    SENT: { label: "Aguardando confirmação", tone: "warning" },
    ACKNOWLEDGED: { label: "Recebimento confirmado", tone: "ok" },
  },
);
