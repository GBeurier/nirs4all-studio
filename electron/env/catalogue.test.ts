import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  normalizePackageName,
  RECOMMENDED_PACKAGES,
  recommendedInstallSpecs,
  REQUIRED_PACKAGES,
  requiredInstallSpecs,
} from "./catalogue";
import { versionSatisfies } from "./requirement-specs";

const require = createRequire(import.meta.url);
const catalogueFile = require("../../recommended-config.json") as { nirs4all: string };

describe("package catalogue", () => {
  it("requires nirs4all and its owner packages, each installable within its own range", () => {
    expect(REQUIRED_PACKAGES.map((spec) => spec.name)).toEqual([
      "nirs4all", "nirs4all-core", "dag-ml", "dag-ml-data", "nirs4all-io", "nirs4all-methods", "pls4all", "nirs4all-datasets",
    ]);
    for (const spec of REQUIRED_PACKAGES) {
      expect(versionSatisfies(spec.install, spec.range), `${spec.name} ${spec.install} within '${spec.range}'`).toBe(true);
    }
    // The historical top-level key is still read by the sidecar and must not drift.
    expect(REQUIRED_PACKAGES[0].install).toBe(catalogueFile.nirs4all);
  });

  it("installs the required cohort at exact versions", () => {
    expect(requiredInstallSpecs()).toEqual(REQUIRED_PACKAGES.map((spec) => `${spec.name}==${spec.install}`));
  });

  it("describes every recommended package with a recommended version that meets its minimum", () => {
    expect(RECOMMENDED_PACKAGES.length).toBeGreaterThan(10);
    for (const spec of RECOMMENDED_PACKAGES) {
      expect(spec.category, spec.name).toBeTruthy();
      expect(spec.description, spec.name).toBeTruthy();
      expect(versionSatisfies(spec.recommended, spec.min), `${spec.name} ${spec.recommended} meets '${spec.min}'`).toBe(true);
    }
    // PyTorch is installed on request, when a neural-network model is selected; XGBoost from Settings > Python.
    expect(RECOMMENDED_PACKAGES.find((spec) => spec.name === "torch")).toMatchObject({ defaultInstall: false, recommended: "2.6.0" });
    expect(RECOMMENDED_PACKAGES.find((spec) => spec.name === "xgboost")).toMatchObject({ defaultInstall: false, recommended: "3.0.0" });
    expect(RECOMMENDED_PACKAGES.filter((spec) => spec.defaultInstall).map((spec) => spec.name)).toEqual(["pyopls", "trendfitter", "umap-learn"]);
    expect(RECOMMENDED_PACKAGES.find((spec) => spec.name === "autogluon")).toMatchObject({ defaultInstall: false, python: "<3.13" });
  });

  it("pins requested recommended packages and refuses names outside the catalogue", () => {
    expect(recommendedInstallSpecs(["torch", "UMAP_learn", "torch"])).toEqual(["torch==2.6.0", "umap-learn==0.5.7"]);
    expect(recommendedInstallSpecs(["pypdf2"])).toEqual(["PyPDF2==3.0.1"]);
    expect(() => recommendedInstallSpecs(["requests"])).toThrow("not in Studio's package catalogue");
    expect(() => recommendedInstallSpecs(["torch --index-url http://example.test"])).toThrow("not in Studio's package catalogue");
  });

  it("normalises distribution names as PEP 503 does", () => {
    expect(normalizePackageName("NIRS4ALL_Methods")).toBe("nirs4all-methods");
    expect(normalizePackageName("ruamel.yaml")).toBe("ruamel-yaml");
  });
});
