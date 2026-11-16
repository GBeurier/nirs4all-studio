/**
 * Persistent cache of the selected environment's inventory, so an ordinary
 * launch does not spawn Python at all.
 *
 * The entry is valid for one interpreter, one required-package catalogue and
 * one environment fingerprint. Installing, removing or upgrading a
 * distribution renames a `*.dist-info` directory, which changes the package
 * directory's modification time and therefore the fingerprint. The key does
 * not include the application version: an update that keeps the required
 * packages reuses the entry.
 */

import fs from "node:fs";
import path from "node:path";

import { REQUIRED_PACKAGES } from "./catalogue";
import type { PythonInventory } from "./inventory";
import { getEnvRootForPythonPath } from "./python-discovery";

const CACHE_FILE = "python-inventory.json";
const REQUIRED_KEY = JSON.stringify(REQUIRED_PACKAGES);

interface CacheEntry {
  pythonPath: string;
  required: string;
  fingerprint: string;
  inventory: PythonInventory;
}

function stat(target: string): string {
  try {
    const stats = fs.statSync(target);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "absent";
  }
}

function fingerprint(pythonPath: string, purelib: string): string {
  return [pythonPath, purelib, path.join(getEnvRootForPythonPath(pythonPath), "pyvenv.cfg")].map(stat).join("|");
}

/** The cached inventory of `pythonPath`, or null when the environment or the catalogue changed. */
export function readCachedInventory(userDataDir: string, pythonPath: string): PythonInventory | null {
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(userDataDir, CACHE_FILE), "utf8")) as CacheEntry;
    return entry.pythonPath === pythonPath
      && entry.required === REQUIRED_KEY
      && entry.fingerprint === fingerprint(pythonPath, entry.inventory.purelib)
      ? entry.inventory
      : null;
  } catch {
    return null;
  }
}

export function writeCachedInventory(userDataDir: string, pythonPath: string, inventory: PythonInventory): void {
  const entry: CacheEntry = {
    pythonPath,
    required: REQUIRED_KEY,
    fingerprint: fingerprint(pythonPath, inventory.purelib),
    inventory,
  };
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, CACHE_FILE), JSON.stringify(entry));
  } catch {
    // A read-only data directory only costs one metadata subprocess per launch.
  }
}
