/**
 * Where the offline desktop server listens when nothing says otherwise.
 *
 * Its own dependency-free module so that code which only needs the address
 * (the lab app's desktop client, the browser e2e fixtures) can read it without
 * pulling the whole configuration schema into its bundle. The
 * `CALIBRA_LOCAL_HOST` / `CALIBRA_LOCAL_PORT` defaults in
 * `groups/local-server.ts` are these values.
 */
export const LOCAL_SERVER_DEFAULT_HOST = "127.0.0.1";
export const LOCAL_SERVER_DEFAULT_PORT = 4317;

/** `http://127.0.0.1:4317`. */
export const LOCAL_SERVER_DEFAULT_URL = `http://${LOCAL_SERVER_DEFAULT_HOST}:${LOCAL_SERVER_DEFAULT_PORT}`;

/** How the desktop host hands the local server its settings: a base64url JSON envelope... */
export const LOCAL_SERVER_BOOTSTRAP_ENV = "CALIBRA_LOCAL_SERVER_BOOTSTRAP";
/** ...or, with this set to `1`, the same JSON on standard input. */
export const LOCAL_SERVER_BOOTSTRAP_STDIN_ENV =
  "CALIBRA_LOCAL_SERVER_BOOTSTRAP_STDIN";
