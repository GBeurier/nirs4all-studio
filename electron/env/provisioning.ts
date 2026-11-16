/**
 * Creation of a Studio environment: the pinned python-build-standalone
 * runtime, a virtual environment on top of it, the required packages and the
 * recommended packages the user chose.
 */

import fs from "node:fs";
import path from "node:path";

import { loadPythonRuntimeConfig } from "./external-config";
import { rmWithRetry } from "./process-utils";
import { downloadFile, extractTarball, removeQuarantine } from "./python-runtime-installer";
import { getStandalonePythonPath, getVenvPythonPath } from "./runtime-paths";
import { createVenv, installRecommendedPackages, installRequiredPackages, resolveUvPayload } from "./uv";

const { getArchiveFilename, getDownloadUrl } = loadPythonRuntimeConfig<{
  getArchiveFilename(platform: string, arch: string): string;
  getDownloadUrl(platform: string, arch: string): string;
}>();

export type CreateProgress = (percent: number, detail: string) => void;

/** Extract the archive's top-level `python/` directory to `<baseDir>/python`. */
async function extractStandalonePython(archive: string, baseDir: string): Promise<void> {
  const pythonDir = path.join(baseDir, "python");
  const extractDir = path.join(baseDir, `.python-extract-${process.pid}-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    await extractTarball(archive, extractDir);
    // A runtime left by an interrupted creation has no environment on top of it.
    await rmWithRetry(pythonDir);
    fs.renameSync(path.join(extractDir, "python"), pythonDir);
  } finally {
    await rmWithRetry(extractDir).catch((error) => {
      console.warn(`[EnvManager] Could not clean temporary extraction directory: ${String(error)}`);
    });
  }
  if (!fs.existsSync(getStandalonePythonPath(baseDir))) {
    throw new Error("The Python runtime archive did not contain a Python interpreter.");
  }
  // Downloaded binaries carry the macOS quarantine attribute, which blocks execution.
  await removeQuarantine(pythonDir);
}

/**
 * The pinned runtime archive: the offline payload when this installer carries
 * one, else a download kept in `baseDir` until the environment is complete so
 * that a retry does not download it again.
 */
async function obtainPythonArchive(baseDir: string, progress: CreateProgress): Promise<{ path: string; downloaded: boolean }> {
  const archiveName = getArchiveFilename(process.platform, process.arch);
  const { offline } = resolveUvPayload();
  if (offline) {
    const shipped = path.join(offline, archiveName);
    if (!fs.existsSync(shipped)) {
      throw new Error(`The offline installer does not contain the Python runtime (${archiveName}).`);
    }
    return { path: shipped, downloaded: false };
  }
  const downloaded = path.join(baseDir, archiveName);
  if (!fs.existsSync(downloaded)) {
    progress(0, "Downloading the Python runtime…");
    await downloadFile(getDownloadUrl(process.platform, process.arch), downloaded, (percent) => {
      progress(Math.round(percent * 0.3), `Downloading the Python runtime… ${percent}%`);
    });
  }
  return { path: downloaded, downloaded: true };
}

/**
 * Create an environment under `baseDir` and return its interpreter. An
 * existing environment is never overwritten; a failed creation removes what
 * it created so that it can be retried.
 */
export async function createStudioEnvironment(
  baseDir: string,
  recommendedPackages: readonly string[],
  progress: CreateProgress,
): Promise<string> {
  const venvDir = path.join(baseDir, "venv");
  if (fs.existsSync(venvDir)) {
    throw new Error("A Python environment already exists in this folder. Select it from the detected environments, or choose another folder. Its files have been preserved.");
  }
  fs.mkdirSync(baseDir, { recursive: true });
  const archive = await obtainPythonArchive(baseDir, progress);
  try {
    progress(30, "Extracting the Python runtime…");
    try {
      await extractStandalonePython(archive.path, baseDir);
    } catch (error) {
      // A corrupt download must not fail every later attempt.
      if (archive.downloaded) fs.rmSync(archive.path, { force: true });
      throw error;
    }

    progress(40, "Creating the environment…");
    await createVenv(venvDir, getStandalonePythonPath(baseDir));
    const pythonPath = getVenvPythonPath(baseDir);

    progress(45, "Installing the required packages…");
    await installRequiredPackages(pythonPath);
    if (recommendedPackages.length > 0) {
      progress(70, "Installing the selected packages…");
      await installRecommendedPackages(pythonPath, recommendedPackages);
    }
    if (archive.downloaded) fs.rmSync(archive.path, { force: true });
    progress(100, "The environment is ready.");
    return pythonPath;
  } catch (error) {
    await Promise.all([venvDir, path.join(baseDir, "python")].map((directory) => rmWithRetry(directory).catch(() => undefined)));
    throw error;
  }
}
