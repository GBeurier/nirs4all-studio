import { describe, expect, it } from "vitest";
import {
  buildQuickFinetuneConfig,
  getNumericFinetuneParamNames,
} from "../QuickFinetuneData";

describe("QuickFinetuneData", () => {
  it("filters out non-number parameter values", () => {
    expect(
      getNumericFinetuneParamNames({
        alpha: 0.1,
        kernel: "rbf",
        normalize: false,
        missing: null,
        n_components: 4,
      }),
    ).toEqual(["alpha", "n_components"]);
  });

  it("returns null when no numeric parameter is compatible with the model presets", () => {
    expect(
      buildQuickFinetuneConfig({
        modelName: "SVR",
        params: {
          n_components: 8,
          kernel: "rbf",
          normalize: true,
        },
      }),
    ).toBeNull();
  });

  it("keeps the first two compatible presets and quick finetuning defaults", () => {
    const config = buildQuickFinetuneConfig({
      modelName: "SVR",
      params: {
        C: 1,
        epsilon: 0.1,
        gamma: 0.01,
        kernel: "rbf",
      },
    });

    expect(config).toEqual({
      enabled: true,
      n_trials: 50,
      approach: "grouped",
      eval_mode: "best",
      model_params: [
        {
          name: "C",
          type: "log_float",
          low: 0.01,
          high: 100,
          step: undefined,
          choices: undefined,
        },
        {
          name: "epsilon",
          type: "log_float",
          low: 0.001,
          high: 1,
          step: undefined,
          choices: undefined,
        },
      ],
    });
  });

  it("filters by modelName and available params using real presets", () => {
    const config = buildQuickFinetuneConfig({
      modelName: "PLSRegression",
      params: {
        n_components: 12,
        alpha: 0.2,
        C: 1,
      },
    });

    expect(config?.model_params).toEqual([
      {
        name: "n_components",
        type: "int",
        low: 1,
        high: 30,
        step: 1,
        choices: undefined,
      },
    ]);
  });
});
