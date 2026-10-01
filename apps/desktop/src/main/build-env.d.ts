// Build-time configuration baked into the main-process bundle by Vite
// (vite.main.config.ts). Release builds set these to the deployment the desktop
// app should talk to; unset values fall back to a local development stack.
interface ImportMetaEnv {
  readonly VITE_DESKTOP_AUTH_API_URL?: string;
  readonly VITE_DESKTOP_AUTH_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
