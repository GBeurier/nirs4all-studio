/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";

import type {
  DependenciesResponse,
  DependencyCategory,
  DependencyInfo,
} from "@/api/dependencies";

import {
  countOutdatedPackages,
  formatLastActionText,
  getAboveBadgeLabel,
  getCategoryBadgeVariant,
  getCategoryProgressPercentage,
  getPackageRowClassName,
  getPackageStatusKind,
  getVersionBadgeKind,
  type LastActionState,
} from "../DependenciesManagerLogic";

function buildDependencyInfo(overrides: Partial<DependencyInfo> = {}): DependencyInfo {
  return {
    name: "ikpls",
    category: "pls_variants",
    category_name: "PLS Variants",
    description: "Improved kernel PLS algorithms",
    min_version: "1.1.0",
    recommended_version: "1.3.0",
    installed_version: null,
    latest_version: null,
    is_installed: false,
    is_outdated: false,
    is_below_recommended: false,
    is_above_recommended: false,
    can_update: false,
    ...overrides,
  };
}

function buildCategory(overrides: Partial<DependencyCategory> = {}): DependencyCategory {
  return {
    id: "pls_variants",
    name: "PLS Variants",
    description: "PLS algorithm packages",
    packages: [],
    installed_count: 0,
    total_count: 0,
    ...overrides,
  };
}

describe("getPackageStatusKind", () => {
  it("reports not-installed packages", () => {
    expect(getPackageStatusKind(buildDependencyInfo({ is_installed: false }))).toBe(
      "not-installed",
    );
  });

  it("reports below/above recommended", () => {
    expect(
      getPackageStatusKind(
        buildDependencyInfo({ is_installed: true, is_below_recommended: true }),
      ),
    ).toBe("below");
    expect(
      getPackageStatusKind(
        buildDependencyInfo({ is_installed: true, is_above_recommended: true }),
      ),
    ).toBe("above");
  });

  it("reports ok for installed packages at recommended or without a recommended version", () => {
    expect(getPackageStatusKind(buildDependencyInfo({ is_installed: true }))).toBe("ok");
    expect(
      getPackageStatusKind(
        buildDependencyInfo({ is_installed: true, recommended_version: null }),
      ),
    ).toBe("ok");
  });
});

describe("getVersionBadgeKind", () => {
  it("maps each install/version state to a badge kind", () => {
    expect(getVersionBadgeKind(buildDependencyInfo({ is_installed: false }), false)).toBe(
      "not-installed",
    );
    expect(getVersionBadgeKind(buildDependencyInfo({ is_installed: true }), true)).toBe(
      "recommended",
    );
    expect(
      getVersionBadgeKind(
        buildDependencyInfo({ is_installed: true, is_below_recommended: true }),
        false,
      ),
    ).toBe("below");
    expect(
      getVersionBadgeKind(
        buildDependencyInfo({ is_installed: true, is_above_recommended: true }),
        false,
      ),
    ).toBe("above");
    expect(
      getVersionBadgeKind(
        buildDependencyInfo({ is_installed: true, recommended_version: null }),
        false,
      ),
    ).toBe("plain");
  });
});

describe("getAboveBadgeLabel", () => {
  it("reads latest or custom", () => {
    expect(getAboveBadgeLabel(true)).toBe("latest");
    expect(getAboveBadgeLabel(false)).toBe("custom");
  });
});

describe("getPackageRowClassName", () => {
  it("uses muted styling when not installed", () => {
    const className = getPackageRowClassName(buildDependencyInfo({ is_installed: false }));
    expect(className).toContain("bg-muted/30");
    expect(className).toContain("border-muted");
  });

  it("uses amber styling when below recommended", () => {
    const className = getPackageRowClassName(
      buildDependencyInfo({ is_installed: true, is_below_recommended: true }),
    );
    expect(className).toContain("amber");
  });

  it("uses green styling when installed and healthy", () => {
    const className = getPackageRowClassName(buildDependencyInfo({ is_installed: true }));
    expect(className).toContain("green");
  });
});

describe("getCategoryProgressPercentage", () => {
  it("returns 0 for an empty category", () => {
    expect(getCategoryProgressPercentage(buildCategory({ total_count: 0 }))).toBe(0);
  });

  it("computes the installed ratio as a percentage", () => {
    expect(
      getCategoryProgressPercentage(
        buildCategory({ installed_count: 1, total_count: 4 }),
      ),
    ).toBe(25);
  });
});

describe("getCategoryBadgeVariant", () => {
  it("is default when fully installed", () => {
    expect(
      getCategoryBadgeVariant(buildCategory({ installed_count: 3, total_count: 3 })),
    ).toBe("default");
  });

  it("is secondary when partially installed", () => {
    expect(
      getCategoryBadgeVariant(buildCategory({ installed_count: 1, total_count: 3 })),
    ).toBe("secondary");
  });

  it("is outline when nothing is installed", () => {
    expect(
      getCategoryBadgeVariant(buildCategory({ installed_count: 0, total_count: 3 })),
    ).toBe("outline");
  });
});

describe("countOutdatedPackages", () => {
  it("sums outdated packages across categories", () => {
    const dependencies: DependenciesResponse = {
      categories: [
        buildCategory({
          packages: [
            buildDependencyInfo({ name: "a", is_outdated: true }),
            buildDependencyInfo({ name: "b", is_outdated: false }),
          ],
        }),
        buildCategory({
          id: "other",
          packages: [buildDependencyInfo({ name: "c", is_outdated: true })],
        }),
      ],
      runtime_valid: true,
      runtime_path: "",
      venv_valid: true,
      venv_path: "",
      nirs4all_installed: true,
      nirs4all_version: "0.9.0",
      total_installed: 2,
      total_packages: 3,
      cached_at: null,
    };

    expect(countOutdatedPackages(dependencies)).toBe(2);
  });
});

describe("formatLastActionText", () => {
  it("reports a success message derived from the action type", () => {
    const action: LastActionState = {
      type: "install",
      package: "ikpls",
      success: true,
      message: "ignored on success",
    };
    expect(formatLastActionText(action)).toBe("Successfully installed ikpls");
  });

  it("surfaces the raw error message on failure", () => {
    const action: LastActionState = {
      type: "uninstall",
      package: "ikpls",
      success: false,
      message: "pip exploded",
    };
    expect(formatLastActionText(action)).toBe("pip exploded");
  });
});
