/// <reference types="vite/client" />

/**
 * Environment variable type definitions
 */
interface ImportMetaEnv {
  /** Enable JSON-based node registry (Phase 2 feature flag) */
  readonly VITE_USE_NODE_REGISTRY?: string | boolean;
  /** Development mode indicator */
  readonly VITE_DEV?: string | boolean;
  /** API base URL */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version injected at build time from package.json */
declare const __APP_VERSION__: string;

// Electron types are defined in src/types/electron.d.ts
