import { describe, expect, it } from "vitest";

import { createStepMetadataCatalog } from "./stepMetadata";

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
