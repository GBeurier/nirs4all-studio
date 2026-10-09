import type { TFunction } from "i18next";

import type { OptionalPackageInfo } from "@/api/config";
import type { DependenciesResponse, DependencyInfo } from "@/api/dependencies";

export type PackageStatusBadge = {
  label: string;
  variant: "default" | "outline" | "secondary" | "destructive";
};

/** Extract short version like "3.11.13" from full version string. */
export function shortVersion(version: string | null, t: TFunction): string {
  if (!version) return t("settings.pythonEnvPicker.unknown");
  const match = version.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : version;
}

/** Compare two filesystem paths with normalized separators for cross-platform checks. */
export function isSamePath(filePath: string, otherPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  return norm(filePath) === norm(otherPath);
}

/** Shorten a path for display by showing only the last three segments. */
export function shortenPath(path: string | null, t: TFunction): string {
  if (!path) return t("common.notConfigured");
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  if (parts.length <= 4) return path;
  return "..." + sep + parts.slice(-3).join(sep);
}

export function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, "_").toLowerCase();
}

export function buildDependencyIndex(dependencies: DependenciesResponse | null): Map<string, DependencyInfo> {
  const byName = new Map<string, DependencyInfo>();
  if (!dependencies) {
    return byName;
  }

  for (const category of dependencies.categories) {
    for (const pkg of category.packages) {
      byName.set(normalizePackageName(pkg.name), pkg);
    }
  }

  return byName;
}

export function getOptionalTargetVersion(pkg: OptionalPackageInfo): string {
  return pkg.recommended ?? pkg.min;
}

export function getPackageStatusBadge(status: string, t: TFunction): PackageStatusBadge {
  switch (status) {
    case "aligned":
      return { label: t("settings.pythonEnvPicker.packagePresent"), variant: "outline" };
    case "outdated":
      return { label: t("settings.pythonEnvPicker.packageUpdateNeeded"), variant: "secondary" };
    case "missing":
      return { label: t("settings.pythonEnvPicker.packageNotPresent"), variant: "destructive" };
    default:
      return { label: status, variant: "secondary" };
  }
}
