import { describe, expect, it } from "vitest";

import * as builders from "./definitionBuilders";
import * as catalogs from "./definitionCatalogs";
import * as definitions from "./definitions";

describe("spectra synthesis definition modules", () => {
  it("keeps definitions.ts as the public catalog entry point", () => {
    expect(definitions.SYNTHESIS_CATEGORIES).toBe(catalogs.SYNTHESIS_CATEGORIES);
    expect(definitions.SYNTHESIS_STEPS).toBe(catalogs.SYNTHESIS_STEPS);
    expect(definitions.CHEMICAL_COMPONENTS).toBe(catalogs.CHEMICAL_COMPONENTS);
  });

  it("keeps definitions.ts as the public builder entry point", () => {
    expect(definitions.getStepDefinition).toBe(builders.getStepDefinition);
    expect(definitions.getStepsByCategory).toBe(builders.getStepsByCategory);
    expect(definitions.getCategoryDefinition).toBe(builders.getCategoryDefinition);
    expect(definitions.getComponentsByCategory).toBe(builders.getComponentsByCategory);
    expect(definitions.getComponentOptions).toBe(builders.getComponentOptions);
    expect(definitions.getDefaultSynthesisConfig).toBe(builders.getDefaultSynthesisConfig);
    expect(definitions.getDefaultStepParams).toBe(builders.getDefaultStepParams);
  });

  it("finds step and category definitions from the catalogs", () => {
    expect(builders.getStepDefinition("features")).toMatchObject({
      id: "synthesis.features",
      method: "with_features",
      category: "basic",
    });
    expect(builders.getStepDefinition("missing")).toBeUndefined();

    expect(builders.getStepsByCategory("targets").map((step) => step.type)).toEqual([
      "targets",
      "classification",
    ]);
    expect(builders.getStepsByCategory("missing")).toEqual([]);

    expect(builders.getCategoryDefinition("targets")).toMatchObject({
      label: "Target Configuration",
      exclusive: true,
    });
    expect(builders.getCategoryDefinition("missing")).toBeUndefined();
  });

  it("maps component catalogs to category filters and multiselect options", () => {
    expect(builders.getComponentsByCategory("water").map((component) => component.name)).toEqual([
      "water",
      "moisture",
    ]);
    expect(builders.getComponentsByCategory("missing")).toEqual([]);

    expect(builders.getComponentOptions()[0]).toEqual({
      value: "water",
      label: "Water",
      description: "H2O absorption bands",
    });
  });

  it("builds default synthesis config and shallow step params compatibly", () => {
    expect(builders.getDefaultSynthesisConfig()).toEqual({
      name: "synthetic_nirs",
      n_samples: 1000,
      random_state: 42,
    });

    const featureDefinition = builders.getStepDefinition("features");
    const componentParam = featureDefinition?.parameters.find((param) => param.name === "components");
    const params = builders.getDefaultStepParams("features");

    expect(params).toMatchObject({
      wavelength_range: [1000, 2500],
      wavelength_step: 2.0,
      complexity: "custom",
    });
    expect(params.components).toBe(componentParam?.default);
    expect(builders.getDefaultStepParams("missing")).toEqual({});
  });
});
