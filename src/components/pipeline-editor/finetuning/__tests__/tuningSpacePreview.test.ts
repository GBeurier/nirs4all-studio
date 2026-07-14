import { describe, expect, it } from "vitest";
import type { FinetuneConfig } from "../../types";
import {
  STUDIO_TUNING_SPACE_PREVIEW_FINGERPRINT_KIND,
  buildStudioTuningSpacePreview,
} from "../tuningSpacePreview";

function finetuneConfig(overrides: Partial<FinetuneConfig> = {}): FinetuneConfig {
  return {
    enabled: true,
    n_trials: 50,
    approach: "grouped",
    eval_mode: "best",
    model_params: [
      {
        name: "n_components",
        type: "int",
        low: 2,
        high: 12,
        step: 1,
      },
      {
        name: "alpha",
        type: "log_float",
        low: 1e-4,
        high: 1,
      },
    ],
    ...overrides,
  };
}

describe("buildStudioTuningSpacePreview", () => {
  it("builds a nirs4all-ui validated ordered search-space preview from model params", () => {
    const result = buildStudioTuningSpacePreview(finetuneConfig(), {
      forceParams: {
        n_components: 6,
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.fingerprintKind).toBe(STUDIO_TUNING_SPACE_PREVIEW_FINGERPRINT_KIND);
    expect(result.artifact).not.toBeNull();
    expect(result.preview).not.toBeNull();
    expect(result.artifact?.format).toBe("nirs4all.tuning.ordered_search_space");
    expect(result.artifact?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.artifact?.tuning_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.preview?.schemaId).toBe(
      "https://nirs4all.org/schemas/tuning-ordered-search-space/v1"
    );
    expect(result.preview?.parameterCount).toBe(2);
    expect(result.preview?.forceParamCount).toBe(1);
    expect(result.preview?.parameters.map((parameter) => parameter.path)).toEqual([
      "model.n_components",
      "model.alpha",
    ]);
    expect(result.preview?.parameters[0]).toMatchObject({
      forced: true,
      forcedValue: 6,
      forcedValueLabel: "6",
      spec: {
        type: "int",
        low: 2,
        high: 12,
        step: 1,
      },
      specLabel: '{"type":"int","low":2,"high":12,"step":1}',
    });
    expect(result.preview?.parameters[1].spec).toEqual({
      type: "log_float",
      low: 1e-4,
      high: 1,
      log: true,
    });
  });

  it("includes tunable training params after model params", () => {
    const result = buildStudioTuningSpacePreview(
      finetuneConfig({
        train_params: [
          {
            name: "batch_size",
            type: "categorical",
            choices: [16, 32, 64],
          },
        ],
      }),
      {
        forceParams: {
          "train.batch_size": 32,
        },
      }
    );

    expect(result.issues).toEqual([]);
    expect(result.preview?.parameterCount).toBe(3);
    expect(result.preview?.parameters.map((parameter) => parameter.path)).toEqual([
      "model.n_components",
      "model.alpha",
      "train.batch_size",
    ]);
    expect(result.preview?.parameters[2]).toMatchObject({
      forced: true,
      forcedValue: 32,
      forcedValueLabel: "32",
      spec: [16, 32, 64],
    });
  });

  it("returns no preview when finetuning is disabled", () => {
    const result = buildStudioTuningSpacePreview(
      finetuneConfig({
        enabled: false,
      })
    );

    expect(result.enabled).toBe(false);
    expect(result.artifact).toBeNull();
    expect(result.preview).toBeNull();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "finetune_disabled",
      }),
    ]);
  });

  it("rejects force params that are not part of the current search space", () => {
    const result = buildStudioTuningSpacePreview(finetuneConfig(), {
      forceParams: {
        unknown_param: "invalid",
      },
    });

    expect(result.artifact).toBeNull();
    expect(result.preview).toBeNull();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "invalid_force_param_path",
        path: "unknown_param",
      }),
    ]);
  });

  it("supports a custom native path prefix", () => {
    const result = buildStudioTuningSpacePreview(finetuneConfig(), {
      parameterPrefix: ["pipeline", "model"],
      forceParams: {
        "pipeline.model.alpha": 0.1,
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.preview?.parameters.map((parameter) => parameter.path)).toEqual([
      "pipeline.model.n_components",
      "pipeline.model.alpha",
    ]);
    expect(result.preview?.parameters[1]).toMatchObject({
      forced: true,
      forcedValue: 0.1,
    });
  });
});
