/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";

import type { RecommendedConfigResponse } from "@/api/client";

import {
  getCompatibleProfiles,
  getDefaultOptionalPackageNames,
  getPreselectedOptionalPackageNames,
  getVisibleOptionalPackages,
} from "./setup-config";

function buildConfig(): RecommendedConfigResponse {
  return {
    schema_version: "1.2",
    app_version: "0.6.2",
    nirs4all: "0.9.1",
    fetched_from: "bundled",
    fetched_at: "2026-04-18T10:00:00Z",
    profiles: [
      {
        id: "cpu",
        label: "CPU",
        description: "CPU only",
        platforms: ["win32", "linux", "darwin"],
        packages: {
          nirs4all: { min: ">=0.9.1", recommended: "0.9.1" },
          torch: { min: ">=2.1.0", recommended: "2.6.0" },
        },
      },
      {
        id: "gpu-cuda-torch",
        label: "CUDA",
        description: "CUDA acceleration",
        platforms: ["win32", "linux"],
        packages: {
          nirs4all: { min: ">=0.9.1", recommended: "0.9.1" },
          torch: { min: ">=2.1.0", recommended: "2.6.0" },
        },
      },
      {
        id: "gpu-mps",
        label: "Apple MPS",
        description: "Apple Silicon acceleration",
        platforms: ["darwin"],
        packages: {
          nirs4all: { min: ">=0.9.1", recommended: "0.9.1" },
          torch: { min: ">=2.1.0", recommended: "2.6.0" },
        },
      },
    ],
    optional: [
      {
        name: "torch",
        min: ">=2.1.0",
        recommended: "2.6.0",
        description: "PyTorch",
        category: "deep_learning",
        show_when_profile_managed: true,
        default_install: true,
      },
      {
        name: "tabicl",
        min: ">=2.0.0",
        recommended: "2.0.3",
        description: "Visible even when profile-managed",
        category: "deep_learning",
        show_when_profile_managed: true,
      },
      {
        name: "jax",
        min: ">=0.4.20",
        recommended: "0.4.38",
        description: "Optional accelerator",
        category: "deep_learning",
      },
    ],
  };
}

describe("setup-config platform helpers", () => {
  it("filters unsupported profiles out on Windows", () => {
    const ids = getCompatibleProfiles(buildConfig(), "win32").map((profile) => profile.id);

    expect(ids).toEqual(["cpu", "gpu-cuda-torch"]);
    expect(ids).not.toContain("gpu-mps");
  });

  it("keeps the Apple profile only on macOS", () => {
    const ids = getCompatibleProfiles(buildConfig(), "darwin").map((profile) => profile.id);

    expect(ids).toEqual(["cpu", "gpu-mps"]);
    expect(ids).not.toContain("gpu-cuda-torch");
  });

  it("still exposes opted-in optional packages even when profiles manage the same dependency", () => {
    const names = getVisibleOptionalPackages(buildConfig()).map((pkg) => pkg.name);

    expect(names).toContain("torch");
    expect(names).toContain("tabicl");
    expect(names).toContain("jax");
  });

  it("tracks which optional packages should be selected by default", () => {
    expect(getDefaultOptionalPackageNames(buildConfig())).toEqual(["torch"]);
  });

  it("merges default optional packages with packages already present in the runtime", () => {
    expect(getPreselectedOptionalPackageNames(buildConfig(), ["tabicl"])).toEqual(["torch", "tabicl"]);
  });
});
