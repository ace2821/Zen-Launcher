/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `"1"` forces the in-memory adapter; see `src/lib/api.ts`. */
  readonly VITE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by Vite `define` (see `vite.config.ts`). */
declare const __APP_VERSION__: string;
