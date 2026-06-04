import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Sentry from "@sentry/electron/main";

let debugDataSharingEnabled = readPersistedDebugDataSharingConsent();
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
  return readPositiveInteger(process.env.SENTRY_MAX_EVENTS_PER_SESSION, 20);
}

function canSendEvent(): boolean {
  if (acceptedEventCount >= getMaxEventsPerSession()) return false;
  acceptedEventCount += 1;
  return true;
}

function getDefaultConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "nirs4all");
  }
  return path.join(os.homedir(), ".nirs4all");
}

function getConfigDir(): string {
  if (process.env.NIRS4ALL_CONFIG) {
    return process.env.NIRS4ALL_CONFIG;
  }

  const redirectFile = path.join(os.homedir(), ".nirs4all", "config_redirect.txt");
  try {
    if (fs.existsSync(redirectFile)) {
      const redirected = fs.readFileSync(redirectFile, "utf8").trim();
      if (redirected) return redirected;
    }
  } catch {
    // Fall back to the default config directory.
  }

  return getDefaultConfigDir();
}

function readPersistedDebugDataSharingConsent(): boolean {
  try {
    const settingsPath = path.join(getConfigDir(), "app_settings.json");
    const installerConsentPath = path.join(
      getConfigDir(),
      "installer_debug_data_sharing_consent"
    );
    if (fs.existsSync(installerConsentPath)) return true;
    if (!fs.existsSync(settingsPath)) return false;

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      ui_preferences?: { debug_data_sharing_enabled?: unknown };
    };
    return Boolean(settings.ui_preferences?.debug_data_sharing_enabled);
  } catch {
    return false;
  }
}

function getSentryDsn(): string | undefined {
  return process.env.NIRS4ALL_SENTRY_DSN || process.env.SENTRY_DSN;
}

function getRelease(): string {
  return (
    process.env.SENTRY_RELEASE ||
    `nirs4all-studio@${process.env.npm_package_version || "1.0.0"}`
  );
}

function getEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    process.env.NIRS4ALL_ENV ||
    (process.env.NODE_ENV === "development" ? "development" : "production")
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

function scrubHeaders(headers: unknown): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  const result: Record<string, unknown> = {};
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
      result[key] = value;
    }
  });
  return result;
}

function getEventText(event: Sentry.Event): string {
  const parts: string[] = [];

  if (event.message) parts.push(event.message);
  event.exception?.values?.forEach((exception) => {
    if (exception.type) parts.push(exception.type);
    if (exception.value) parts.push(exception.value);
  });

  return parts.join("\n");
}

function isExpectedNetworkError(event: Sentry.Event): boolean {
  const text = getEventText(event);
  return (
    text.includes("connect ETIMEDOUT") ||
    text.includes("ConnectTimeout") ||
    text.includes("ECONNRESET")
  );
}

function isExpectedLocalEnvironmentError(event: Sentry.Event): boolean {
  const text = getEventText(event);
  return (
    (
      text.includes("EPERM") &&
      text.includes("Permission denied") &&
      (text.includes("python-env") || text.includes("antivirus"))
    ) ||
    (
      text.includes("pip install") &&
      text.includes("timed out after")
    )
  );
}

function beforeSend(event: Sentry.Event): Sentry.Event | null {
  if (!debugDataSharingEnabled) return null;
  if (isExpectedNetworkError(event)) return null;
  if (isExpectedLocalEnvironmentError(event)) return null;
  if (!canSendEvent()) return null;

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
    app_surface: "electron-main",
  };

  return event;
}

export function initElectronDiagnostics(): boolean {
  if (sentryInitialized) return true;
  if (!debugDataSharingEnabled) return false;

  const dsn = getSentryDsn();
  if (!dsn) return false;

  const tracesSampleRate = readSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0);

  Sentry.init({
    dsn,
    release: getRelease(),
    environment: getEnvironment(),
    sendDefaultPii: false,
    sendClientReports: false,
    maxBreadcrumbs: 30,
    tracesSampleRate,
    beforeSend,
  });

  Sentry.setTag("debug_data_sharing", "enabled");
  Sentry.setTag("app_surface", "electron-main");
  sentryInitialized = true;
  return true;
}

export function setElectronDebugDataSharingConsent(enabled: boolean): void {
  debugDataSharingEnabled = enabled;
  if (enabled) {
    initElectronDiagnostics();
  }
}

export function captureElectronException(
  error: unknown,
  tags: Record<string, string | number | boolean | undefined> = {}
): void {
  if (!debugDataSharingEnabled) return;
  if (!initElectronDiagnostics()) return;

  Sentry.withScope((scope) => {
    Object.entries(tags).forEach(([key, value]) => {
      if (value !== undefined) {
        scope.setTag(key, String(value));
      }
    });
    Sentry.captureException(error);
  });
}
