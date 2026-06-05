/**
 * Python interpreter discovery across the supported ecosystems (PATH, common
 * home venvs, conda, pyenv, the Windows `py` launcher, and nearby project
 * directories).
 *
 * These are free functions with no dependency on EnvManager state. They only
 * read the filesystem and run best-effort discovery probes via
 * {@link execFileText}; callers feed the resulting executable paths through
 * {@link addPythonCandidate} to deduplicate by realpath.
 */

import fs from "node:fs";
import path from "node:path";

import { execFileText } from "./process-utils";

const isWindows = process.platform === "win32";
const WINDOWS_LAUNCHER_TIMEOUT_MS = 5_000;
const CONDA_DISCOVERY_TIMEOUT_MS = 12_000;
const PROJECT_ENV_DIR_NAMES = [".venv", "venv", ".env", "env"];
const NEARBY_PROJECT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "coverage",
  "__pycache__",
]);

export function normalizeDetectedPath(candidate: string): string {
  const normalized = path.normalize(candidate);
  return isWindows ? normalized.toLowerCase() : normalized;
}

export function getEnvRootForPythonPath(pythonPath: string): string {
  const dir = path.dirname(pythonPath);
  const dirName = path.basename(dir).toLowerCase();
  return (dirName === "scripts" || dirName === "bin") ? path.dirname(dir) : dir;
}

export function getPythonExecutableCandidatesForEnvRoot(envRoot: string): string[] {
  return isWindows
    ? [path.join(envRoot, "Scripts", "python.exe"), path.join(envRoot, "python.exe")]
    : [path.join(envRoot, "bin", "python3"), path.join(envRoot, "bin", "python")];
}

export function addPythonCandidate(candidateMap: Map<string, string>, pythonPath: string | null | undefined): void {
  if (!pythonPath || !fs.existsSync(pythonPath)) {
    return;
  }

  try {
    const resolvedPath = fs.realpathSync(pythonPath);
    const key = normalizeDetectedPath(resolvedPath);
    if (!candidateMap.has(key)) {
      candidateMap.set(key, pythonPath);
    }
    return;
  } catch {
    const key = normalizeDetectedPath(pythonPath);
    if (!candidateMap.has(key)) {
      candidateMap.set(key, pythonPath);
    }
  }
}

export function collectPythonCandidatesFromRoots(candidateMap: Map<string, string>, envRoots: Iterable<string>): void {
  for (const envRoot of envRoots) {
    if (!envRoot || !fs.existsSync(envRoot)) {
      continue;
    }

    for (const pythonPath of getPythonExecutableCandidatesForEnvRoot(envRoot)) {
      addPythonCandidate(candidateMap, pythonPath);
    }
  }
}

export function listPathPythonCandidates(): string[] {
  const candidates: string[] = [];
  const names = isWindows ? ["python.exe"] : ["python3", "python"];
  const pathDirs = (process.env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

export function listCommonHomePythonCandidates(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) {
    return [];
  }

  const candidates = new Map<string, string>();
  const directEnvRoots = [
    path.join(home, ".venv"),
    path.join(home, "venv"),
  ];
  collectPythonCandidatesFromRoots(candidates, directEnvRoots);

  const condaEnvDirs = [
    path.join(home, ".conda", "envs"),
    path.join(home, "miniconda3", "envs"),
    path.join(home, "Miniconda3", "envs"),
    path.join(home, "anaconda3", "envs"),
    path.join(home, "Anaconda3", "envs"),
    path.join(home, "miniforge3", "envs"),
    path.join(home, "mambaforge", "envs"),
    path.join(home, "AppData", "Local", "miniconda3", "envs"),
    path.join(home, "AppData", "Local", "Miniconda3", "envs"),
    path.join(home, "AppData", "Local", "anaconda3", "envs"),
    path.join(home, "AppData", "Local", "Anaconda3", "envs"),
  ];

  for (const envDir of condaEnvDirs) {
    if (!fs.existsSync(envDir)) {
      continue;
    }

    try {
      const envRoots = fs.readdirSync(envDir)
        .map((entry) => path.join(envDir, entry))
        .filter((candidate) => {
          try {
            return fs.statSync(candidate).isDirectory();
          } catch {
            return false;
          }
        });
      collectPythonCandidatesFromRoots(candidates, envRoots);
    } catch {
      // Ignore unreadable env directories.
    }
  }

  return [...candidates.values()];
}

export function getCondaCommandCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }

    const isAbsolute = candidate.includes(path.sep) || candidate.includes("/");
    if (isAbsolute && !fs.existsSync(candidate)) {
      return;
    }

    const key = isAbsolute ? normalizeDetectedPath(candidate) : candidate;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(candidate);
  };

  addCandidate(process.env.CONDA_EXE);
  addCandidate("conda");

  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) {
    return candidates;
  }

  const installRoots = [
    path.join(home, "Anaconda3"),
    path.join(home, "anaconda3"),
    path.join(home, "Miniconda3"),
    path.join(home, "miniconda3"),
    path.join(home, "miniforge3"),
    path.join(home, "mambaforge"),
    path.join(home, "AppData", "Local", "Anaconda3"),
    path.join(home, "AppData", "Local", "anaconda3"),
    path.join(home, "AppData", "Local", "Miniconda3"),
    path.join(home, "AppData", "Local", "miniconda3"),
  ];

  for (const installRoot of installRoots) {
    addCandidate(isWindows
      ? path.join(installRoot, "Scripts", "conda.exe")
      : path.join(installRoot, "bin", "conda"));
  }

  return candidates;
}

