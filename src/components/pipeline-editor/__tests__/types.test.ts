import { describe, expect, it } from "vitest";

import { createStepFromOption } from "../types";
import type { StepOption } from "../types";

describe("createStepFromOption", () => {
  it("preserves model classPath metadata from the selected option", () => {
    const option: StepOption = {
      name: "XGBoostClassifier",
      description: "XGBoost classifier",
      classPath: "xgboost.XGBClassifier",
      defaultParams: { n_estimators: 100, max_depth: 6 },
    };

    const step = createStepFromOption("model", option);

    expect(step.name).toBe("XGBoostClassifier");
    expect(step.classPath).toBe("xgboost.XGBClassifier");
    expect(step.params).toEqual({ n_estimators: 100, max_depth: 6 });
  });

  it("preserves function model metadata from the selected option", () => {
    const option: StepOption = {
      name: "nicon",
      description: "Native function model",
      functionPath: "nirs4all.operators.models.pytorch.nicon.nicon",
      framework: "pytorch",
      defaultParams: {},
    };

    const step = createStepFromOption("model", option);

    expect(step.functionPath).toBe("nirs4all.operators.models.pytorch.nicon.nicon");
    expect(step.framework).toBe("pytorch");
  });
});
