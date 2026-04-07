import { describe, expect, it } from "vitest";

import {
  createNodeRegistry,
  createEmptyRegistry,
  NodeRegistry,
} from "@/data/nodes/NodeRegistry";
import { allNodes } from "@/data/nodes/definitions";

describe("NodeRegistry - Initialization", () => {
  const registry = createNodeRegistry({ validateOnLoad: true, warnOnDuplicates: true });

  it("creates a valid registry instance", () => {
    expect(registry).toBeInstanceOf(NodeRegistry);
    expect(registry.isValid()).toBe(true);
  });

  it("loads all curated nodes", () => {
    expect(registry.size).toBe(allNodes.length);
    expect(registry.size).toBeGreaterThanOrEqual(320);
  });

  it("creates an empty registry", () => {
    const empty = createEmptyRegistry();
    expect(empty.size).toBe(0);
    expect(empty.isValid()).toBe(true);
  });

  it("has no validation errors", () => {
    const result = registry.getValidationResult();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("NodeRegistry - Lookup by ID", () => {
  const registry = createNodeRegistry();

  it("finds common preprocessing nodes", () => {
    expect(registry.getById("preprocessing.snv")).toBeDefined();
    expect(registry.getById("preprocessing.pca")).toBeDefined();
    expect(registry.getById("preprocessing.savitzky_golay")).toBeDefined();
  });

  it("finds common model nodes", () => {
    expect(registry.getById("model.pls_regression")).toBeDefined();
    expect(registry.getById("model.svr")).toBeDefined();
    expect(registry.getById("model.random_forest_regressor")).toBeDefined();
  });

  it("returns undefined for missing IDs", () => {
    expect(registry.getById("nonexistent.node")).toBeUndefined();
  });

  it("has() returns correct boolean", () => {
    expect(registry.has("preprocessing.snv")).toBe(true);
    expect(registry.has("nonexistent.node")).toBe(false);
  });
});

describe("NodeRegistry - Lookup by classPath", () => {
  const registry = createNodeRegistry();

  it("resolves sklearn classPaths", () => {
    const pca = registry.getByClassPath("sklearn.decomposition.PCA");
    expect(pca).toBeDefined();
    expect(pca!.id).toBe("preprocessing.pca");
  });

  it("resolves nirs4all classPaths", () => {
    const snv = registry.getByClassPath(
      "nirs4all.operators.transforms.StandardNormalVariate"
    );
    expect(snv).toBeDefined();
    expect(snv!.id).toBe("preprocessing.snv");
  });

  it("resolves legacy classPaths", () => {
    // PCA has legacy path sklearn.decomposition._pca.PCA
    const pca = registry.getByClassPath("sklearn.decomposition._pca.PCA");
    expect(pca).toBeDefined();
    expect(pca!.id).toBe("preprocessing.pca");
  });

  it("hasClassPath() returns correct boolean", () => {
    expect(registry.hasClassPath("sklearn.decomposition.PCA")).toBe(true);
    expect(registry.hasClassPath("nonexistent.Class")).toBe(false);
  });
});

describe("NodeRegistry - Lookup by name", () => {
  const registry = createNodeRegistry();

  it("finds nodes by case-insensitive name", () => {
    expect(registry.getByName("PCA")).toBeDefined();
    expect(registry.getByName("pca")).toBeDefined();
    expect(registry.getByName("PLSRegression")).toBeDefined();
  });
});

describe("NodeRegistry - Type queries", () => {
  const registry = createNodeRegistry();

  it("returns nodes by type", () => {
    const preprocessing = registry.getByType("preprocessing");
    expect(preprocessing.length).toBeGreaterThan(100);

    const models = registry.getByType("model");
    expect(models.length).toBeGreaterThan(100);

    const splitting = registry.getByType("splitting");
    expect(splitting.length).toBeGreaterThan(15);
  });

  it("returns all registered types", () => {
    const types = registry.getTypes();
    expect(types).toContain("preprocessing");
    expect(types).toContain("model");
    expect(types).toContain("splitting");
    expect(types).toContain("augmentation");
  });

  it("getByTypeAndName finds specific node", () => {
    const pls = registry.getByTypeAndName("model", "PLSRegression");
    expect(pls).toBeDefined();
    expect(pls!.type).toBe("model");
  });
});

describe("NodeRegistry - Search", () => {
  const registry = createNodeRegistry();

  it("finds nodes by name substring", () => {
    const results = registry.search("pls");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((n) => n.id === "model.pls_regression")).toBe(true);
  });

  it("finds nodes by description", () => {
    const results = registry.search("principal component");
    expect(results.some((n) => n.id === "preprocessing.pca")).toBe(true);
  });

  it("finds nodes by tag", () => {
    const results = registry.search("normalization");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns all nodes for empty query", () => {
    const results = registry.search("");
    expect(results.length).toBe(registry.size);
  });
});

describe("NodeRegistry - Category and source", () => {
  const registry = createNodeRegistry();

  it("filters by source", () => {
    const sklearn = registry.getBySource("sklearn");
    expect(sklearn.length).toBeGreaterThan(10);
    expect(sklearn.every((n) => n.source === "sklearn")).toBe(true);

    const nirs = registry.getBySource("nirs4all");
    expect(nirs.length).toBeGreaterThan(10);
  });

  it("filters by tags", () => {
    const tagged = registry.getByTags(["pca"]);
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.some((n) => n.id === "preprocessing.pca")).toBe(true);
  });
});

describe("NodeRegistry - Tier filtering", () => {
  const registry = createNodeRegistry();

  it("core tier returns only core nodes", () => {
    const core = registry.getNodesByTier("core");
    expect(core.length).toBeGreaterThan(0);
    expect(core.every((n) => n.tier === "core")).toBe(true);
  });

  it("standard tier excludes advanced", () => {
    const standard = registry.getNodesByTier("standard");
    expect(standard.every((n) => n.tier !== "advanced")).toBe(true);
    expect(standard.length).toBeGreaterThan(registry.getNodesByTier("core").length);
  });

  it("all tier returns everything", () => {
    const all = registry.getNodesByTier("all");
    expect(all.length).toBe(registry.size);
  });

  it("getByTypeAndTier combines both filters", () => {
    const coreModels = registry.getByTypeAndTier("model", "core");
    expect(coreModels.every((n) => n.type === "model" && n.tier === "core")).toBe(
      true
    );
  });
});

describe("NodeRegistry - Parameter utilities", () => {
  const registry = createNodeRegistry();

  it("getDefaultParams returns correct defaults", () => {
    const defaults = registry.getDefaultParams("preprocessing.pca");
    expect(defaults).toHaveProperty("n_components");
    expect(defaults.n_components).toBe(10);
  });

  it("getParameterDef returns parameter metadata", () => {
    const param = registry.getParameterDef(
      "preprocessing.pca",
      "n_components"
    );
    expect(param).toBeDefined();
    expect(param!.type).toBe("int");
    expect(param!.min).toBe(1);
  });

  it("getSweepableParams returns sweepable parameters", () => {
    const sweepable = registry.getSweepableParams("preprocessing.pca");
    expect(sweepable.length).toBeGreaterThan(0);
    expect(sweepable.every((p) => p.sweepable === true)).toBe(true);
  });

  it("getFinetunableParams returns finetunable parameters", () => {
    const finetunable = registry.getFinetunableParams("preprocessing.pca");
    expect(finetunable.length).toBeGreaterThan(0);
    expect(finetunable.every((p) => p.finetunable === true)).toBe(true);
  });

  it("returns empty for missing node", () => {
    expect(registry.getDefaultParams("nonexistent.node")).toEqual({});
    expect(registry.getSweepableParams("nonexistent.node")).toEqual([]);
    expect(registry.getFinetunableParams("nonexistent.node")).toEqual([]);
  });
});

describe("NodeRegistry - ClassPath maps", () => {
  const registry = createNodeRegistry();

  it("builds classPath to name map", () => {
    const map = registry.buildClassPathToNameMap();
    expect(map.size).toBeGreaterThan(50);
    expect(map.get("sklearn.decomposition.PCA")).toBe("PCA");
  });

  it("builds name to classPath map", () => {
    const map = registry.buildNameToClassPathMap();
    expect(map.size).toBeGreaterThan(50);
    expect(map.get("PCA")).toBe("sklearn.decomposition.PCA");
  });

  it("classPath to name map includes legacy paths", () => {
    const map = registry.buildClassPathToNameMap();
    expect(map.has("sklearn.decomposition._pca.PCA")).toBe(true);
  });
});

describe("NodeRegistry - Special node queries", () => {
  const registry = createNodeRegistry();

  it("getDeepLearningModels returns DL nodes", () => {
    const dl = registry.getDeepLearningModels();
    expect(dl.length).toBeGreaterThan(0);
    expect(dl.every((n) => n.isDeepLearning === true)).toBe(true);
  });

  it("getContainerNodes returns containers", () => {
    const containers = registry.getContainerNodes();
    expect(containers.length).toBeGreaterThan(0);
    expect(containers.every((n) => n.isContainer === true)).toBe(true);
  });

  it("getGeneratorNodes returns generators", () => {
    const generators = registry.getGeneratorNodes();
    expect(generators.length).toBeGreaterThan(0);
    expect(generators.every((n) => n.isGenerator === true)).toBe(true);
  });
});

describe("NodeRegistry - Stats", () => {
  const registry = createNodeRegistry();

  it("reports accurate statistics", () => {
    const stats = registry.getStats();
    expect(stats.totalNodes).toBe(registry.size);
    expect(stats.classPathCount).toBeGreaterThanOrEqual(stats.totalNodes);
    expect(stats.nodesByType).toHaveProperty("preprocessing");
    expect(stats.nodesByType).toHaveProperty("model");
  });
});
