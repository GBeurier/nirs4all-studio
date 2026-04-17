import type { DependencyInfo } from "@/api/client";

export interface DependencyVersionState {
  isAtRecommended: boolean;
  isAtLatest: boolean;
  latestDiffersFromRecommended: boolean;
  hasRecommendedTarget: boolean;
  hasLatestTarget: boolean;
  showRecommendedVersion: boolean;
  showLatestVersion: boolean;
  showUpdateToRecommended: boolean;
  showRevertToRecommended: boolean;
  showUpdateToLatest: boolean;
  shouldConfirmLatestUpdate: boolean;
}

export function getDependencyVersionState(pkg: DependencyInfo): DependencyVersionState {
  const installedVersion = pkg.installed_version;
  const recommendedVersion = pkg.recommended_version;
  const latestVersion = pkg.latest_version;

  const isAtRecommended = Boolean(
    pkg.is_installed &&
      recommendedVersion &&
      !pkg.is_below_recommended &&
      !pkg.is_above_recommended,
  );

  const isAtLatest = Boolean(
    pkg.is_installed &&
      installedVersion &&
      latestVersion &&
      installedVersion === latestVersion,
  );

  const latestDiffersFromRecommended = Boolean(
    latestVersion &&
      recommendedVersion &&
      latestVersion !== recommendedVersion,
  );

  const hasRecommendedTarget = Boolean(
    pkg.is_installed &&
      installedVersion &&
      recommendedVersion &&
      installedVersion !== recommendedVersion,
  );

  const hasLatestTarget = Boolean(
    pkg.is_installed &&
      installedVersion &&
      latestVersion &&
      installedVersion !== latestVersion,
  );

  return {
    isAtRecommended,
    isAtLatest,
    latestDiffersFromRecommended,
    hasRecommendedTarget,
    hasLatestTarget,
    showRecommendedVersion: Boolean(recommendedVersion && (!pkg.is_installed || hasRecommendedTarget)),
    showLatestVersion: Boolean(
      latestVersion &&
        (!pkg.is_installed || hasLatestTarget || latestDiffersFromRecommended),
    ),
    showUpdateToRecommended: Boolean(hasRecommendedTarget && pkg.is_below_recommended),
    showRevertToRecommended: Boolean(hasRecommendedTarget && !pkg.is_below_recommended),
    showUpdateToLatest: hasLatestTarget,
    shouldConfirmLatestUpdate: Boolean(hasLatestTarget && latestDiffersFromRecommended),
  };
}
