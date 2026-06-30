import { describe, expect, it } from "vitest";

import {
  COMPLEXITY_PRESETS,
  buildComplexityPatch,
  buildCustomModePatch,
  buildNullableSelectPatch,
  buildWavelengthEndPatch,
  buildWavelengthRangePatch,
  buildWavelengthStartPatch,
  calculateWavelengthPointCount,
  coerceWavelengthRange,
  formatComponentCategoryLabel,
  getComponentBadgeLabel,
  getSelectedComponentBadges,
  groupChemicalComponents,
  normalizeNullableSelectValue,
  projectFeaturesParams,
} from "../FeaturesConfigData";

describe("FeaturesConfigData", () => {
  it("projects raw params into a typed read model with defaults", () => {
    const readModel = projectFeaturesParams({});

    expect(readModel).toMatchObject({
      wavelengthRange: [1000, 2500],
      wavelengthStep: 2,
      complexity: "custom",
      components: ["water", "protein", "lipid"],
      pathLengthStd: 0.05,
      baselineAmplitude: 0.02,
      scatterAlphaStd: 0.05,
      scatterBetaStd: 0.01,
      tiltStd: 0.01,
      globalSlopeMean: 0.05,
      globalSlopeStd: 0.03,
      shiftStd: 0.5,
      stretchStd: 0.001,
      instrumentalFwhm: 8,
      noiseBase: 0.005,
      noiseSignalDep: 0.01,
      artifactProb: 0.02,
      instrument: null,
      measurementMode: null,
      instrumentSelectValue: "none",
      measurementModeSelectValue: "none",
      numWavelengths: 751,
    });
    expect(projectFeaturesParams({ complexity: "" }).complexity).toBe("custom");
  });

  it("preserves valid overrides and filters component names to strings", () => {
    const readModel = projectFeaturesParams({
      wavelength_range: [900, 1700],
      wavelength_step: 5,
      complexity: "realistic",
      components: ["water", 42, "lipid"],
      path_length_std: 0.07,
      instrument: "bruker_mpa",
      measurement_mode: "reflectance",
    });

    expect(readModel.wavelengthRange).toEqual([900, 1700]);
    expect(readModel.numWavelengths).toBe(161);
    expect(readModel.components).toEqual(["water", "lipid"]);
    expect(readModel.pathLengthStd).toBe(0.07);
    expect(readModel.instrumentSelectValue).toBe("bruker_mpa");
    expect(readModel.measurementModeSelectValue).toBe("reflectance");
  });

  it("calculates wavelength point counts and coerces wavelength range patches", () => {
    expect(calculateWavelengthPointCount([1000, 2500], 2)).toBe(751);
    expect(calculateWavelengthPointCount([900, 1700], 5)).toBe(161);
    expect(coerceWavelengthRange(["bad", 1800])).toEqual([1000, 1800]);
    expect(buildWavelengthRangePatch([1200, 2100])).toEqual({
      wavelength_range: [1200, 2100],
    });
  });

  it("builds wavelength input patches with the same input fallbacks as the panel", () => {
    expect(buildWavelengthStartPatch("850", [1000, 2500])).toEqual({
      wavelength_range: [850, 2500],
    });
    expect(buildWavelengthStartPatch("", [1000, 2500])).toEqual({
      wavelength_range: [350, 2500],
    });
    expect(buildWavelengthEndPatch("2200", [1000, 2500])).toEqual({
      wavelength_range: [1000, 2200],
    });
    expect(buildWavelengthEndPatch("bad", [1000, 2500])).toEqual({
      wavelength_range: [1000, 3000],
    });
  });

  it("groups chemical components and derives selected badge labels", () => {
    const groups = groupChemicalComponents();

    expect(groups.water.map((component) => component.name)).toEqual(["water", "moisture"]);
    expect(groups.proteins.some((component) => component.name === "protein")).toBe(true);
    expect(formatComponentCategoryLabel("carbohydrates")).toBe("Carbohydrates");
    expect(getComponentBadgeLabel("protein")).toBe("Protein");
    expect(getComponentBadgeLabel("unknown_component")).toBe("unknown_component");
    expect(getSelectedComponentBadges(["lipid", "unknown_component"])).toEqual([
      { name: "lipid", label: "Lipid" },
      { name: "unknown_component", label: "unknown_component" },
    ]);
  });

  it("constructs complexity preset and custom-mode patches", () => {
    expect(buildComplexityPatch("simple")).toEqual({
      complexity: "simple",
      ...COMPLEXITY_PRESETS.simple,
    });
    expect(buildComplexityPatch("custom")).toEqual({ complexity: "custom" });
    expect(buildComplexityPatch("unexpected")).toEqual({ complexity: "unexpected" });
    expect(buildCustomModePatch("noise_base", 0.012)).toEqual({
      noise_base: 0.012,
      complexity: "custom",
    });
  });

  it("normalizes nullable select values and patches the none sentinel back to null", () => {
    expect(normalizeNullableSelectValue(null)).toBe("none");
    expect(normalizeNullableSelectValue(undefined)).toBe("none");
    expect(normalizeNullableSelectValue("reflectance")).toBe("reflectance");
    expect(buildNullableSelectPatch("instrument", "none")).toEqual({ instrument: null });
    expect(buildNullableSelectPatch("measurement_mode", "atr")).toEqual({
      measurement_mode: "atr",
    });
  });
});
