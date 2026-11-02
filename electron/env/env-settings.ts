/**
 * Persistence for the Electron env-settings file.
 *
 * Holds the on-disk shape (`EnvSettings`) and the JSON read/write primitives.
 * EnvManager owns the in-memory state and decides what to persist; these helpers
 * only translate between that state and the settings file.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SETTINGS_FILE = "env-settings.json";

export interface EnvSettings {
  /** A user-selected interpreter outside the Studio installation. */
  pythonPath?: string;
  /**
   * Studio's included runtime was selected. Stored as a marker rather than an
   * absolute path so the selection survives updates that move the install tree.
   */
  runtime?: "bundled";
  /** App version when the setup wizard was last completed */
  appVersion?: string;
  /** "Don't ask again" flag — skips wizard on subsequent launches (portable mode) */
  skipWizardOnLaunch?: boolean;
}

/** Read and parse the settings file, or null when it is absent or unreadable. */
export function readEnvSettings(settingsPath: string): Record<string, unknown> | null {
  for (const candidate of [settingsPath, `${settingsPath}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const data: unknown = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      if (!isEnvSettings(data)) throw new Error("Invalid Python environment settings");
      return data as Record<string, unknown>;
    } catch (error) {
      console.warn(`[EnvManager] Failed to load ${candidate}: ${error}`);
    }
  }
  return null;
}

function isEnvSettings(data: unknown): data is EnvSettings {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const value = data as Record<string, unknown>;
  return (value.pythonPath === undefined || (typeof value.pythonPath === "string" && value.pythonPath.length > 0))
    && (value.runtime === undefined || value.runtime === "bundled")
    && (value.appVersion === undefined || typeof value.appVersion === "string")
    && (value.skipWizardOnLaunch === undefined || typeof value.skipWizardOnLaunch === "boolean");
}

/** Commit a complete file atomically; keep the last valid selection for recovery. */
export function writeEnvSettings(settingsPath: string, data: EnvSettings): void {
  const temporary = `${settingsPath}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const descriptor = fs.openSync(temporary, "wx");
    try {
      fs.writeFileSync(descriptor, JSON.stringify(data, null, 2));
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(settingsPath)) {
      let previous: unknown;
      try { previous = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); }
      catch { /* Preserve the valid backup when recovering a truncated file. */ }
      if (isEnvSettings(previous)) fs.copyFileSync(settingsPath, `${settingsPath}.bak`);
    }
    fs.renameSync(temporary, settingsPath);
  } catch (error) {
    throw new Error("Could not save the Python environment selection. Check write access to Studio's settings folder and retry. Your previous selection is retained.", { cause: error });
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
