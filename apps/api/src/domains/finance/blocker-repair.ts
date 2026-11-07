import type {
  BillingBlockerCode,
  BillingReadinessItem,
} from "@calibra-facil/shared";

export interface BlockerClassAggregate {
  code: BillingBlockerCode;
  /** Coarse key: customer id for customer-data blockers, "global" for others. */
  groupKey: string;
  affectedServiceOrderIds: number[];
  customerNames: string[];
  count: number;
  /** Provider-neutral pt-BR fix action carried from the first matching blocker row. */
  fixAction: string;
}

/**
 * Aggregate the billing-readiness queue into common blocker classes so
 * operators can address them in bulk. The aggregator never invents
 * blocker codes; it groups what the existing evaluator already emits
 * and tracks the affected service-order ids for the bulk-acknowledge
 * surface that follows.
 */
export function aggregateBlockerClasses(
  items: ReadonlyArray<BillingReadinessItem>,
): BlockerClassAggregate[] {
  const aggregates = new Map<string, BlockerClassAggregate>();

  for (const item of items) {
    for (const blocker of item.blockers) {
      const groupKey =
        blocker.code === "BLOCKED_BY_CUSTOMER_DATA"
          ? `customer:${item.customer.id}`
          : "global";
      const aggregateKey = `${blocker.code}::${groupKey}`;

      const existing = aggregates.get(aggregateKey);
      if (existing) {
        if (!existing.affectedServiceOrderIds.includes(item.serviceOrderId)) {
          existing.affectedServiceOrderIds.push(item.serviceOrderId);
          existing.count += 1;
        }
        if (!existing.customerNames.includes(item.customer.name)) {
          existing.customerNames.push(item.customer.name);
        }
      } else {
        aggregates.set(aggregateKey, {
          code: blocker.code,
          groupKey,
          affectedServiceOrderIds: [item.serviceOrderId],
          customerNames: [item.customer.name],
          count: 1,
          fixAction: blocker.fixAction,
        });
      }
    }
  }

  return [...aggregates.values()].sort((a, b) => b.count - a.count);
}
