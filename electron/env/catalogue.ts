/**
 * Package catalogue from recommended-config.json: the required cohort
 * (`required`) and the recommended packages (`optional`). It is the only
 * source of package names, ranges and versions in the Electron main process.
 */

import { loadRecommendedConfig } from "./external-config";

export interface RequiredPackageSpec {
  name: string;
  /** Accepted version specifier; empty when any version is accepted. */
  range: string;
  /** Exact version Studio installs. */
  install: string;
}

export interface RecommendedPackageSpec {
  name: string;
  /** Lowest supported version specifier, e.g. `>=2.1.0`. */
  min: string;
  recommended: string;
  category: string;
  description: string;
  defaultInstall: boolean;
  /** Python versions the recommended release supports, e.g. `<3.13`. */
  python?: string;
}

interface CatalogueFile {
  required: RequiredPackageSpec[];
  optional: Record<string, {
    min: string;
    recommended: string;
    category: string;
    description: string;
    default_install?: boolean;
    python?: string;
  }>;
}

const catalogueFile = loadRecommendedConfig<CatalogueFile>();

export const REQUIRED_PACKAGES: readonly RequiredPackageSpec[] = catalogueFile.required;

export const RECOMMENDED_PACKAGES: readonly RecommendedPackageSpec[] = Object.entries(catalogueFile.optional)
  .map(([name, spec]) => ({
    name,
    min: spec.min,
    recommended: spec.recommended,
    category: spec.category,
    description: spec.description,
    defaultInstall: spec.default_install === true,
    ...(spec.python ? { python: spec.python } : {}),
  }));

/** PEP 503 distribution name normalisation. */
export function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, "-").toLowerCase();
}

/** `name==install` for every required package except the `excluded` (normalised) names. */
export function requiredInstallSpecs(excluded: ReadonlySet<string> = new Set()): string[] {
  return REQUIRED_PACKAGES
    .filter((spec) => !excluded.has(normalizePackageName(spec.name)))
    .map((spec) => `${spec.name}==${spec.install}`);
}

/** `name==recommended` for the requested catalogue packages; unknown names are refused. */
export function recommendedInstallSpecs(names: readonly string[]): string[] {
  return [...new Set(names.map(normalizePackageName))].map((requested) => {
    const spec = RECOMMENDED_PACKAGES.find((candidate) => normalizePackageName(candidate.name) === requested);
    if (!spec) throw new Error(`"${requested}" is not in Studio's package catalogue.`);
    return `${spec.name}==${spec.recommended}`;
  });
}
