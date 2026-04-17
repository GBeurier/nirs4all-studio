/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";

import type { DependencyInfo } from "@/api/client";

import { getDependencyVersionState } from "../dependencyVersionState";

function buildDependencyInfo(overrides: Partial<DependencyInfo>): DependencyInfo {
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

describe("getDependencyVersionState", () => {
  it("keeps the latest target visible when the installed version matches recommended", () => {
    const state = getDependencyVersionState(
      buildDependencyInfo({
        installed_version: "1.3.0",
        latest_version: "1.4.0",
        is_installed: true,
        is_outdated: true,
      }),
    );

    expect(state.isAtRecommended).toBe(true);
    expect(state.showLatestVersion).toBe(true);
    expect(state.showUpdateToLatest).toBe(true);
    expect(state.shouldConfirmLatestUpdate).toBe(true);
    expect(state.showRevertToRecommended).toBe(false);
  });

  it("keeps the recommended target visible when the installed version is latest", () => {
    const state = getDependencyVersionState(
      buildDependencyInfo({
        installed_version: "1.4.0",
        latest_version: "1.4.0",
        is_installed: true,
        is_above_recommended: true,
      }),
    );

    expect(state.isAtLatest).toBe(true);
    expect(state.showLatestVersion).toBe(true);
    expect(state.showRecommendedVersion).toBe(true);
    expect(state.showUpdateToLatest).toBe(false);
    expect(state.showRevertToRecommended).toBe(true);
  });

  it("offers both target actions when the installed version is below recommended and latest", () => {
    const state = getDependencyVersionState(
      buildDependencyInfo({
        installed_version: "1.2.0",
        latest_version: "1.4.0",
        is_installed: true,
        is_outdated: true,
        is_below_recommended: true,
      }),
    );

    expect(state.showRecommendedVersion).toBe(true);
    expect(state.showLatestVersion).toBe(true);
    expect(state.showUpdateToRecommended).toBe(true);
    expect(state.showUpdateToLatest).toBe(true);
  });

  it("does not invent a distinct latest target when recommended already matches latest", () => {
    const state = getDependencyVersionState(
      buildDependencyInfo({
        installed_version: "1.3.0",
        latest_version: "1.3.0",
        is_installed: true,
      }),
    );

    expect(state.isAtRecommended).toBe(true);
    expect(state.isAtLatest).toBe(true);
    expect(state.showLatestVersion).toBe(false);
    expect(state.showUpdateToLatest).toBe(false);
  });
});
