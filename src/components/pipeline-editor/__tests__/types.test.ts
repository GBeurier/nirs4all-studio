import { describe, expect, it } from "vitest";

import {
  createStepFromOption as createStepFromOptionFromTypes,
  getStepColor as getStepColorFromTypes,
  stepColors as stepColorsFromTypes,
  stepSubTypeColors as stepSubTypeColorsFromTypes,
} from "../types";
import type { PipelineStep, StepOption } from "../types";
import { createStepFromOption } from "../stepFactory";
import {
  getStepColor,
  stepColors,
  stepSubTypeColors,
} from "../stepPresentation";

describe("createStepFromOption", () => {
  it("keeps legacy types exports bound to the step factory", () => {
    expect(createStepFromOptionFromTypes).toBe(createStepFromOption);
  });

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

describe("step presentation", () => {
  it("keeps legacy types exports bound to the step presentation adapter", () => {
    expect(getStepColorFromTypes).toBe(getStepColor);
    expect(stepColorsFromTypes).toBe(stepColors);
    expect(stepSubTypeColorsFromTypes).toBe(stepSubTypeColors);
  });

  it("uses subType colors before falling back to type colors", () => {
    const branchStep = {
      id: "branch",
      type: "flow",
      subType: "branch",
      name: "ParallelBranch",
      params: {},
    } as PipelineStep;
    const modelStep = {
      id: "model",
      type: "model",
      name: "Ridge",
      params: {},
    } as PipelineStep;

    expect(getStepColor(branchStep)).toBe(stepSubTypeColors.branch);
    expect(getStepColor(modelStep)).toBe(stepColors.model);
  });
});
