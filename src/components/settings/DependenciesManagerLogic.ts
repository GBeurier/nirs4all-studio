/**
 * Pure presentation helpers for the Dependencies Manager.
 *
 * These functions hold the branching logic that decides how a package or
 * category should look (status kind, badge kind, row styling, progress) and
 * how transient UI state (last action) should read. Keeping them free of JSX
 * makes the rules unit-testable and keeps the components declarative.
 */

import type {
  DependenciesResponse,
  DependencyCategory,
  DependencyInfo,
} from "@/api/dependencies";

/** The visual status of a package, used to pick an icon and row colour. */
export type PackageStatusKind = "not-installed" | "below" | "above" | "ok";

/** The version badge variant shown next to a package name. */
export type VersionBadgeKind =
  | "not-installed"
  | "recommended"
  | "below"
  | "above"
  | "plain";

/** A package's above-recommended badge reads "latest" or "custom". */
export type AboveBadgeLabel = "latest" | "custom";

/** Transient notification describing the outcome of the last package action. */
export interface LastActionState {
  type: "install" | "uninstall" | "update";
  package: string;
  success: boolean;
  message: string;
}

/**
 * Classify a package's installation/version status.
 *
 * An installed package that is neither below nor above recommended is "ok" —
 * the at-recommended and "no recommended_version" cases render identically.
 */
export function getPackageStatusKind(pkg: DependencyInfo): PackageStatusKind {
  if (!pkg.is_installed) return "not-installed";
  if (pkg.is_below_recommended) return "below";
  if (pkg.is_above_recommended) return "above";
  return "ok";
}

/** Choose the version badge variant for a package. */
export function getVersionBadgeKind(
  pkg: DependencyInfo,
  isAtRecommended: boolean,
): VersionBadgeKind {
  if (!pkg.is_installed) return "not-installed";
  if (isAtRecommended) return "recommended";
  if (pkg.is_below_recommended) return "below";
  if (pkg.is_above_recommended) return "above";
  return "plain";
}

/** Label shown for an above-recommended (or untracked) installed version. */
export function getAboveBadgeLabel(isAtLatest: boolean): AboveBadgeLabel {
  return isAtLatest ? "latest" : "custom";
}

/** Tailwind classes for the package row container, keyed off install/version status. */
export function getPackageRowClassName(pkg: DependencyInfo): string {
  const base =
    "flex items-center justify-between py-3 px-4 rounded-lg border transition-colors";
  if (!pkg.is_installed) {
    return `${base} bg-muted/30 border-muted`;
  }
  if (pkg.is_below_recommended) {
    return `${base} bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50`;
  }
  return `${base} bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900/50`;
}

/** Installed/total progress for a category, as a 0–100 percentage. */
export function getCategoryProgressPercentage(category: DependencyCategory): number {
  return category.total_count > 0
    ? (category.installed_count / category.total_count) * 100
    : 0;
}

/** Badge variant summarising how complete a category's installs are. */
export function getCategoryBadgeVariant(
  category: DependencyCategory,
): "default" | "secondary" | "outline" {
  if (category.installed_count === category.total_count) return "default";
  if (category.installed_count > 0) return "secondary";
  return "outline";
}

/** Count packages flagged as outdated across all categories. */
export function countOutdatedPackages(dependencies: DependenciesResponse): number {
  return dependencies.categories.reduce(
    (acc, cat) => acc + cat.packages.filter((p) => p.is_outdated).length,
    0,
  );
}

/** Human-readable text for the last-action notification banner. */
export function formatLastActionText(lastAction: LastActionState): string {
  return lastAction.success
    ? `Successfully ${lastAction.type}ed ${lastAction.package}`
    : lastAction.message;
}
