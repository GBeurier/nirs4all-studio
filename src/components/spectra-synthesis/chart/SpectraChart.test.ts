import { describe, expect, it } from "vitest";

import type { PreviewData } from "../contexts";
import { buildSynthesisChartData, getColorForTarget } from "./synthesisChartData";

/** Build a minimal PreviewData; only spectra/wavelengths/targets/target_type are read. */
function previewData(
  spectra: number[][],
  wavelengths: number[],
  targets: number[],
  target_type: "regression" | "classification" = "regression",
): PreviewData {
  return {
    spectra,
    wavelengths,
    targets,
    target_type,
    statistics: null,
    execution_time_ms: 0,
    actual_samples: spectra.length,
  } as PreviewData;
}

describe("buildSynthesisChartData", () => {
  it("computes per-wavelength mean and ±1σ band from raw spectra", () => {
    // Two spectra: at wavelength 0 -> {0, 2} (mean 1, std 1); at wavelength 1 -> {10, 14} (mean 12, std 2)
    const result = buildSynthesisChartData(
      previewData(
        [
          [0, 10],
          [2, 14],
        ],
        [400, 410],
        [1, 2],
      ),
      50,
    );

    expect(result.mergedData[0]).toMatchObject({ wavelength: 400, mean: 1, upper: 2, lower: 0 });
    expect(result.mergedData[1]).toMatchObject({ wavelength: 410, mean: 12, upper: 14, lower: 10 });
  });

  it("emits one spectrum_<n> series per sampled line when under the cap", () => {
    const result = buildSynthesisChartData(
      previewData(
        [
          [0, 10],
          [2, 14],
        ],
        [400, 410],
        [1, 2],
      ),
      50,
    );

    // 2 spectra <= cap -> 2 individual lines, both wavelengths carry both series
    expect(result.lineColors).toHaveLength(2);
    expect(result.mergedData[0]).toMatchObject({ spectrum_0: 0, spectrum_1: 2 });
    expect(result.mergedData[1]).toMatchObject({ spectrum_0: 10, spectrum_1: 14 });
  });

  it("caps the number of sampled lines and spaces them evenly when over the cap", () => {
    const spectra = Array.from({ length: 10 }, (_, s) => [s, s + 100]);
    const targets = Array.from({ length: 10 }, (_, s) => s);
    const result = buildSynthesisChartData(previewData(spectra, [400, 410], targets), 4);

    // 10 spectra, cap 4 -> exactly 4 lines sampled at floor(i * 10/4) = indices 0,2,5,7
    expect(result.lineColors).toHaveLength(4);
    expect(result.mergedData[0]).toMatchObject({
      spectrum_0: 0,
      spectrum_1: 2,
      spectrum_2: 5,
      spectrum_3: 7,
    });
  });

  it("colours sampled lines by target value (regression scale, classification palette)", () => {
    const reg = buildSynthesisChartData(
      previewData(
        [
          [0],
          [1],
        ],
        [400],
        [0, 10],
        "regression",
      ),
      50,
    );
    // min target -> blue end, max target -> red end of the continuous scale
    expect(reg.lineColors[0]).toBe(getColorForTarget(0, "regression", 0, 10));
    expect(reg.lineColors[1]).toBe(getColorForTarget(10, "regression", 0, 10));
    expect(reg.lineColors[0]).not.toBe(reg.lineColors[1]);

    const cls = buildSynthesisChartData(
      previewData(
        [
          [0],
          [1],
        ],
        [400],
        [0, 1],
        "classification",
      ),
      50,
    );
    expect(cls.lineColors[0]).toBe("#3b82f6"); // class 0 -> blue
    expect(cls.lineColors[1]).toBe("#ef4444"); // class 1 -> red
  });

  it("returns empty data for empty spectra or wavelengths", () => {
    expect(buildSynthesisChartData(previewData([], [400], []), 50)).toEqual({
      mergedData: [],
      lineColors: [],
    });
    expect(buildSynthesisChartData(previewData([[0]], [], [1]), 50)).toEqual({
      mergedData: [],
      lineColors: [],
    });
  });
});

describe("getColorForTarget", () => {
  it("cycles classification colours by integer class index", () => {
    expect(getColorForTarget(0, "classification", 0, 7)).toBe("#3b82f6");
    expect(getColorForTarget(8, "classification", 0, 7)).toBe("#3b82f6"); // wraps mod 8
  });

  it("maps regression targets onto a blue→red continuous scale", () => {
    expect(getColorForTarget(0, "regression", 0, 10)).toBe("rgb(59, 130, 246)"); // blue
    expect(getColorForTarget(10, "regression", 0, 10)).toBe("rgb(239, 68, 68)"); // red
  });

  it("falls back to the scale midpoint when min equals max", () => {
    // normalized 0.5 -> midpoint colour
    expect(getColorForTarget(5, "regression", 5, 5)).toBe(
      getColorForTarget(5, "regression", 0, 10),
    );
  });
});
