// Type declarations for Vite environment variables used by this package
import type { CalibraBridge } from "@calibra-facil/contracts";

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_DESKTOP_AUTH_API_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    calibraBridge?: CalibraBridge;
  }
}

export {};
