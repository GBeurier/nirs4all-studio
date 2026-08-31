import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  NIRS4ALL_CSS_TOKENS,
  NIRS4ALL_STYLE_ASSETS,
  getNirs4allCssVariable,
  getNirs4allStyleAsset,
} from "./index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("nirs4all-ui/styles", () => {
  it("declares shipped style and motion assets", () => {
    expect(NIRS4ALL_STYLE_ASSETS.map((asset) => asset.id)).toEqual([
      "default-theme",
      "dataset-builder",
      "viz-charts",
      "chains-explorer",
      "conformal-tree",
      "quality-lab-theme",
      "spectra-motion",
    ]);
    expect(getNirs4allStyleAsset("conformal-tree").packageExport)
      .toBe("nirs4all-ui/assets/conformal.css");
    expect(getNirs4allStyleAsset("viz-charts").packageExport)
      .toBe("nirs4all-ui/assets/viz.css");
    expect(getNirs4allStyleAsset("default-theme").packageExport)
      .toBe("nirs4all-ui/assets/styles/nirs4all-default.css");
    expect(getNirs4allStyleAsset("dataset-builder").packageExport)
      .toBe("nirs4all-ui/assets/datasetBuilder.css");
    expect(getNirs4allStyleAsset("quality-lab-theme").packageExport)
      .toBe("nirs4all-ui/assets/theme.css");
  });

  it("keeps declared visual assets present and usable", () => {
    const markers = {
      "default-theme": "--n4-color-primary",
      "dataset-builder": ".dsb",
      "viz-charts": ".n4viz",
      "chains-explorer": ".n4chains",
      "conformal-tree": ".n4conf-tree",
      "quality-lab-theme": "--success",
      "spectra-motion": "<svg",
    } as const;

    for (const asset of NIRS4ALL_STYLE_ASSETS) {
      const content = readFileSync(resolve(repositoryRoot, asset.path), "utf8");
      expect(content.length).toBeGreaterThan(200);
      expect(content).toContain(markers[asset.id]);
    }
  });

  it("exposes stable CSS token names", () => {
    expect(NIRS4ALL_CSS_TOKENS).toContain("n4-color-primary");
    expect(getNirs4allCssVariable("n4-radius")).toBe("var(--n4-radius)");
  });
});
