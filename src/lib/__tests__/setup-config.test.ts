import { describe, expect, it } from "vitest";

import { getProfileManagedPackageNames, getVisibleOptionalPackages } from "@/lib/setup-config";
import type { RecommendedConfigResponse } from "@/api/client";

const config: RecommendedConfigResponse = {
  schema_version: "1.2",
  app_version: "0.4.0",
  nirs4all: "0.8.9",
  fetched_from: "bundled",
  fetched_at: "2026-04-14T00:00:00",
  profiles: [
    {
      id: "cpu",
      label: "CPU",
      description: "CPU profile",
      platforms: ["win32", "linux", "darwin"],
      packages: {
        nirs4all: { min: ">=0.8.9", recommended: "0.8.9" },
        torch: { min: ">=2.1.0", recommended: "2.6.0" },
      },
    },
  ],
  optional: [
    {
      name: "torch",
      min: ">=2.1.0",
      recommended: "2.6.0",
      description: "PyTorch deep learning framework",
      category: "deep_learning",
      note: null,
    },
    {
      name: "keras",
      min: ">=3.0.0",
      recommended: "3.8.0",
      description: "Keras",
      category: "deep_learning",
      note: null,
    },
  ],
};

describe("setup-config helpers", () => {
  it("collects profile-managed packages from all profiles", () => {
    const managed = getProfileManagedPackageNames(config);

    expect(managed.has("nirs4all")).toBe(true);
    expect(managed.has("torch")).toBe(true);
  });

  it("filters profile-managed packages from visible optional extras", () => {
    const optional = getVisibleOptionalPackages(config);

    expect(optional.map((pkg) => pkg.name)).toEqual(["keras"]);
  });
});
