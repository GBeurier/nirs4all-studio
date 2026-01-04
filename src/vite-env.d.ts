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

interface Window {
  pywebview?: {
    api: {
      select_folder: () => Promise<string | null>;
      select_file: (
        fileTypes?: string[],
        allowMultiple?: boolean
      ) => Promise<string | string[] | null>;
      save_file: (
        defaultFilename?: string,
        fileTypes?: string[]
      ) => Promise<string | null>;
    };
  };
}
