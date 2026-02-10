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
});
