import type { DesktopInvokeHandlers } from "@calibra-facil/contracts/desktop-bridge";

/**
 * The slice of the handler table one domain module implements. A module returns
 * exactly these methods; the composition root spreads all modules into a
 * `DesktopInvokeHandlers`, which does not compile while a method is missing.
 */
export type HandlersFor<Method extends keyof DesktopInvokeHandlers> = Pick<
  DesktopInvokeHandlers,
  Method
>;
