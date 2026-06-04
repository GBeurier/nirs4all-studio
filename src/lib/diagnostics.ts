import * as Sentry from "@sentry/react";
import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/react";

export const DEBUG_DATA_SHARING_STORAGE_KEY =
  "nirs4all-debug-data-sharing-enabled";

type DiagnosticsContext = {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
};

let debugDataSharingEnabled = readStoredDebugDataSharingConsent();
let sentryInitialized = false;
let acceptedEventCount = 0;

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

function readSampleRate(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function getMaxEventsPerSession(): number {
  return readPositiveInteger(
    import.meta.env.VITE_SENTRY_MAX_EVENTS_PER_SESSION,
    20
  );
}

function canSendEvent(): boolean {
  const maxEvents = getMaxEventsPerSession();
  if (acceptedEventCount >= maxEvents) return false;
  acceptedEventCount += 1;
  return true;
}

function readStoredDebugDataSharingConsent(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return readBoolean(window.localStorage.getItem(DEBUG_DATA_SHARING_STORAGE_KEY));
  } catch {
    return false;
  }
}

function writeStoredDebugDataSharingConsent(enabled: boolean): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEBUG_DATA_SHARING_STORAGE_KEY, String(enabled));
    }
  } catch {
    // Ignore storage failures; consent still applies for this session.
  }
}

function getSentryDsn(): string | undefined {
  return (
    import.meta.env.VITE_SENTRY_DSN ||
    import.meta.env.VITE_NIRS4ALL_SENTRY_DSN
  );
}

function getRelease(): string {
  return (
    import.meta.env.VITE_SENTRY_RELEASE ||
    `nirs4all-studio@${import.meta.env.VITE_APP_VERSION || "1.0.0"}`
  );
}

function getEnvironment(): string {
  return (
    import.meta.env.VITE_SENTRY_ENVIRONMENT ||
    (import.meta.env.DEV ? "development" : "production")
  );
}

function stripQueryString(url?: string): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function scrubHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  const result: Record<string, string> = {};
  Object.entries(headers as Record<string, unknown>).forEach(([key, value]) => {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("authorization") ||
      normalized.includes("cookie") ||
      normalized.includes("token") ||
      normalized.includes("key")
    ) {
      result[key] = "[Filtered]";
    } else {
      result[key] = String(value);
    }
  });
  return result;
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;

  if (event.request) {
    event.request.url = stripQueryString(event.request.url);
    event.request.headers = scrubHeaders(event.request.headers);
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
  }

  event.tags = {
    ...event.tags,
    debug_data_sharing: "enabled",
    app_surface: "renderer",
  };

  return event;
}

function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (!debugDataSharingEnabled) return null;
  if (!canSendEvent()) return null;
  return scrubEvent(event);
}

function beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (!debugDataSharingEnabled) return null;
  if (breadcrumb.category === "console") return null;
  if (breadcrumb.category === "ui.click") return null;
  if (
    (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") &&
    breadcrumb.level !== "error"
  ) {
    return null;
  }
  return breadcrumb;
}

export function isDebugDataSharingEnabled(): boolean {
  return debugDataSharingEnabled;
}

export function setDebugDataSharingConsent(enabled: boolean): void {
  debugDataSharingEnabled = enabled;
  writeStoredDebugDataSharingConsent(enabled);

  if (enabled) {
    initDiagnostics();
  }

  if (typeof window !== "undefined") {
    void window.electronApi?.setDebugDataSharingConsent?.(enabled);
  }
}

export function initDiagnostics(): boolean {
  if (sentryInitialized) return true;
  if (!debugDataSharingEnabled) return false;

  const dsn = getSentryDsn();
  if (!dsn) return false;

  const tracesSampleRate = readSampleRate(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
    0
  );

  Sentry.init({
    dsn,
    release: getRelease(),
    environment: getEnvironment(),
    sendDefaultPii: false,
    sendClientReports: false,
    maxBreadcrumbs: 30,
    tracesSampleRate,
    profilesSampleRate: readSampleRate(
      import.meta.env.VITE_SENTRY_PROFILES_SAMPLE_RATE,
      0
    ),
    integrations: tracesSampleRate > 0 ? [Sentry.browserTracingIntegration()] : [],
    beforeSend,
    beforeBreadcrumb,
    ignoreErrors: [
      "ResizeObserver loop completed with undelivered notifications.",
      "ResizeObserver loop limit exceeded",
    ],
  });

  Sentry.setTag("debug_data_sharing", "enabled");
  Sentry.setTag("app_surface", "renderer");
  sentryInitialized = true;
  return true;
}

export function captureDiagnosticsError(
  error: unknown,
  context: DiagnosticsContext = {}
): void {
  if (!debugDataSharingEnabled) return;
  if (!initDiagnostics()) return;

  Sentry.withScope((scope) => {
    Object.entries(context.tags || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        scope.setTag(key, String(value));
      }
    });

    Object.entries(context.extra || {}).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });

    Sentry.captureException(error);
  });
}

export function addDiagnosticsBreadcrumb(breadcrumb: Breadcrumb): void {
  if (!debugDataSharingEnabled) return;
  if (!initDiagnostics()) return;
  Sentry.addBreadcrumb(breadcrumb);
}
