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
  /** Sentry DSN for renderer diagnostics */
  readonly VITE_SENTRY_DSN?: string;
  /** Alternative nirs4all-specific Sentry DSN name */
  readonly VITE_NIRS4ALL_SENTRY_DSN?: string;
  /** Sentry release name */
  readonly VITE_SENTRY_RELEASE?: string;
  /** Application version used to derive the Sentry release */
  readonly VITE_APP_VERSION?: string;
  /** Sentry environment name */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** Renderer trace sample rate, between 0 and 1 */
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  /** Renderer profile sample rate, between 0 and 1 */
  readonly VITE_SENTRY_PROFILES_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Electron types are defined in src/types/electron.d.ts
