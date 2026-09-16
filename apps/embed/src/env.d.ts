/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Pocketkey API base URL. Defaults to http://localhost:8787 in development. */
  readonly VITE_POCKETKEY_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
