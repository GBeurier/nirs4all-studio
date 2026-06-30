/* eslint-disable react-refresh/only-export-components */

/**
 * Sentry crash reporting for the renderer process (React frontend).
 *
 * Initializes Sentry only after the user has opted in to crash reporting.
 * In sandboxed Electron renderers, we use @sentry/react (browser-only)
 * rather than @sentry/electron/renderer.
 */

import * as Sentry from "@sentry/react";

const SENTRY_DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined)
  || "https://64e47a03956ed609a0ec182af6fa517a@o4510941267951616.ingest.de.sentry.io/4510941353082960";

/** True when Sentry is initialized and capturing events. */
export let sentryEnabled = false;

function stripUrlQuery(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.split("?")[0].split("#")[0];
}

/**
 * True for unhandled rejections that are just an unawaited API-error envelope.
 *
 * The renderer's API client rejects with a plain `{ detail, status }` object.
 * When such a rejection isn't awaited (e.g. a fire-and-forget probe), the
 * browser surfaces it as an unhandled rejection — but the app keeps working,
 * so it is non-actionable noise rather than a crash. Genuine `Error`s and
 * React render failures are unaffected.
 */
export function isUnhandledApiErrorRejection(event: Sentry.Event, hint?: Sentry.EventHint): boolean {
  const values = event.exception?.values ?? [];
  const isUnhandledRejection = values.some(
    (v) => v.mechanism?.type === "onunhandledrejection" || v.mechanism?.handled === false,
  );
  if (!isUnhandledRejection) return false;

  const original = hint?.originalException;
  // A genuine Error is actionable even if it carries detail/status — keep it.
  if (original instanceof Error) return false;
  if (
    original
    && typeof original === "object"
    && "detail" in original
    && "status" in original
  ) {
    return true;
  }

  // Fallback when the original value isn't retained: match Sentry's synthetic
  // "promise rejection captured with keys: detail, status" message.
  return values.some(
    (v) =>
      typeof v.value === "string"
      && /promise rejection/i.test(v.value)
      && v.value.includes("detail")
      && v.value.includes("status"),
  );
}

function sanitizeSentryEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent | null {
  if (isUnhandledApiErrorRejection(event, hint)) return null;

  delete event.user;

  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    event.request.url = stripUrlQuery(event.request.url) as string | undefined;
  }

  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (/dataset|spectra|spectrum|prediction|model|workspace|file|path/i.test(key)) {
        event.extra[key] = "[Filtered]";
      }
    }
  }

  return event;
}

export function initSentry(): boolean {
  if (sentryEnabled) return true;
  if (!SENTRY_DSN) return false;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE || "production",
    sendDefaultPii: false,
    // Attach the app version if available (set by Vite define or env)
    release: import.meta.env.VITE_APP_VERSION
      ? `nirs4all-studio@${import.meta.env.VITE_APP_VERSION}`
      : undefined,
    beforeSend: sanitizeSentryEvent,
    maxBreadcrumbs: 50,
    // Crash reporting only: local dataset executions can legitimately move
    // large msgpack payloads and should not create performance issues.
    tracesSampleRate: 0,
  });

  sentryEnabled = true;
  return true;
}

export async function disableSentry(): Promise<boolean> {
  if (!sentryEnabled) return true;
  sentryEnabled = false;
  return Sentry.close(2000);
}

/** Re-export Sentry's React ErrorBoundary for use in the component tree. */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/** Fallback UI shown when an uncaught React error is captured by the Sentry boundary. */
export function SentryFallback({ error }: { error: Error }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: "1rem", padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold" }}>Something went wrong</h1>
      <p style={{ color: "#888", textAlign: "center", maxWidth: "28rem" }}>
        {sentryEnabled
          ? "An unexpected error occurred. The error has been reported automatically."
          : "An unexpected error occurred. Automatic error reporting is disabled."}
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