export async function listWindowsLauncherPythonCandidates(): Promise<string[]> {
  if (!isWindows) {
    return [];
  }

  const result = await execFileText("py", ["-0p"], WINDOWS_LAUNCHER_TIMEOUT_MS);
  if (!result) {
    return [];
  }

  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^-V:\S+\s+(?:\*\s+)?(.+)$/)?.[1]?.trim() ?? null)
    .filter((candidate): candidate is string => Boolean(candidate));
}

export async function listCondaEnvPythonCandidates(): Promise<string[]> {
  for (const command of getCondaCommandCandidates()) {
    const result = await execFileText(command, ["env", "list", "--json"], CONDA_DISCOVERY_TIMEOUT_MS);
    if (!result) {
      continue;
    }

    try {
      const payload = JSON.parse(result.stdout.trim()) as { envs?: string[] };
      if (!Array.isArray(payload.envs)) {
        continue;
      }

      const candidates = new Map<string, string>();
      collectPythonCandidatesFromRoots(candidates, payload.envs);
      return [...candidates.values()];
    } catch {
      continue;
    }
  }

  return [];
}

function getNearbyProjectSearchRoots(): string[] {
  const roots = new Set<string>();
  let currentDir = path.resolve(process.cwd());

  for (let depth = 0; depth < 2; depth += 1) {
    roots.add(currentDir);

    const parentDir = path.dirname(currentDir);
    const filesystemRoot = path.parse(currentDir).root;
    if (parentDir === currentDir || parentDir === filesystemRoot) {
      break;
    }

    currentDir = parentDir;
  }

  return [...roots];
}

export function listNearbyProjectPythonCandidates(): string[] {
  const candidates = new Map<string, string>();

  for (const searchRoot of getNearbyProjectSearchRoots()) {
    collectPythonCandidatesFromRoots(
      candidates,
      PROJECT_ENV_DIR_NAMES.map((envName) => path.join(searchRoot, envName)),
    );

    try {
      const projectDirs = fs.readdirSync(searchRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !NEARBY_PROJECT_IGNORED_DIRS.has(entry.name))
        .map((entry) => path.join(searchRoot, entry.name));

      for (const projectDir of projectDirs) {
        collectPythonCandidatesFromRoots(
          candidates,
          PROJECT_ENV_DIR_NAMES.map((envName) => path.join(projectDir, envName)),
        );
      }
    } catch {
      // Ignore unreadable project directories.
    }
  }

  return [...candidates.values()];
}

export function listPyenvPythonCandidates(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const pyenvRoots = [
    process.env.PYENV_ROOT,
    home ? path.join(home, ".pyenv") : null,
    isWindows && home ? path.join(home, ".pyenv", "pyenv-win") : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  const candidates = new Map<string, string>();
  for (const pyenvRoot of pyenvRoots) {
    const versionsDirCandidates = [
      path.join(pyenvRoot, "versions"),
      isWindows ? path.join(pyenvRoot, "pyenv-win", "versions") : null,
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const versionsDir of versionsDirCandidates) {
      if (!fs.existsSync(versionsDir)) {
        continue;
      }

      try {
        const envRoots = fs.readdirSync(versionsDir)
          .map((entry) => path.join(versionsDir, entry))
          .filter((candidate) => {
            try {
              return fs.statSync(candidate).isDirectory();
            } catch {
              return false;
            }
          });
        collectPythonCandidatesFromRoots(candidates, envRoots);
      } catch {
        // Ignore unreadable pyenv version directories.
      }
    }
  }

  return [...candidates.values()];
}

/**
 * Gather every Python interpreter candidate across all ecosystems, deduplicated
 * by realpath. Seed candidates (configured / managed / bundled interpreters)
 * are added first so they win the dedupe.
 *
 * The cheap synchronous sources (PATH, home venvs, nearby projects, pyenv) and
 * the slower async probes (the Windows `py` launcher and `conda env list`,
 * which carry multi-second timeouts) run concurrently so the async probes do
 * not serialize behind one another.
 */
export async function gatherPythonCandidates(seeds: Iterable<string | null | undefined>): Promise<string[]> {
  const candidates = new Map<string, string>();
  for (const seed of seeds) {
    addPythonCandidate(candidates, seed);
  }

  const syncSources = [
    listPathPythonCandidates(),
    listCommonHomePythonCandidates(),
    listNearbyProjectPythonCandidates(),
    listPyenvPythonCandidates(),
  ];

  const [windowsLauncherCandidates, condaCandidates] = await Promise.all([
    listWindowsLauncherPythonCandidates(),
    listCondaEnvPythonCandidates(),
  ]);

  for (const source of syncSources) {
    for (const candidate of source) {
      addPythonCandidate(candidates, candidate);
    }
  }

  for (const candidate of windowsLauncherCandidates) {
    addPythonCandidate(candidates, candidate);
  }

  for (const candidate of condaCandidates) {
    addPythonCandidate(candidates, candidate);
  }

  if (process.platform === "darwin") {
    for (const candidate of [
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3",
    ]) {
      addPythonCandidate(candidates, candidate);
    }
  }

  return [...candidates.values()];
}
