/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Pockey API base URL. Defaults to http://localhost:8787 in development. */
  readonly VITE_POCKEY_API_URL?: string;
  /** "true" lets a non-dev build trust the key provider emulator (e2e only, never production). */
  readonly VITE_POCKEY_ALLOW_EMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
