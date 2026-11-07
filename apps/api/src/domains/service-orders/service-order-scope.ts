import type { ResolvedUnitScope } from "../../lib/units";

/**
 * WHERE in the laboratory a caller may act on service orders: the laboratory
 * and the units it can see. The commands and queries of this module take it
 * instead of the HTTP middleware's member type; the route hands over its
 * `member` (which has these fields and more).
 */
export type ServiceOrderScope = Pick<
  ResolvedUnitScope,
  "selectedUnitScope" | "activeUnitId" | "accessibleUnitIds"
> & { organizationId: string };
