import type { OptionalPackageInfo, ProfileInfo, RecommendedConfigResponse } from "@/api/config";

function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, "_").toLowerCase();
}

function collectProfileManagedPackages(profiles: ProfileInfo[]): Set<string> {
  const managed = new Set<string>();
  for (const profile of profiles) {
    for (const pkgName of Object.keys(profile.packages)) {
      managed.add(normalizePackageName(pkgName));
    }
  }
  return managed;
}

export function getProfileManagedPackageNames(config: RecommendedConfigResponse | null | undefined): Set<string> {
  if (!config) {
    return new Set();
  }
  return collectProfileManagedPackages(config.profiles);
}

export function getCompatibleProfiles(
  config: RecommendedConfigResponse | null | undefined,
  platform?: string | null,
): ProfileInfo[] {
  if (!config) {
    return [];
  }

  if (!platform) {
    return config.profiles;
  }

  return config.profiles.filter(
    (profile) => profile.platforms.length === 0 || profile.platforms.includes(platform),
  );
}

export function getVisibleOptionalPackages(
  config: RecommendedConfigResponse | null | undefined,
): OptionalPackageInfo[] {
  if (!config) {
    return [];
  }

  const managed = collectProfileManagedPackages(config.profiles);
  return config.optional.filter(
    (pkg) => pkg.show_when_profile_managed === true || !managed.has(normalizePackageName(pkg.name)),
  );
}

export function getDefaultOptionalPackageNames(
  config: RecommendedConfigResponse | null | undefined,
): string[] {
  return getVisibleOptionalPackages(config)
    .filter((pkg) => pkg.default_install === true)
    .map((pkg) => pkg.name);
}

export function getPreselectedOptionalPackageNames(
  config: RecommendedConfigResponse | null | undefined,
  installedPackageNames: Iterable<string> = [],
): string[] {
  const installed = new Set(
    Array.from(installedPackageNames, (name) => normalizePackageName(name)),
  );

  return getVisibleOptionalPackages(config)
    .filter(
      (pkg) => pkg.default_install === true || installed.has(normalizePackageName(pkg.name)),
    )
    .map((pkg) => pkg.name);
}

function getProfileExcludedOptionalNames(
  config: RecommendedConfigResponse | null | undefined,
  profileId: string | null | undefined,
): Set<string> {
  const profile = config?.profiles.find((candidate) => candidate.id === profileId);
  return new Set((profile?.exclude_optionals ?? []).map((name) => normalizePackageName(name)));
}

/**
 * Drop optional packages the selected profile refuses to install
 * (`exclude_optionals`, e.g. cpu-lite excludes torch/umap-learn).
 */
export function filterOptionalPackagesForProfile(
  packages: OptionalPackageInfo[],
  config: RecommendedConfigResponse | null | undefined,
  profileId: string | null | undefined,
): OptionalPackageInfo[] {
  const excluded = getProfileExcludedOptionalNames(config, profileId);
  if (excluded.size === 0) {
    return packages;
  }
  return packages.filter((pkg) => !excluded.has(normalizePackageName(pkg.name)));
}

/**
 * Drop package names the selected profile refuses to install (`exclude_optionals`).
 */
export function filterPackageNamesForProfile(
  names: string[],
  config: RecommendedConfigResponse | null | undefined,
  profileId: string | null | undefined,
): string[] {
  const excluded = getProfileExcludedOptionalNames(config, profileId);
  if (excluded.size === 0) {
    return names;
  }
  return names.filter((name) => !excluded.has(normalizePackageName(name)));
}
