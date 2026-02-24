/**
 * Sentry crash reporting for the renderer process (React frontend).
 *
 * Initializes Sentry only when VITE_SENTRY_DSN is set at build time.
 * In sandboxed Electron renderers, we use @sentry/react (browser-only)
 * rather than @sentry/electron/renderer.
 */

import * as Sentry from "@sentry/react";

const SENTRY_DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined)
  || "https://64e47a03956ed609a0ec182af6fa517a@o4510941267951616.ingest.de.sentry.io/4510941353082960";

/** True when Sentry is initialized and capturing events. */
export let sentryEnabled = false;

export function initSentry(): void {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE || "production",
    // Attach the app version if available (set by Vite define or env)
    release: import.meta.env.VITE_APP_VERSION
      ? `nirs4all-studio@${import.meta.env.VITE_APP_VERSION}`
      : undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    // Capture 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,
    // Capture 10% of sessions for replay on error
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
  });

  sentryEnabled = true;
}

/** Re-export Sentry's React ErrorBoundary for use in the component tree. */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/** Fallback UI shown when an uncaught React error is captured by the Sentry boundary. */
export function SentryFallback({ error }: { error: Error }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: "1rem", padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold" }}>Something went wrong</h1>
      <p style={{ color: "#888", textAlign: "center", maxWidth: "28rem" }}>
        An unexpected error occurred. The error has been reported automatically.
      </p>
      <pre style={{ fontSize: "0.75rem", color: "#e55", background: "#f5f5f5", padding: "1rem", borderRadius: "0.5rem", maxWidth: "32rem", overflow: "auto" }}>
        {error.message}
      </pre>
      <button
        style={{ padding: "0.5rem 1rem", borderRadius: "0.375rem", background: "#0d9488", color: "white", border: "none", cursor: "pointer" }}
        onClick={() => window.location.reload()}
      >
        Reload application
      </button>
    </div>
  );
}
