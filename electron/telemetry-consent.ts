import fs from "node:fs";
import path from "node:path";

export type TelemetryConsentStatus = "accepted" | "declined" | "unset";

export interface TelemetryConsentRecord {
  version: 1;
  status: Exclude<TelemetryConsentStatus, "unset">;
  decidedAt: string;
}

const CONSENT_FILE = "telemetry-consent.json";

function getConsentPath(app: Pick<Electron.App, "getPath">): string {
  return path.join(app.getPath("userData"), CONSENT_FILE);
}

function isConsentStatus(value: unknown): value is TelemetryConsentRecord["status"] {
  return value === "accepted" || value === "declined";
}

export function readTelemetryConsent(
  app: Pick<Electron.App, "getPath">,
): TelemetryConsentRecord | null {
  try {
    const filePath = getConsentPath(app);
    if (!fs.existsSync(filePath)) return null;

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<TelemetryConsentRecord>;
    if (!isConsentStatus(parsed.status) || typeof parsed.decidedAt !== "string") {
      return null;
    }

    return {
      version: 1,
      status: parsed.status,
      decidedAt: parsed.decidedAt,
    };
  } catch {
    return null;
  }
}

export function getTelemetryConsentStatus(
  app: Pick<Electron.App, "getPath">,
): TelemetryConsentStatus {
  return readTelemetryConsent(app)?.status ?? "unset";
}

export function writeTelemetryConsent(
  app: Pick<Electron.App, "getPath">,
  status: Exclude<TelemetryConsentStatus, "unset">,
): TelemetryConsentRecord {
  const record: TelemetryConsentRecord = {
    version: 1,
    status,
    decidedAt: new Date().toISOString(),
  };

  const filePath = getConsentPath(app);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  return record;
}
