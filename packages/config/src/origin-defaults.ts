/**
 * The development defaults of the public origins, in a module with no imports
 * so a browser-reachable package can read them too. Every reader of API_URL /
 * APP_URL falls back to these and to nothing else.
 */

/** The API's public address. */
export const DEFAULT_API_URL = "http://localhost:3000";
/** The lab app's public address. */
export const DEFAULT_APP_URL = "http://localhost:5173";
