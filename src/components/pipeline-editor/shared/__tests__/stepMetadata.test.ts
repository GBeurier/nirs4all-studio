import { describe, expect, it } from "vitest";
import type { ParameterDefinition } from "@/data/nodes";
import type { StepType } from "../../types";
import {
  createStepMetadataCatalog,
  type StepMetadataRegistry,
} from "../stepMetadata";

interface RegistryNodeFixture {
  id: string;
  name: string;
  type: StepType;
  description: string;
  category?: string;
  isDeepLearning?: boolean;
  tier?: "core" | "standard" | "advanced";
  parameters?: ParameterDefinition[];
}

function createRegistry(
  nodes: RegistryNodeFixture[],
  defaultsByName: Record<string, Record<string, unknown>> = {},
  sweepableByName: Record<string, ParameterDefinition[]> = {},
): StepMetadataRegistry {
  return {
    isJsonRegistry: true,
    getNodesByType: (type) => nodes.filter((node) => node.type === type) as never,
    getNodeDefinition: (type, name) =>
      nodes.find((node) => node.type === type && node.name === name) as never,
    getDefaultParams: (_type, name) => defaultsByName[name] ?? {},
    getSweepableParams: (_type, name) => sweepableByName[name] ?? [],
  };
}

describe("createStepMetadataCatalog", () => {
  it("prefers registry entries, quarantines stale aliases, and appends legacy-only fallback entries", () => {
    const registry = createRegistry(
      [
        {
          id: "model.pls",
          name: "PLSRegression",
          type: "model",
          description: "Registry-backed PLS",
          category: "Registry Models",
        },
        {
          id: "model.registry-only",
          name: "RegistryOnlyModel",
          type: "model",
          description: "Registry-only model",
          category: "Deep Learning",
          isDeepLearning: true,
        },
        {
          id: "model.nicon",
          name: "NICoN",
          type: "model",
          description: "Canonical NICoN",
          category: "Deep Learning",
          isDeepLearning: true,
        },
        {
          id: "model.mlp",
          name: "MLPRegressor",
          type: "model",
          description: "Canonical MLP regressor",
          category: "Deep Learning",
          isDeepLearning: true,
        },
      ],
      {
        PLSRegression: { n_components: 12, max_iter: 600 },
        RegistryOnlyModel: { depth: 3, activation: "relu" },
      },
    );

    const catalog = createStepMetadataCatalog(registry);
    const modelOptions = catalog.getStepOptions("model");

    expect(modelOptions.filter((option) => option.name === "PLSRegression")).toHaveLength(1);
    expect(modelOptions.find((option) => option.name === "PLSRegression")?.description).toBe(
      "Registry-backed PLS",
    );
    expect(modelOptions.some((option) => option.name === "RegistryOnlyModel")).toBe(true);
    expect(modelOptions.some((option) => option.name === "NICoN")).toBe(true);
    expect(modelOptions.some((option) => option.name === "MLPRegressor")).toBe(true);
    expect(modelOptions.some((option) => option.name === "nicon")).toBe(false);
    expect(modelOptions.some((option) => option.name === "MLP")).toBe(false);
    expect(modelOptions.some((option) => option.name === "RandomForestRegressor")).toBe(true);
  });

  it("filters step options by tier at the seam for core, standard, and all", () => {
    const registry = createRegistry([
      {
        id: "model.core-only",
        name: "CoreOnlyModel",
        type: "model",
        description: "Core tier model",
        tier: "core",
      },
      {
        id: "model.standard-only",
        name: "StandardOnlyModel",
        type: "model",
        description: "Standard tier model",
        tier: "standard",
      },
      {
        id: "model.advanced-only",
        name: "AdvancedOnlyModel",
        type: "model",
        description: "Advanced tier model",
        tier: "advanced",
      },
    ]);

    const catalog = createStepMetadataCatalog(registry, { tierLevel: "standard" });
    const coreOptions = catalog.getStepOptions("model", { tierLevel: "core" });
    const standardOptions = catalog.getStepOptions("model");
    const allOptions = catalog.getStepOptions("model", { tierLevel: "all" });

    expect(coreOptions.some((option) => option.name === "CoreOnlyModel")).toBe(true);
    expect(coreOptions.some((option) => option.name === "StandardOnlyModel")).toBe(false);
    expect(coreOptions.some((option) => option.name === "AdvancedOnlyModel")).toBe(false);

    expect(standardOptions.some((option) => option.name === "CoreOnlyModel")).toBe(true);
    expect(standardOptions.some((option) => option.name === "StandardOnlyModel")).toBe(true);
    expect(standardOptions.some((option) => option.name === "AdvancedOnlyModel")).toBe(false);

    expect(allOptions.some((option) => option.name === "CoreOnlyModel")).toBe(true);
    expect(allOptions.some((option) => option.name === "StandardOnlyModel")).toBe(true);
    expect(allOptions.some((option) => option.name === "AdvancedOnlyModel")).toBe(true);
  });

  it("keeps legacy-only uncovered nodes available in registry mode", () => {
    const registry = createRegistry([
      {
        id: "model.pls",
        name: "PLSRegression",
        type: "model",
        description: "Registry-backed PLS",
      },
    ]);

    const catalog = createStepMetadataCatalog(registry);
    const modelOptions = catalog.getStepOptions("model");

    expect(modelOptions.some((option) => option.name === "LSTM")).toBe(true);
  });

  it("returns explicit legacy fallback metadata when the registry has no matching node", () => {
    const catalog = createStepMetadataCatalog(createRegistry([]));
    const metadata = catalog.getStepMetadata("model", "PLSRegression");

    expect(metadata.source).toBe("legacy");
    expect(metadata.isRegistryBacked).toBe(false);
    expect(metadata.option?.description).toBe("Partial Least Squares Regression");
    expect(metadata.defaultParams).toEqual({ n_components: 10, max_iter: 500 });
    expect(metadata.sweepable).toEqual([]);
  });

  it("returns registry-backed defaults and sweepable params for registry-only nodes", () => {
    const depthParam: ParameterDefinition = {
      name: "depth",
      type: "int",
      default: 3,
      sweepable: true,
    };
    const activationParam: ParameterDefinition = {
      name: "activation",
      type: "select",
      default: "relu",
      options: [{ value: "relu", label: "ReLU" }],
    };

    const registry = createRegistry(
      [
        {
          id: "model.registry-only",
          name: "RegistryOnlyModel",
          type: "model",
          description: "Registry-only model",
          category: "Deep Learning",
          isDeepLearning: true,
          parameters: [depthParam, activationParam],
        },
      ],
      {
        RegistryOnlyModel: { depth: 3, activation: "relu" },
      },
      {
        RegistryOnlyModel: [depthParam],
      },
    );

    const metadata = createStepMetadataCatalog(registry).getStepMetadata("model", "RegistryOnlyModel");

    expect(metadata.source).toBe("registry");
    expect(metadata.isRegistryBacked).toBe(true);
    expect(metadata.option?.isDeepLearning).toBe(true);
    expect(metadata.defaultParams).toEqual({ depth: 3, activation: "relu" });
    expect(metadata.sweepable).toEqual([depthParam]);
  });
});