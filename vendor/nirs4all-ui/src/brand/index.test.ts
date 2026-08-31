import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  NIRS4ALL_BRANDS,
  getNirs4allBrandAssetPath,
  getNirs4allBrandDefinition,
  getNirs4allBrandRasterPath,
  isNirs4allBrandId,
  listNirs4allBrands,
  type Nirs4allBrandRaster,
  type Nirs4allBrandVariant,
} from "./index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const generatorPath = resolve(repositoryRoot, "scripts/generate-brand-assets.mjs");

const EXPECTED_IDS = [
  "nirs4all",
  "nirs4all-core",
  "nirs4all-ui",
  "nirs4all-studio",
  "nirs4all-web",
  "nirs4all-formats",
  "nirs4all-io",
  "nirs4all-methods",
  "nirs4all-datasets",
  "nirs4all-providers",
  "nirs4all-benchmarks",
  "nirs4all-repository",
  "nirs4all-tools",
  "nirs4all-papers",
  "nirs4all-device",
  "nirs4all-cluster",
  "nirs4all-quality",
  "dag-ml",
  "dag-ml-data",
];

const VARIANTS: readonly Nirs4allBrandVariant[] = ["icon", "horizontal", "horizontal-dark", "stacked", "stacked-dark"];
const RASTERS: readonly Nirs4allBrandRaster[] = ["favicon", "icon-32", "icon-180", "icon-256", "icon-512", "og"];

function generatorAccents(): Map<string, string> {
  const source = readFileSync(generatorPath, "utf8");
  const map = new Map<string, string>();
  const pattern = /\{ id: "([^"]+)", accent: "(#[0-9A-Fa-f]{6})"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    map.set(match[1] as string, (match[2] as string).toLowerCase());
  }
  return map;
}

describe("nirs4all-ui/brand", () => {
  it("publishes the full ecosystem brand manifest", () => {
    expect(listNirs4allBrands().map((brand) => brand.id)).toEqual(EXPECTED_IDS);
    expect(isNirs4allBrandId("nirs4all-studio")).toBe(true);
    expect(isNirs4allBrandId("unknown")).toBe(false);
    expect(getNirs4allBrandDefinition("nirs4all-ui").role).toBe("Shared visual system");
    expect(getNirs4allBrandDefinition("nirs4all-quality").tags).toContain("lab");
  });

  it("vendors every declared brand's real SVG marks", () => {
    for (const brand of NIRS4ALL_BRANDS) {
      for (const variant of VARIANTS) {
        const path = getNirs4allBrandAssetPath(brand, variant);
        expect(path).toBe(`assets/brands/${brand.id}/${variant}.svg`);
        const svg = readFileSync(resolve(repositoryRoot, path), "utf8");
        expect(svg).toContain("<svg");
      }
      const icon = readFileSync(resolve(repositoryRoot, getNirs4allBrandAssetPath(brand, "icon")), "utf8");
      expect(icon.toLowerCase()).toContain(brand.accent.toLowerCase());

      for (const raster of RASTERS) {
        const rasterPath = getNirs4allBrandRasterPath(brand, raster);
        expect(statSync(resolve(repositoryRoot, rasterPath)).size).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the manifest and the vendoring script in sync", () => {
    const accents = generatorAccents();
    expect([...accents.keys()]).toEqual(EXPECTED_IDS);
    for (const brand of NIRS4ALL_BRANDS) {
      expect(accents.get(brand.id)).toBe(brand.accent.toLowerCase());
    }
  });

  it("passes the vendored-kit verification", () => {
    execFileSync(process.execPath, [generatorPath, "--check"], { cwd: repositoryRoot, stdio: "pipe" });
  });
});
