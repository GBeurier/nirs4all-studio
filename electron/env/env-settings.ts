/**
 * Persistence of the selected interpreter in `env-settings.json`.
 *
 * The file holds only `{ "pythonPath": "..." }`. Files written by earlier
 * releases are read for that key alone; nothing else is migrated.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SETTINGS_FILE = "env-settings.json";

function parseSelection(raw: string): string | null | undefined {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const { pythonPath } = data as { pythonPath?: unknown };
  if (pythonPath === undefined) return null;
  return typeof pythonPath === "string" && pythonPath.length > 0 ? pythonPath : undefined;
}

/** The persisted interpreter path, or null when none is recorded. Falls back to the last valid backup. */
export function readSelectedPythonPath(settingsPath: string): string | null {
  for (const candidate of [settingsPath, `${settingsPath}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const selection = parseSelection(fs.readFileSync(candidate, "utf-8"));
      if (selection === undefined) throw new Error("Invalid Python environment settings");
      return selection;
    } catch (error) {
      console.warn(`[EnvManager] Failed to load ${candidate}: ${error}`);
    }
  }
  return null;
}

/** Commit the selection atomically; keep the last valid file as a backup for recovery. */
export function writeSelectedPythonPath(settingsPath: string, pythonPath: string | null): void {
  const temporary = `${settingsPath}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const descriptor = fs.openSync(temporary, "wx");
    try {
      fs.writeFileSync(descriptor, JSON.stringify(pythonPath ? { pythonPath } : {}, null, 2));
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(settingsPath)) {
      let previousIsValid = false;
      try { previousIsValid = parseSelection(fs.readFileSync(settingsPath, "utf-8")) !== undefined; }
      catch { /* Preserve the valid backup when recovering a truncated file. */ }
      if (previousIsValid) fs.copyFileSync(settingsPath, `${settingsPath}.bak`);
    }
    fs.renameSync(temporary, settingsPath);
  } catch (error) {
    throw new Error("Could not save the Python environment selection. Check write access to Studio's settings folder and retry. Your previous selection is retained.", { cause: error });
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
