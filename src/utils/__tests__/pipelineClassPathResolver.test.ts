import { describe, expect, it } from "vitest";
import {
  getClassNameFromPath,
  getClassPath,
  getDefaultParamsForStep,
  inferFunctionModelFramework,
  isFunctionModelPath,
  resolveClassPath,
  resolveConfiguredClassPath,
  resolveRequiredClassPath,
} from "../pipelineClassPathResolver";

describe("pipelineClassPathResolver", () => {
  it("resolves registry and legacy class paths to editor-facing names", () => {
    expect(resolveClassPath("sklearn.preprocessing._data.MinMaxScaler")).toMatchObject({
      name: "MinMaxScaler",
      type: "preprocessing",
      classPath: "sklearn.preprocessing._data.MinMaxScaler",
    });
    expect(resolveClassPath("nirs4all.operators.transforms.scalers.StandardNormalVariate")).toMatchObject({
      name: "SNV",
      type: "preprocessing",
      classPath: "nirs4all.operators.transforms.scalers.StandardNormalVariate",
    });
  });

  it("uses registry aliases and curated overrides for export class paths", () => {
    expect(getClassPath("model", "PLSRegression")).toBe("sklearn.cross_decomposition.PLSRegression");
    expect(getClassPath("augmentation", "GaussianNoise")).toBe(
      "nirs4all.operators.transforms.GaussianAdditiveNoise"
    );
  });

  it("prefers canonical known model paths over stale explicit paths", () => {
    expect(resolveConfiguredClassPath("model", "OPLS", "sklearn.cross_decomposition.OPLS")).toBe(
      "nirs4all.operators.models.OPLS"
    );
    expect(() => resolveRequiredClassPath({ type: "model", name: "DefinitelyNotAModel" })).toThrow(
      'Could not resolve class path for model step "DefinitelyNotAModel"'
    );
  });

  it("classifies function-style model paths and frameworks", () => {
    const niconPath = "nirs4all.operators.models.pytorch.nicon.nicon";

    expect(getClassNameFromPath(niconPath)).toBe("nicon");
    expect(isFunctionModelPath(niconPath)).toBe(true);
    expect(isFunctionModelPath("sklearn.linear_model.Ridge")).toBe(false);
    expect(inferFunctionModelFramework(niconPath)).toBe("pytorch");
  });

  it("provides registry-backed default params for known editor steps", () => {
    expect(getDefaultParamsForStep({ type: "model", name: "BayesianRidge" })).toMatchObject({
      max_iter: 300,
      tol: 0.001,
    });
    expect(getDefaultParamsForStep({ type: "model", name: "ElasticNet" })).toMatchObject({
      alpha: 1,
      l1_ratio: 0.5,
    });
  });
});
