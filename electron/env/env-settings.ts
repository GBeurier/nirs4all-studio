/**
 * Persistence for the Electron env-settings file.
 *
 * Holds the on-disk shape (`EnvSettings`) and the JSON read/write primitives.
 * EnvManager owns the in-memory state and decides what to persist; these helpers
 * only translate between that state and the settings file.
 */

import fs from "node:fs";
import path from "node:path";

export const SETTINGS_FILE = "env-settings.json";

export interface EnvSettings {
  pythonPath?: string;
  /** App version when the setup wizard was last completed */
  appVersion?: string;
  /** "Don't ask again" flag — skips wizard on subsequent launches (portable mode) */
  skipWizardOnLaunch?: boolean;
}

/** Read and parse the settings file, or null when it is absent or unreadable. */
export function readEnvSettings(settingsPath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(settingsPath)) return null;
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    console.warn(`[EnvManager] Failed to load settings: ${error}`);
    return null;
  }
}

/** Persist the settings file, creating the parent directory as needed. */
export function writeEnvSettings(settingsPath: string, data: EnvSettings): void {
  try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`[EnvManager] Failed to save settings: ${error}`);
  }
}
