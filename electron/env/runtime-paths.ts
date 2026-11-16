/**
 * Filesystem layout of Python environments: where Studio creates its own
 * environment and how an environment root is classified.
 */

import fs from "node:fs";
import path from "node:path";

import type { PythonEnvKind } from "../../src/types/pythonEnvironment";
import { normalizeDetectedPath } from "./python-discovery";

const isWindows = process.platform === "win32";

/** Directory of the environment Studio creates in its own data directory. */
export function getStudioEnvDir(userDataDir: string): string {
  return path.join(userDataDir, "python-env");
}

/** Interpreter of the virtual environment created under `baseDir`. */
export function getVenvPythonPath(baseDir: string): string {
  return isWindows
    ? path.join(baseDir, "venv", "Scripts", "python.exe")
    : path.join(baseDir, "venv", "bin", "python");
}

/** Interpreter of the python-build-standalone runtime extracted under `baseDir`. */
export function getStandalonePythonPath(baseDir: string): string {
  return isWindows
    ? path.join(baseDir, "python", "python.exe")
    : path.join(baseDir, "python", "bin", "python3");
}

/** `studio` for an environment inside Studio's data directory, else by its layout. */
export function getEnvKind(studioEnvDir: string, envRoot: string): PythonEnvKind {
  const relative = path.relative(normalizeDetectedPath(studioEnvDir), normalizeDetectedPath(envRoot));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return "studio";
  if (fs.existsSync(path.join(envRoot, "conda-meta"))) return "conda";
  if (fs.existsSync(path.join(envRoot, "pyvenv.cfg"))) return "venv";
  return "system";
}
