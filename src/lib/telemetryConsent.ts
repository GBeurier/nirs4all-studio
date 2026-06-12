export type TelemetryConsentStatus = "accepted" | "declined" | "unset";

export const TELEMETRY_CONSENT_UPDATED_EVENT = "nirs4all-telemetry-consent-updated";

const STORAGE_KEY = "nirs4all-telemetry-consent";
const DECIDED_AT_KEY = "nirs4all-telemetry-consent-decided-at";

type ElectronTelemetryApi = {
  getTelemetryConsent?: () => Promise<TelemetryConsentStatus>;
  setTelemetryConsent?: (enabled: boolean) => Promise<{
    status: TelemetryConsentStatus;
    decidedAt?: string;
    backendRestarted?: boolean;
  }>;
};

function getElectronTelemetryApi(): ElectronTelemetryApi | null {
  return (window as Window & { electronApi?: ElectronTelemetryApi }).electronApi ?? null;
}

function isConsentStatus(value: string | null): value is TelemetryConsentStatus {
  return value === "accepted" || value === "declined" || value === "unset";
}

function readLocalConsentStatus(): TelemetryConsentStatus {
  if (typeof window === "undefined") return "unset";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isConsentStatus(value) ? value : "unset";
  } catch {
    return "unset";
  }
}

function writeLocalConsentStatus(status: TelemetryConsentStatus, decidedAt?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, status);
    if (status === "accepted" || status === "declined") {
      window.localStorage.setItem(DECIDED_AT_KEY, decidedAt ?? new Date().toISOString());
    } else {
      window.localStorage.removeItem(DECIDED_AT_KEY);
    }
  } catch {
    // localStorage can be unavailable in restricted contexts; consent still
    // goes through the Electron-side store when running desktop mode.
  }
}

function dispatchConsentUpdated(status: TelemetryConsentStatus): void {
  window.dispatchEvent(new CustomEvent(TELEMETRY_CONSENT_UPDATED_EVENT, {
    detail: { status },
  }));
}

export function getCachedTelemetryConsentStatus(): TelemetryConsentStatus {
  return readLocalConsentStatus();
}

export async function getTelemetryConsentStatus(): Promise<TelemetryConsentStatus> {
  const electronApi = getElectronTelemetryApi();
  if (electronApi?.getTelemetryConsent) {
    try {
      const status = await electronApi.getTelemetryConsent();
      writeLocalConsentStatus(status);
      return status;
    } catch {
      return readLocalConsentStatus();
    }
  }

  return readLocalConsentStatus();
}

export async function setTelemetryConsentStatus(
  status: Exclude<TelemetryConsentStatus, "unset">,
): Promise<void> {
  const electronApi = getElectronTelemetryApi();
  if (electronApi?.setTelemetryConsent) {
    const result = await electronApi.setTelemetryConsent(status === "accepted");
    writeLocalConsentStatus(result.status, result.decidedAt);
    dispatchConsentUpdated(result.status);
    return;
  }

  writeLocalConsentStatus(status);
  dispatchConsentUpdated(status);
}
