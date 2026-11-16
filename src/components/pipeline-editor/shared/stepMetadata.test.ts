import { describe, expect, it } from "vitest";

import { allNodes } from "@/data/nodes";
import { createStepMetadataCatalog, type StepMetadataRegistry } from "./stepMetadata";

// The static model options include both deep-learning entries (nicon, CNN1D,
// MLP, LSTM, Transformer — isDeepLearning: true) and pure-sklearn ones
// (RandomForestRegressor, …). The "lite" build hides the former via the
// hideDeepLearning catalog option (see useDeepLearningAvailable).
describe("stepMetadata getStepOptions — hideDeepLearning", () => {
  it("includes deep-learning model options by default", () => {
    const catalog = createStepMetadataCatalog(undefined);
    const names = catalog.getStepOptions("model").map((o) => o.name);

    expect(names).toContain("nicon");
    expect(names).toContain("RandomForestRegressor");
  });

  it("drops deep-learning options when hideDeepLearning is set on the catalog", () => {
    const catalog = createStepMetadataCatalog(undefined, { hideDeepLearning: true });
    const options = catalog.getStepOptions("model");

    expect(options.some((o) => o.isDeepLearning === true)).toBe(false);
    expect(options.map((o) => o.name)).not.toContain("nicon");
    // Pure-sklearn models stay available in the lite build.
    expect(options.map((o) => o.name)).toContain("RandomForestRegressor");
  });

  it("honors a per-call hideDeepLearning override", () => {
    const catalog = createStepMetadataCatalog(undefined, { hideDeepLearning: false });
    const hidden = catalog.getStepOptions("model", { hideDeepLearning: true });

    expect(hidden.some((o) => o.isDeepLearning === true)).toBe(false);
  });
});

// The curated registry: PyTorch models declare `requires: ["torch"]`, the
// tabular foundation models their own package, the scikit-learn MLP none.
const curatedRegistry: StepMetadataRegistry = {
  getNodesByType: (type) => allNodes.filter((node) => node.type === type) as never,
  getNodeDefinition: (type, name) => allNodes.find((node) => node.type === type && node.name === name) as never,
  getDefaultParams: () => ({}),
  getSweepableParams: () => [],
};
const PYTORCH_MODELS = ["NICoN", "NICoNClassifier", "CNN1D", "CNN1DClassifier", "Transformer", "TransformerClassifier"];

describe("stepMetadata getStepOptions — PyTorch models Studio can install", () => {
  const modelNames = (options: Parameters<typeof createStepMetadataCatalog>[1]) =>
    createStepMetadataCatalog(curatedRegistry, options).getStepOptions("model").map((option) => option.name);

  it("keeps PyTorch models listed while the other deep-learning models stay hidden", () => {
    const names = modelNames({ hideDeepLearning: true, pyTorchInstallable: true });

    expect(names).toEqual(expect.arrayContaining(PYTORCH_MODELS));
    // Not attributable to PyTorch from the registry: another package, or a legacy entry.
    for (const hidden of ["TabPFN", "TabPFNClassifier", "TabICLRegressor", "TabICLClassifier", "LSTM"]) {
      expect(names).not.toContain(hidden);
    }
    expect(names).toContain("PLSRegression");
  });

  it("hides every deep-learning model when Studio cannot install PyTorch", () => {
    const names = modelNames({ hideDeepLearning: true, pyTorchInstallable: false });

    for (const hidden of [...PYTORCH_MODELS, "TabPFN", "LSTM"]) {
      expect(names).not.toContain(hidden);
    }
  });

  it.each([true, false])("lists the scikit-learn neural networks without any framework (PyTorch installable: %s)", (pyTorchInstallable) => {
    const names = modelNames({ hideDeepLearning: true, pyTorchInstallable });

    // MLPRegressor is flagged deep learning but declares no package; MLPClassifier is not flagged.
    expect(names).toEqual(expect.arrayContaining(["MLPRegressor", "MLPClassifier"]));
  });

  it("exempts exactly the deep-learning registry nodes that declare no package", () => {
    const frameworkFree = allNodes
      .filter((node) => node.type === "model" && node.isDeepLearning === true && !node.requires?.length)
      .map((node) => node.name);
    const listed = createStepMetadataCatalog(curatedRegistry, { hideDeepLearning: true })
      .getStepOptions("model")
      .filter((option) => option.isDeepLearning === true)
      .map((option) => option.name);

    expect(frameworkFree).toEqual(["MLPRegressor"]);
    expect(listed).toEqual(frameworkFree);
  });

  it("lists every deep-learning model when a framework is installed", () => {
    const names = modelNames({ hideDeepLearning: false, pyTorchInstallable: false });

    expect(names).toEqual(expect.arrayContaining([...PYTORCH_MODELS, "TabPFN", "MLPRegressor"]));
  });

  it("carries the declared packages on the option", () => {
    const catalog = createStepMetadataCatalog(curatedRegistry);

    expect(catalog.getStepOption("model", "NICoN")?.requires).toEqual(["torch"]);
    expect(catalog.getStepOption("model", "PLSRegression")?.requires).toBeUndefined();
  });
});
