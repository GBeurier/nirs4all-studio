import { describe, expect, it } from "vitest";

import type { PipelineStep } from "../types";
import { stepOptions } from "../types";
import { getRenderableStepParams } from "../renderableParams";

describe("getRenderableStepParams", () => {
  it("shows default model parameters for imported swept presets", () => {
    const plsOption = stepOptions.model.find((option) => option.name === "PLSRegression");
    const step = {
      id: "pls-step",
      type: "model",
      name: "PLSRegression",
      params: {},
      paramSweeps: {
        n_components: {
          type: "range",
          from: 2,
          to: 30,
          step: 4,
        },
      },
    } as PipelineStep;

    expect(getRenderableStepParams(step, plsOption)).toEqual({
      n_components: 10,
      max_iter: 500,
    });
  });

  it("falls back to the sweep start when no option defaults are available", () => {
    const step = {
      id: "custom-step",
      type: "model",
      name: "CustomModel",
      params: {},
      paramSweeps: {
        alpha: {
          type: "log_range",
          from: 0.001,
          to: 1,
          count: 5,
        },
      },
    } as PipelineStep;

    expect(getRenderableStepParams(step)).toEqual({
      alpha: 0.001,
    });
  });

  it("does not alter non-swept steps", () => {
    const params = { alpha: 1 };
    const step = {
      id: "ridge-step",
      type: "model",
      name: "Ridge",
      params,
    } as PipelineStep;

    expect(getRenderableStepParams(step)).toBe(params);
  });
});
