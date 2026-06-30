import { describe, expect, it } from "vitest";
import type { OptionalPackageInfo } from "@/api/config";
import type { DependenciesResponse, DependencyInfo } from "@/api/dependencies";
import {
  buildDependencyIndex,
  getOptionalTargetVersion,
  getPackageStatusBadge,
  isSamePath,
  normalizePackageName,
  shortenPath,
  shortVersion,
} from "../PythonEnvPickerLogic";

function createDependency(name: string): DependencyInfo {
  return {
    name,
    category: "models",
    category_name: "Models",
    description: name,
    min_version: ">=1.0.0",
    recommended_version: "1.2.0",
    installed_version: null,
    latest_version: null,
    is_installed: false,
    is_outdated: false,
    is_below_recommended: false,
    is_above_recommended: false,
    can_update: false,
  };
}

function createDependencies(packages: DependencyInfo[]): DependenciesResponse {
  return {
    categories: [
      {
        id: "models",
        name: "Models",
        description: "Optional models",
        packages,
        installed_count: 0,
        total_count: packages.length,
      },
    ],
    runtime_valid: true,
    runtime_path: "C:\\Python313",
    venv_valid: true,
    venv_path: "C:\\Python313",
    nirs4all_installed: true,
    nirs4all_version: "0.9.1",
    total_installed: 0,
    total_packages: packages.length,
    cached_at: "2026-04-18T08:00:00",
  };
}

describe("PythonEnvPickerLogic", () => {
  it("formats runtime versions and display paths without component state", () => {
    expect(shortVersion(null)).toBe("Unknown");
    expect(shortVersion("Python 3.13.1 (main, Apr 18 2026)")).toBe("3.13.1");
    expect(shortVersion("3.14-dev")).toBe("3.14-dev");

    expect(shortenPath(null)).toBe("Not configured");
    expect(shortenPath("C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313\\python.exe")).toBe(
      "...\\Python\\Python313\\python.exe",
    );
    expect(shortenPath("/opt/nirs4all/python/bin/python")).toBe(".../python/bin/python");
  });

  it("normalizes package names and indexes dependencies with pip-name equivalents", () => {
    const tabPfn = createDependency("tabpfn");
    const umap = createDependency("umap-learn");
    const dependencies = createDependencies([tabPfn, umap]);

    expect(normalizePackageName("UMAP.learn")).toBe("umap_learn");

    const index = buildDependencyIndex(dependencies);
    expect(index.get("tabpfn")).toBe(tabPfn);
    expect(index.get("umap_learn")).toBe(umap);
    expect(buildDependencyIndex(null).size).toBe(0);
  });

  it("keeps package presentation labels pure and predictable", () => {
    const optionalWithRecommended: OptionalPackageInfo = {
      name: "tabpfn",
      min: ">=2.0.0",
      recommended: "2.0.3",
      description: "TabPFN",
      category: "models",
    };
    const optionalWithMinimumOnly: OptionalPackageInfo = {
      ...optionalWithRecommended,
      recommended: null,
    };

    expect(getOptionalTargetVersion(optionalWithRecommended)).toBe("2.0.3");
    expect(getOptionalTargetVersion(optionalWithMinimumOnly)).toBe(">=2.0.0");
    expect(getPackageStatusBadge("aligned")).toEqual({ label: "Present", variant: "outline" });
    expect(getPackageStatusBadge("outdated")).toEqual({ label: "Update needed", variant: "secondary" });
    expect(getPackageStatusBadge("missing")).toEqual({ label: "Not present", variant: "destructive" });
    expect(getPackageStatusBadge("extra")).toEqual({ label: "extra", variant: "secondary" });
  });

  it("matches current Python paths across Windows separator and case differences", () => {
    expect(isSamePath("C:\\Python313\\python.exe", "c:/python313/python.exe")).toBe(true);
    expect(isSamePath("/opt/python/bin/python", "/opt/python/bin/python3")).toBe(false);
  });
});
