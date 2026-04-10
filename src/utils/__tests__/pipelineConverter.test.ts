/**
 * Pipeline Round-Trip Tests
 * =========================
 *
 * Tests for validating that nirs4all pipelines can be loaded and exported
 * with round-trip integrity.
 *
 * Run with: npx vitest run src/utils/__tests__/pipelineConverter.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  importFromNirs4all,
  exportToNirs4all,
  validateRoundTrip,
  type Nirs4allPipeline,
  type Nirs4allStep,
} from "../pipelineConverter";

// Sample canonical pipelines as returned by nirs4all
const SAMPLE_BASIC_REGRESSION: Nirs4allPipeline = {
  name: "01_basic_regression",
  description: "Basic regression pipeline",
  pipeline: [
    {
      class: "sklearn.preprocessing._data.MinMaxScaler",
      params: { feature_range: [0, 1] },
    },
    {
      y_processing: {
        class: "sklearn.preprocessing._data.StandardScaler",
      },
    },
    {
      class: "sklearn.model_selection._split.KFold",
      params: { n_splits: 3, shuffle: true, random_state: 42 },
    },
    {
      model: {
        class: "sklearn.cross_decomposition._pls.PLSRegression",
        params: { n_components: 10 },
      },
      name: "PLS-10-Baseline",
    },
  ],
};

const SAMPLE_BRANCHING: Nirs4allPipeline = {
  name: "04_branching_basic",
  description: "Branching pipeline",
  pipeline: [
    {
      class: "sklearn.preprocessing._data.MinMaxScaler",
    },
    {
      class: "sklearn.model_selection._split.KFold",
      params: { n_splits: 3 },
    },
    {
      branch: {
        snv_branch: [
          { class: "nirs4all.operators.transforms.scalers.StandardNormalVariate" },
          { model: { class: "sklearn.cross_decomposition._pls.PLSRegression", params: { n_components: 10 } }, name: "SNV-PLS" },
        ],
        msc_branch: [
          { class: "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection" },
          { model: { class: "sklearn.cross_decomposition._pls.PLSRegression", params: { n_components: 10 } }, name: "MSC-PLS" },
        ],
      },
    },
  ],
};

const SAMPLE_STACKING: Nirs4allPipeline = {
  name: "05_stacking_merge",
  description: "Stacking with MetaModel",
  pipeline: [
    { class: "sklearn.preprocessing._data.MinMaxScaler" },
    { class: "sklearn.model_selection._split.KFold", params: { n_splits: 5 } },
    {
      branch: {
        pls_branch: [
          { class: "nirs4all.operators.transforms.scalers.StandardNormalVariate" },
          { model: { class: "sklearn.cross_decomposition._pls.PLSRegression", params: { n_components: 5 } }, name: "PLS-5" },
        ],
        rf_branch: [
          { class: "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection" },
          { model: { class: "sklearn.ensemble._forest.RandomForestRegressor", params: { n_estimators: 50 } }, name: "RF" },
        ],
      },
    },
    {
      merge: {
        predictions: [
          { branch: 0, select: "best", metric: "rmse" },
          { branch: 1, select: "all" },
        ],
        features: [0],
        output_as: "features",
      },
    },
    {
      model: {
        class: "nirs4all.operators.models.meta.MetaModel",
        params: {
          model: {
            class: "sklearn.linear_model._ridge.Ridge",
            params: { alpha: 0.5 },
          },
          source_models: "all",
        },
      },
      name: "Meta-Ridge",
    },
  ],
};

const SAMPLE_SAVED_CHAIN_STEPS: Nirs4allStep[] = [
  {
    class: "StandardNormalVariate",
  },
  {
    class: "KennardStoneSplitter",
    params: { test_size: 0.2, metric: "euclidean" },
  },
  {
    model: {
      class: "PLSRegression",
      params: { n_components: 8 },
    },
  },
];

describe("pipelineConverter", () => {
  describe("importFromNirs4all", () => {
    it("should import basic regression pipeline", () => {
      const steps = importFromNirs4all(SAMPLE_BASIC_REGRESSION);

      expect(steps).toHaveLength(4);
      expect(steps[0].name).toBe("MinMaxScaler");
      expect(steps[0].type).toBe("preprocessing");
      expect(steps[1].name).toBe("StandardScaler");
      expect(steps[1].type).toBe("y_processing");
      expect(steps[2].name).toBe("KFold");
      expect(steps[2].type).toBe("splitting");
      expect(steps[3].name).toBe("PLSRegression");
      expect(steps[3].type).toBe("model");
      expect(steps[3].customName).toBe("PLS-10-Baseline");
    });

    it("should import branching pipeline", () => {
      const steps = importFromNirs4all(SAMPLE_BRANCHING);

      expect(steps).toHaveLength(3);

      const branchStep = steps[2];
      expect(branchStep.type).toBe("flow");
      expect(branchStep.subType).toBe("branch");
      expect(branchStep.branches).toHaveLength(2);
      expect(branchStep.branchMetadata?.[0].name).toBe("snv_branch");
      expect(branchStep.branchMetadata?.[1].name).toBe("msc_branch");
    });

    it("should import stacking pipeline with merge", () => {
      const steps = importFromNirs4all(SAMPLE_STACKING);

      expect(steps).toHaveLength(5);

      const branchStep = steps[2];
      expect(branchStep.type).toBe("flow");
      expect(branchStep.subType).toBe("branch");

      const mergeStep = steps[3];
      expect(mergeStep.type).toBe("flow");
      expect(mergeStep.subType).toBe("merge");

      const metaModelStep = steps[4];
      expect(metaModelStep.type).toBe("model");
      expect(metaModelStep.name).toBe("MetaModel");
    });

    it("should handle array-only pipeline", () => {
      const steps = importFromNirs4all(SAMPLE_BASIC_REGRESSION.pipeline);
      expect(steps).toHaveLength(4);
    });

    it("should resolve saved chain short class names to editor nodes", () => {
      const steps = importFromNirs4all(SAMPLE_SAVED_CHAIN_STEPS);

      expect(steps).toHaveLength(3);
      expect(steps[0].name).toBe("SNV");
      expect(steps[0].type).toBe("preprocessing");
      expect(steps[0].classPath).toBe("nirs4all.operators.transforms.StandardNormalVariate");

      expect(steps[1].name).toBe("KennardStone");
      expect(steps[1].type).toBe("splitting");
      expect(steps[1].classPath).toBe("nirs4all.operators.splitters.KennardStoneSplitter");

      expect(steps[2].name).toBe("PLSRegression");
      expect(steps[2].type).toBe("model");
      expect(steps[2].classPath).toBe("sklearn.cross_decomposition.PLSRegression");
    });

    it("should resolve legacy full import paths to editor aliases", () => {
      const steps = importFromNirs4all([
        {
          class: "nirs4all.operators.transforms.scalers.StandardNormalVariate",
        },
        {
          class: "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
          params: { test_size: 0.2 },
        },
      ]);

      expect(steps[0].name).toBe("SNV");
      expect(steps[0].type).toBe("preprocessing");
      expect(steps[1].name).toBe("KennardStone");
      expect(steps[1].type).toBe("splitting");
    });
  });

  describe("exportToNirs4all", () => {
    it("should export basic pipeline to nirs4all format", () => {
      const editorSteps = importFromNirs4all(SAMPLE_BASIC_REGRESSION);
      const exported = exportToNirs4all(editorSteps) as Nirs4allStep[];

      expect(exported).toHaveLength(4);

      // First step should have class and params
      const firstStep = exported[0] as { class: string; params: Record<string, unknown> };
      expect(firstStep.class).toContain("MinMaxScaler");
    });

    it("should preserve model names", () => {
      const editorSteps = importFromNirs4all(SAMPLE_BASIC_REGRESSION);
      const exported = exportToNirs4all(editorSteps) as Nirs4allStep[];

      const modelStep = exported[3] as { model: unknown; name?: string };
      expect(modelStep.name).toBe("PLS-10-Baseline");
    });

    it("should preserve branch structure", () => {
      const editorSteps = importFromNirs4all(SAMPLE_BRANCHING);
      const exported = exportToNirs4all(editorSteps) as Nirs4allStep[];

      const branchStep = exported[2] as { branch: unknown };
      expect(branchStep.branch).toBeDefined();
    });
  });

  describe("round-trip integrity", () => {
    it("should preserve step count through round-trip", () => {
      const original = SAMPLE_BASIC_REGRESSION.pipeline;
      const editorSteps = importFromNirs4all({ pipeline: original });
      const exported = exportToNirs4all(editorSteps) as Nirs4allStep[];

      expect(exported.length).toBe(original.length);
    });

    it("should preserve branching structure through round-trip", () => {
      const original = SAMPLE_BRANCHING.pipeline;
      const editorSteps = importFromNirs4all({ pipeline: original });
      const exported = exportToNirs4all(editorSteps) as Nirs4allStep[];

      expect(exported.length).toBe(original.length);

      const origBranch = original[2] as { branch: Record<string, unknown[]> };
      const expBranch = exported[2] as { branch: Record<string, unknown[]> };

      expect(Object.keys(expBranch.branch || {}).length).toBe(Object.keys(origBranch.branch).length);
    });

    it("should preserve merge config through round-trip", () => {
      const original = SAMPLE_STACKING.pipeline;
      const editorSteps = importFromNirs4all({ pipeline: original });
      const exported = exportToNirs4all(editorSteps) as Nirs4allStep[];

      const mergeStep = exported[3] as { merge: unknown };
      expect(mergeStep.merge).toBeDefined();
    });
  });

  describe("validateRoundTrip", () => {
    it("should validate basic pipeline round-trip", () => {
      const result = validateRoundTrip(SAMPLE_BASIC_REGRESSION);

      expect(result.valid).toBe(true);
      expect(result.stepCountMatch).toBe(true);
    });

    it("should validate branching pipeline round-trip", () => {
      const result = validateRoundTrip(SAMPLE_BRANCHING);

      expect(result.valid).toBe(true);
      expect(result.stepCountMatch).toBe(true);
    });
  });

  describe("class path handling", () => {
    it("should handle internal sklearn paths", () => {
      const steps = importFromNirs4all({
        pipeline: [
          { class: "sklearn.preprocessing._data.MinMaxScaler" },
          { class: "sklearn.decomposition._pca.PCA", params: { n_components: 10 } },
        ],
      });

      expect(steps[0].name).toBe("MinMaxScaler");
      expect(steps[1].name).toBe("PCA");
    });

    it("should handle nirs4all operator paths", () => {
      const steps = importFromNirs4all({
        pipeline: [
          { class: "nirs4all.operators.transforms.scalers.StandardNormalVariate" },
          { class: "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection" },
        ],
      });

      expect(steps[0].name).toBe("SNV");
      expect(steps[1].name).toBe("MSC");
    });

    it("should export with public sklearn paths", () => {
      const editorSteps = importFromNirs4all({
        pipeline: [
          { class: "sklearn.preprocessing._data.MinMaxScaler" },
        ],
      });

      const exported = exportToNirs4all(editorSteps) as Nirs4allStep[];
      const step = exported[0] as { class: string } | string;

      // Should use public path on export
      const classPath = typeof step === "string" ? step : step.class;
      expect(classPath).toContain("sklearn.preprocessing");
    });
  });

  describe("special step types", () => {
    it("should handle chart steps", () => {
      const steps = importFromNirs4all({
        pipeline: ["chart_2d", { chart_y: { title: "Y Distribution" } }],
      });

      expect(steps[0].name).toBe("chart_2d");
      expect(steps[1].name).toBe("chart_y");
    });

    it("should handle y_processing", () => {
      const steps = importFromNirs4all({
        pipeline: [
          { y_processing: { class: "sklearn.preprocessing._data.StandardScaler" } },
        ],
      });

      expect(steps[0].type).toBe("y_processing");
      expect(steps[0].name).toBe("StandardScaler");
    });

    it("should handle sample_augmentation", () => {
      const steps = importFromNirs4all({
        pipeline: [
          {
            sample_augmentation: {
              transformers: [
                { class: "nirs4all.operators.augmentation.random.Rotate_Translate" },
              ],
              count: 3,
              selection: "random",
            },
          },
        ],
      });

      expect(steps[0].type).toBe("flow");
      expect(steps[0].subType).toBe("sample_augmentation");
      expect(steps[0].name).toBe("SampleAugmentation");
    });
  });

  describe("phase 1 structured preservation", () => {
    it("preserves structured params without stringifying them", () => {
      const steps = importFromNirs4all({
        pipeline: [
          {
            class: "sklearn.preprocessing._data.MinMaxScaler",
            params: {
              feature_range: [0.1, 0.9],
              clip: true,
              enum_payload: {
                enum: "demo.mode",
                value: "soft",
              },
            },
          },
        ],
      });

      expect(steps[0].params.feature_range).toEqual([0.1, 0.9]);
      expect(steps[0].params.enum_payload).toEqual({
        enum: "demo.mode",
        value: "soft",
      });

      const exported = exportToNirs4all(steps) as Array<{
        class: string;
        params: Record<string, unknown>;
      }>;

      expect(exported[0].params.feature_range).toEqual([0.1, 0.9]);
      expect(exported[0].params.enum_payload).toEqual({
        enum: "demo.mode",
        value: "soft",
      });
    });

    it("preserves filter origin keywords across import/export", () => {
      const excludePipeline = [
        {
          exclude: {
            class: "nirs4all.operators.filters.YOutlierFilter",
            params: { method: "iqr" },
          },
          mode: "all",
        },
      ] as Nirs4allStep[];
      const tagPipeline = [
        {
          tag: {
            class: "nirs4all.operators.filters.SpectralQualityFilter",
            params: { max_nan_ratio: 0.1 },
          },
        },
      ] as Nirs4allStep[];

      const excludeSteps = importFromNirs4all({ pipeline: excludePipeline });
      const tagSteps = importFromNirs4all({ pipeline: tagPipeline });

      expect(excludeSteps[0].filterOrigin).toBe("exclude");
      expect(tagSteps[0].filterOrigin).toBe("tag");

      expect(exportToNirs4all(excludeSteps)).toEqual(excludePipeline);
      expect(exportToNirs4all(tagSteps)).toEqual(tagPipeline);
    });

    it("imports separation branches as passthrough-safe read-only branches", () => {
      const separationBranch = {
        branch: {
          by_tag: "instrument",
          steps: {
            nir: [{ class: "nirs4all.operators.transforms.scalers.StandardNormalVariate" }],
            mir: [{ class: "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection" }],
          },
        },
      } as Nirs4allStep;

      const steps = importFromNirs4all({ pipeline: [separationBranch] });
      const branchStep = steps[0];

      expect(branchStep.subType).toBe("branch");
      expect(branchStep.branchMode).toBe("separation");
      expect(branchStep.rawNirs4all).toEqual(separationBranch);

      expect(exportToNirs4all(steps)).toEqual([separationBranch]);
    });

    it("preserves function models and finetune tuple search spaces", () => {
      const original = [
        {
          model: {
            function: "nirs4all.operators.models.tensorflow.nicon.customizable_nicon",
            framework: "tensorflow",
            params: {
              dropout_rate: 0.2,
            },
          },
          finetune_params: {
            n_trials: 8,
            approach: "single",
            eval_mode: "best",
            model_params: {
              filters_1: ["int", 8, 32],
              learning_rate: ["log_float", 1e-4, 1e-1],
              activation: ["categorical", ["relu", "tanh"]],
              explicit_choices: [16, 32, 64],
            },
            train_params: {
              epochs: ["int", 5, 25],
              batch_size: ["categorical", [16, 32]],
            },
          },
        },
      ] as Nirs4allStep[];

      const steps = importFromNirs4all({ pipeline: original });
      const modelStep = steps[0];

      expect(modelStep.functionPath).toBe(
        "nirs4all.operators.models.tensorflow.nicon.customizable_nicon"
      );
      expect(modelStep.framework).toBe("tensorflow");
      expect(modelStep.finetuneConfig?.model_params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "filters_1",
            type: "int",
            low: 8,
            high: 32,
            rawValue: ["int", 8, 32],
          }),
          expect.objectContaining({
            name: "learning_rate",
            type: "log_float",
            low: 1e-4,
            high: 1e-1,
            rawValue: ["log_float", 1e-4, 1e-1],
          }),
          expect.objectContaining({
            name: "activation",
            type: "categorical",
            choices: ["relu", "tanh"],
            rawValue: ["categorical", ["relu", "tanh"]],
          }),
          expect.objectContaining({
            name: "explicit_choices",
            type: "categorical",
            choices: [16, 32, 64],
            rawValue: [16, 32, 64],
          }),
        ])
      );

      const exported = exportToNirs4all(steps) as Nirs4allStep[];
      expect(exported).toEqual(original);
    });

    it("represents generator no-op alternatives without leaking executable placeholders", () => {
      const original = [
        {
          _or_: [
            null,
            { class: "nirs4all.operators.transforms.scalers.StandardNormalVariate" },
          ],
        },
      ] as Nirs4allStep[];

      const steps = importFromNirs4all({ pipeline: original });
      const generator = steps[0];

      expect(generator.branches?.[0]?.[0]).toMatchObject({
        name: "NoOp",
        isNoOp: true,
        rawNirs4all: null,
      });

      const exported = exportToNirs4all(steps) as Nirs4allStep[];
      const exportedGenerator = exported[0] as { _or_: Array<Nirs4allStep | null> };
      expect(exportedGenerator._or_[0]).toBeNull();
      const secondAlternative = exportedGenerator._or_[1] as { class?: string } | string;
      expect(
        typeof secondAlternative === "string"
          ? secondAlternative
          : secondAlternative.class
      ).toBe("nirs4all.operators.transforms.scalers.StandardNormalVariate");
    });

    it("round-trips cartesian stages as stage-level _or_ nodes", () => {
      const original = [
        {
          _cartesian_: [
            {
              _or_: [
                { class: "nirs4all.operators.transforms.scalers.StandardNormalVariate" },
                { class: "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection" },
              ],
            },
            {
              _or_: [
                { class: "sklearn.preprocessing._data.StandardScaler" },
                { class: "sklearn.preprocessing._data.MinMaxScaler" },
              ],
            },
          ],
          count: 3,
        },
      ] as Nirs4allStep[];

      const steps = importFromNirs4all({ pipeline: original });
      const cartesian = steps[0];

      expect(cartesian.generatorKind).toBe("cartesian");
      expect(cartesian.generatorOptions?.count).toBe(3);
      expect(cartesian.branches?.[0]?.map((step) => step.name)).toEqual(["SNV", "MSC"]);
      expect(cartesian.branches?.[1]?.map((step) => step.name)).toEqual([
        "StandardScaler",
        "MinMaxScaler",
      ]);

      expect(exportToNirs4all(steps)).toEqual([
        {
          _cartesian_: [
            {
              _or_: [
                "nirs4all.operators.transforms.scalers.StandardNormalVariate",
                "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection",
              ],
            },
            {
              _or_: [
                "sklearn.preprocessing._data.StandardScaler",
                "sklearn.preprocessing._data.MinMaxScaler",
              ],
            },
          ],
          count: 3,
        },
      ]);
    });

    it("preserves sequential cartesian stages and modified nested _or_ stages", () => {
      const original = [
        {
          _cartesian_: [
            [
              { class: "nirs4all.operators.transforms.scalers.StandardNormalVariate" },
              { class: "nirs4all.operators.transforms.signal.Detrend" },
            ],
            {
              _or_: [
                { class: "sklearn.preprocessing._data.StandardScaler" },
                { class: "sklearn.preprocessing._data.MinMaxScaler" },
              ],
              count: 1,
            },
          ],
          count: 2,
        },
      ] as Nirs4allStep[];

      const steps = importFromNirs4all({ pipeline: original });
      const cartesian = steps[0];

      expect(cartesian.branches?.[0]?.[0]).toMatchObject({
        name: "Sequential",
        subType: "sequential",
      });
      expect(cartesian.branches?.[0]?.[0].children?.map((child) => child.name)).toEqual([
        "SNV",
        "Detrend",
      ]);
      expect(cartesian.branches?.[1]?.[0]).toMatchObject({
        name: "Or",
        generatorKind: "or",
      });
      expect(cartesian.branches?.[1]?.[0].generatorOptions?.count).toBe(1);

      expect(exportToNirs4all(steps)).toEqual([
        {
          _cartesian_: [
            [
              "nirs4all.operators.transforms.scalers.StandardNormalVariate",
              "nirs4all.operators.transforms.signal.Detrend",
            ],
            {
              _or_: [
                "sklearn.preprocessing._data.StandardScaler",
                "sklearn.preprocessing._data.MinMaxScaler",
              ],
              count: 1,
            },
          ],
          count: 2,
        },
      ]);
    });
  });
});
