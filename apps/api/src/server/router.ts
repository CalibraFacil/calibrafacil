import { Hono, type Env as HonoEnv } from "hono";
import { applyErrorHandling } from "./error-handling";

/**
 * A route module's router. It renders what its handlers throw (a `DomainError`,
 * a `PortalServiceAccountError`, an `HTTPException`, an unexpected failure) with
 * the app's one error handler: Hono runs the error handler of a mounted
 * sub-app for that sub-app's routes, so the module answers the same way mounted
 * in the app or on its own.
 */
export function createRouter(): Hono;
export function createRouter<E extends HonoEnv>(): Hono<E>;
export function createRouter<E extends HonoEnv>() {
  return applyErrorHandling(new Hono<E>());
}
