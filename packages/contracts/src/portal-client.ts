/**
 * The client portal's slice of the contracts: what `apps/portal` imports, and
 * nothing of the lab's.
 *
 * `@calibra-facil/contracts` (the barrel) builds every Zod schema of the lab
 * app, the sync protocol and the desktop at import time, and a bundler cannot
 * drop a schema that is constructed by a call. The portal loads this module in
 * its initial graph (every page validates its response), so it imports this
 * entry instead and the lab's schemas never reach the browser bundle. A name
 * the portal needs and that is missing here is added here, not imported from
 * the barrel (the portal bundle budget fails if the barrel comes back).
 */
export * from "./portal";
export * from "./portal-fleet";
export * from "./portal-certificates";
export * from "./portal-engagement";
export * from "./portal-reliability";
export * from "./public-access";
export * from "./common";
export {
  ResponseContractError,
  validateResponsePayload,
  type ResponseValidationMode,
  type ResponseValidationOptions,
} from "./response-validation";
export * from "./endpoints/define";
export * from "./endpoints/request";
export * from "./endpoints/portal";
export * from "./endpoints/portal-engagement";
export * from "./endpoints/portal-groups";
