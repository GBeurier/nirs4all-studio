import { describe, expect, it } from "vitest";

import {
  buildEnableSweepDefault,
  buildSweepTypeDefault,
  formatSweepValue,
  getRelevantSweepPresets,
  getSweepPreviewValues,
  parseSweepChoices,
} from "../sweepConfigHelpers";

describe("sweep config helpers", () => {
  it("builds activation defaults from the current value", () => {
    expect(buildEnableSweepDefault(20)).toEqual({
      type: "range",
      from: 10,
      to: 30,
      step: 2,
    });

    expect(buildEnableSweepDefault("rbf")).toEqual({
      type: "or",
      choices: ["rbf"],
    });

    expect(buildEnableSweepDefault(false)).toEqual({
      type: "or",
      choices: [false],
    });
  });

  it("builds type-change defaults without changing unsupported sweep types", () => {
    expect(buildSweepTypeDefault(20, "range")).toEqual({
      type: "range",
      from: 10,
      to: 30,
      step: 1,
    });

    expect(buildSweepTypeDefault(0, "log_range")).toEqual({
      type: "log_range",
      from: 0.0001,
      to: 0.01,
      count: 5,
    });

    expect(buildSweepTypeDefault("linear", "or")).toEqual({
      type: "or",
      choices: ["linear"],
    });

    expect(buildSweepTypeDefault(1, "grid")).toBeUndefined();
  });

  it("previews sweep values with the existing popover limit", () => {
    expect(
      getSweepPreviewValues({ type: "range", from: 1, to: 10, step: 2 })
    ).toEqual([1, 3, 5, 7, 9]);

    const logPreview = getSweepPreviewValues({
      type: "log_range",
      from: 0.001,
      to: 100,
      count: 3,
    });
    expect(logPreview[0]).toBeCloseTo(0.001);
    expect(logPreview[1]).toBeCloseTo(0.316227766);
    expect(logPreview[2]).toBeCloseTo(100);

    expect(
      getSweepPreviewValues({ type: "or", choices: [1, 2, 3, 4] }, 2)
    ).toEqual([1, 2]);
  });

  it("matches presets by parameter name in both directions", () => {
    const componentPresets = getRelevantSweepPresets("n_components");
    expect(
      componentPresets.some(
        (preset) => preset.sweep.type === "range" && preset.sweep.to === 30
      )
    ).toBe(true);

    const alphaPresets = getRelevantSweepPresets("ridge_alpha");
    expect(
      alphaPresets.some(
        (preset) => preset.sweep.type === "log_range" && preset.sweep.to === 100
      )
    ).toBe(true);

    expect(getRelevantSweepPresets("unknown_parameter")).toEqual([]);
  });

  it("formats preview values like the original popover formatter", () => {
    expect(formatSweepValue(10000)).toBe("1.0e+4");
    expect(formatSweepValue(0.0001)).toBe("1.0e-4");
    expect(formatSweepValue(0.12345)).toBe("0.123");
    expect(formatSweepValue(12)).toBe("12");
    expect(formatSweepValue(true)).toBe("true");
  });

  it("parses comma-separated choices with optional numeric coercion", () => {
    expect(parseSweepChoices("1, 2.5, true, false, abc, , 4x", true)).toEqual([
      1,
      2.5,
      true,
      false,
      "abc",
      4,
    ]);

    expect(parseSweepChoices("1, 2.5, true, false, abc, , 4x", false)).toEqual([
      "1",
      "2.5",
      true,
      false,
      "abc",
      "4x",
    ]);
  });
});
