import type { OptionalPackageInfo, ProfileInfo, RecommendedConfigResponse } from "@/api/client";

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
