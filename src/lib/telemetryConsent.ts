import {
  clientStorageKeys,
  readClientStorageString,
  removeClientStorageItem,
  writeClientStorageString,
} from "@/lib/clientStorage";

export type TelemetryConsentStatus = "accepted" | "declined" | "unset";

export const TELEMETRY_CONSENT_UPDATED_EVENT = "nirs4all-telemetry-consent-updated";

const STORAGE_KEY = clientStorageKeys.telemetryConsent;
const DECIDED_AT_KEY = clientStorageKeys.telemetryConsentDecidedAt;

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
  const value = readClientStorageString(STORAGE_KEY);
  return isConsentStatus(value) ? value : "unset";
}

function writeLocalConsentStatus(status: TelemetryConsentStatus, decidedAt?: string): void {
  writeClientStorageString(STORAGE_KEY, status);
  if (status === "accepted" || status === "declined") {
    writeClientStorageString(DECIDED_AT_KEY, decidedAt ?? new Date().toISOString());
  } else {
    removeClientStorageItem(DECIDED_AT_KEY);
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
