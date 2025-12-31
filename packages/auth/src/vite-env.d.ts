// Type declarations for Vite environment variables used by this package

interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
