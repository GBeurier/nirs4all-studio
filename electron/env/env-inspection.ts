/**
 * Pure Python-environment inspection and scoring helpers.
 *
 * These functions classify and score interpreters against the recommended
 * package configuration without touching EnvManager state. The EnvManager class
 * still owns the parts that depend on runtime context (env kind, writability,
 * the configured/managed/bundled paths) and composes these helpers.
 */

import { execFile } from "node:child_process";
import { loadPythonRuntimeConfig, loadRecommendedConfig } from "./external-config";

interface PythonRuntimeConfigModule {
  MANAGED_RUNTIME_PACKAGES: readonly string[];
}

const pythonRuntimeConfig = loadPythonRuntimeConfig<PythonRuntimeConfigModule>();
const recommendedConfig = loadRecommendedConfig<RecommendedConfigFile>();

export const MANAGED_RUNTIME_PACKAGES = pythonRuntimeConfig.MANAGED_RUNTIME_PACKAGES;

export type EnvKind = "system" | "venv" | "conda" | "managed" | "bundled";

interface RecommendedPackageSpec {
  min?: string;
  recommended?: string | null;
}

interface RecommendedProfileConfig {
  label?: string;
  platforms?: string[];
  packages?: Record<string, RecommendedPackageSpec | string>;
}

interface RecommendedOptionalConfig {
  min?: string;
  recommended?: string | null;
  description?: string;
  category?: string;
}

interface RecommendedConfigFile {
  profiles?: Record<string, RecommendedProfileConfig>;
  optional?: Record<string, RecommendedOptionalConfig>;
}

export interface ProfileAlignmentGuess {
  id: string;
  label: string;
  missingCount: number;
}

export interface DetectedEnv {
  path: string;
  pythonPath: string;
  pythonVersion: string;
  hasNirs4all: boolean;
  hasCorePackages: boolean;
  envKind: EnvKind;
  writable: boolean;
}

export interface InspectedEnv extends DetectedEnv {
  missingCorePackages: string[];
  missingOptionalPackages: string[];
  profileAlignmentGuess: ProfileAlignmentGuess | null;
}

export interface InspectPythonData {
  version: string;
  installedPackages: Map<string, string>;
}

export function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, "_").toLowerCase();
}

function getSupportedProfiles(config: RecommendedConfigFile): Array<[string, RecommendedProfileConfig]> {
  return Object.entries(config.profiles ?? {}).filter(([, profile]) => {
    const platforms = profile.platforms ?? [];
    return platforms.length === 0 || platforms.includes(process.platform);
  });
}

/** Core package names with version/extras specifiers stripped. */
export function getManagedCorePackageNames(): string[] {
  return MANAGED_RUNTIME_PACKAGES.map((packageSpec) => packageSpec.split(/[<>=!~ []/)[0]);
}

export function getMissingCorePackages(installedPackages: ReadonlyMap<string, string>): string[] {
  return MANAGED_RUNTIME_PACKAGES.filter((packageSpec) => {
    const packageName = packageSpec.split(/[<>=!~ []/)[0];
    const installedVersion = installedPackages.get(normalizePackageName(packageName));
    if (!installedVersion) return true;

    const exactVersion = packageSpec.match(/==\s*([^;\s]+)/)?.[1];
    return Boolean(exactVersion && installedVersion !== exactVersion);
  }).map((packageSpec) => packageSpec.split(/[<>=!~ []/)[0]);
}

export function getMissingOptionalPackages(installedPackages: Set<string>): string[] {
  return Object.keys(recommendedConfig.optional ?? {}).filter(
    (packageName) => !installedPackages.has(normalizePackageName(packageName)),
  );
}

export function guessProfileAlignment(installedPackages: Set<string>): ProfileAlignmentGuess | null {
  const supportedProfiles = getSupportedProfiles(recommendedConfig);
  if (supportedProfiles.length === 0) {
    return null;
  }

  const scoredProfiles = supportedProfiles.map(([id, profile]) => {
    const packageNames = Object.keys(profile.packages ?? {});
    const missingCount = packageNames.filter(
      (packageName) => !installedPackages.has(normalizePackageName(packageName)),
    ).length;
    return {
      id,
      label: profile.label ?? id,
      missingCount,
    };
  });

  scoredProfiles.sort((left, right) => {
    if (left.missingCount !== right.missingCount) {
      return left.missingCount - right.missingCount;
    }
    if (left.id === "cpu") return -1;
    if (right.id === "cpu") return 1;
    return left.id.localeCompare(right.id);
  });

  return scoredProfiles[0] ?? null;
}

/**
 * Inspect a Python executable's version and installed distributions without
 * mutating it. Resolves `null` when the interpreter cannot be run or is older
 * than Python 3.11.
 */
export function inspectPythonPackages(pythonPath: string): Promise<InspectPythonData | null> {
  return new Promise((resolve) => {
    execFile(
      pythonPath,
      [
        "-c",
        "import json, sys\n"
        + "from importlib import metadata as importlib_metadata\n"
        + "installed = {}\n"
        + "for dist in importlib_metadata.distributions():\n"
        + "    name = dist.metadata.get('Name')\n"
        + "    if name:\n"
        + "        installed[name] = dist.version\n"
        + "payload = {\n"
        + "    'version': f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}',\n"
        + "    'installed': installed,\n"
        + "}\n"
        + "print(json.dumps(payload))",
      ],
      { timeout: 10_000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          const payload = JSON.parse(stdout.trim()) as {
            version?: string;
            installed?: Record<string, string>;
          };
          const version = payload.version?.trim();
          if (!version) {
            resolve(null);
            return;
          }

          const [major, minor] = version.split(".").map(Number);
          if (major < 3 || (major === 3 && minor < 11)) {
            resolve(null);
            return;
          }

          const installedPackages = new Map<string, string>();
          for (const [name, packageVersion] of Object.entries(payload.installed ?? {})) {
            installedPackages.set(normalizePackageName(name), packageVersion);
          }

          resolve({ version, installedPackages });
        } catch {
          resolve(null);
        }
      },
    );
  });
}
