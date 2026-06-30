import { describe, expect, it } from "vitest";
import {
  buildPaletteAvailabilityNode,
  filterPaletteOptions,
  getMatchingPaletteSections,
  getPaletteAvailabilityDisplay,
  getOptionsForPaletteGroup,
  getPaletteGroupDisplayLabel,
  getPaletteOptionAvailability,
  groupPaletteOptionsByCategory,
  isClassifierModel,
  optionMatchesPaletteSearch,
  resolveStepType,
  shouldShowPaletteSubcategories,
  stepTypeOrder,
} from "../StepPaletteData";
import type { PaletteAvailabilityNode } from "../StepPaletteData";
import type {
  StepOption,
  StepType,
} from "../types";

function makeOption(overrides: Partial<StepOption> & Pick<StepOption, "name">): StepOption {
  return {
    description: `${overrides.name} description`,
    defaultParams: {},
    ...overrides,
  };
}

describe("StepPaletteData", () => {
  it("splits virtual model groups while preserving the underlying step type", () => {
    const options = [
      makeOption({ name: "PLSRegression", category: "PLS" }),
      makeOption({ name: "RandomForestClassifier", category: "Ensemble" }),
      makeOption({ name: "TaggedModel", tags: ["classification"] }),
    ];
    const getStepOptions = (type: StepType) => (type === "model" ? options : []);

    expect(resolveStepType("model_regression")).toBe("model");
    expect(resolveStepType("preprocessing")).toBe("preprocessing");
    expect(getOptionsForPaletteGroup("model_regression", getStepOptions)).toEqual([
      { option: options[0], actualType: "model" },
    ]);
    expect(getOptionsForPaletteGroup("model_classification", getStepOptions)).toEqual([
      { option: options[1], actualType: "model" },
      { option: options[2], actualType: "model" },
    ]);
    expect(isClassifierModel(makeOption({ name: "SVC" }))).toBe(true);
    expect(isClassifierModel(makeOption({ name: "Ridge" }))).toBe(false);
  });

  it("builds availability nodes from palette options with registry fallbacks", () => {
    expect(
      buildPaletteAvailabilityNode(
        "preprocessing",
        makeOption({ name: "SavitzkyGolay", functionPath: "nirs4all.preprocessing.nicon" }),
        { id: "registry-savitzky", classPath: "nirs4all.preprocessing.SavitzkyGolay" },
      ),
    ).toEqual({
      id: "registry-savitzky",
      type: "preprocessing",
      name: "SavitzkyGolay",
      classPath: "nirs4all.preprocessing.SavitzkyGolay",
      functionPath: "nirs4all.preprocessing.nicon",
    });

    expect(
      buildPaletteAvailabilityNode(
        "model",
        makeOption({ name: "Ridge", classPath: "custom.Ridge" }),
        { id: "registry-ridge", classPath: "sklearn.linear_model.Ridge" },
      ),
    ).toMatchObject({
      id: "registry-ridge",
      type: "model",
      name: "Ridge",
      classPath: "custom.Ridge",
    });
  });

  it("resolves palette option availability with absent-provider fallback", () => {
    const option = makeOption({ name: "Ridge" });

    expect(
      getPaletteOptionAvailability({
        actualType: "model",
        option,
        availability: null,
        registry: {
          getNodeDefinition: () => {
            throw new Error("registry should not be read without availability");
          },
        },
      }),
    ).toEqual({ available: true });

    const calls: PaletteAvailabilityNode[] = [];
    const availability = {
      getNodeAvailability: (node: PaletteAvailabilityNode) => {
        calls.push(node);
        return { available: false, entry: { error: "missing sklearn" } };
      },
    };

    expect(
      getPaletteOptionAvailability({
        actualType: "model",
        option,
        availability,
        registry: {
          getNodeDefinition: () => ({ id: "ridge", classPath: "sklearn.linear_model.Ridge" }),
        },
      }),
    ).toEqual({ available: false, entry: { error: "missing sklearn" } });
    expect(calls).toEqual([
      {
        id: "ridge",
        type: "model",
        name: "Ridge",
        classPath: "sklearn.linear_model.Ridge",
        functionPath: undefined,
      },
    ]);
  });

  it("derives the palette availability display state", () => {
    expect(
      getPaletteAvailabilityDisplay({
        available: false,
        entry: { error: "entry error" },
        issue: { details: { error: "issue error" } },
      }),
    ).toEqual({ isUnavailable: true, unavailableReason: "entry error" });

    expect(
      getPaletteAvailabilityDisplay({
        available: false,
        issue: { details: { error: "issue error" } },
      }),
    ).toEqual({ isUnavailable: true, unavailableReason: "issue error" });

    expect(getPaletteAvailabilityDisplay({ available: true })).toEqual({
      isUnavailable: false,
      unavailableReason: undefined,
    });
  });

  it("matches search text against name, description, and category", () => {
    const option = makeOption({
      name: "SavitzkyGolay",
      description: "Smoothing and derivatives",
      category: "Derivatives",
    });

    expect(optionMatchesPaletteSearch(option, "golay")).toBe(true);
    expect(optionMatchesPaletteSearch(option, "SMOOTH")).toBe(true);
    expect(optionMatchesPaletteSearch(option, "derivatives")).toBe(true);
    expect(optionMatchesPaletteSearch(option, "missing")).toBe(false);
  });

  it("filters availability only when unavailable operators are hidden and a snapshot exists", () => {
    const available = makeOption({ name: "Available" });
    const unavailable = makeOption({ name: "Unavailable" });
    const paletteOptions = [
      { option: available, actualType: "model" as const },
      { option: unavailable, actualType: "model" as const },
    ];

    expect(
      filterPaletteOptions(paletteOptions, {
        search: "",
        showUnavailableOperators: false,
        hasAvailabilitySnapshot: true,
        getOptionAvailability: (_type, option) => ({ available: option.name !== "Unavailable" }),
      }),
    ).toEqual([{ option: available, actualType: "model" }]);

    expect(
      filterPaletteOptions(paletteOptions, {
        search: "",
        showUnavailableOperators: false,
        hasAvailabilitySnapshot: false,
        getOptionAvailability: () => ({ available: false }),
      }),
    ).toHaveLength(2);
  });

  it("groups by category and keeps the palette subcategory threshold rule", () => {
    const categorized = Array.from({ length: 10 }, (_, index) =>
      makeOption({
        name: `Option${index}`,
        category: index < 5 ? "NIRS" : "sklearn",
      }),
    ).map((option) => ({ option, actualType: "preprocessing" as const }));

    const grouped = groupPaletteOptionsByCategory(categorized);

    expect(Array.from(grouped.keys())).toEqual(["NIRS", "sklearn"]);
    expect(grouped.get("NIRS")).toHaveLength(5);
    expect(
      shouldShowPaletteSubcategories({
        groupedOptions: grouped,
        search: "",
        optionCount: categorized.length,
        threshold: 10,
      }),
    ).toBe(true);
    expect(
      shouldShowPaletteSubcategories({
        groupedOptions: grouped,
        search: "nir",
        optionCount: categorized.length,
        threshold: 10,
      }),
    ).toBe(false);
  });

  it("derives labels and matching section keys", () => {
    expect(
      getPaletteGroupDisplayLabel("model_classification", {
        preprocessing: "Preprocessing",
        y_processing: "Y",
        splitting: "Split",
        model: "Models",
        augmentation: "Aug",
        filter: "Filter",
        flow: "Flow",
        utility: "Utility",
      }),
    ).toBe("Classification Models");

    const matching = getMatchingPaletteSections(stepTypeOrder, (key) =>
      key === "filter" || key === "utility"
        ? [{ option: makeOption({ name: key }), actualType: resolveStepType(key) }]
        : [],
    );

    expect(Array.from(matching)).toEqual(["filter", "utility"]);
  });
});
