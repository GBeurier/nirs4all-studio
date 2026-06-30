import { describe, expect, it } from "vitest";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  hydrateEditorPipelineSteps,
  hydrateEditorStep,
  hydrateMissingStepParams,
} from "../pipelineEditorHydration";

describe("pipelineEditorHydration", () => {
  it("hydrates missing registry defaults while preserving explicit params", () => {
    const hydrated = hydrateMissingStepParams({
      id: "bayes",
      type: "model",
      name: "BayesianRidge",
      params: { tol: 0.002 },
    });

    expect(hydrated.params).toMatchObject({
      max_iter: 300,
      tol: 0.002,
    });
    expect(hydrated.hydratedDefaultParams).toContain("max_iter");
    expect(hydrated.hydratedDefaultParams).not.toContain("tol");
  });

  it("resolves canonical class paths and migrates function-style model paths", () => {
    const model = hydrateEditorStep({
      id: "nicon",
      type: "model",
      name: "nicon",
      params: {},
      classPath: "nirs4all.operators.models.pytorch.nicon.nicon",
    });

    expect(model).toMatchObject({
      classPath: "nirs4all.operators.models.pytorch.nicon.nicon",
      functionPath: "nirs4all.operators.models.pytorch.nicon.nicon",
      framework: "pytorch",
    });

    const preprocessing = hydrateEditorStep({
      id: "snv",
      type: "preprocessing",
      name: "SNV",
      params: {},
    });

    expect(preprocessing.classPath).toBe("nirs4all.operators.transforms.StandardNormalVariate");
  });

  it("hydrates nested branches and children recursively", () => {
    const steps: EditorPipelineStep[] = hydrateEditorPipelineSteps([
      {
        id: "branch",
        type: "flow",
        subType: "branch",
        name: "ParallelBranch",
        params: {},
        branches: [
          [{ id: "child-model", type: "model", name: "BayesianRidge", params: {} }],
        ],
        children: [
          { id: "child-pre", type: "preprocessing", name: "SNV", params: {} },
        ],
      },
    ]);

    expect(steps[0].branches?.[0]?.[0].params).toMatchObject({ max_iter: 300 });
    expect(steps[0].branches?.[0]?.[0].hydratedDefaultParams).toContain("max_iter");
    expect(steps[0].children?.[0].classPath).toBe(
      "nirs4all.operators.transforms.StandardNormalVariate"
    );
  });

  it("leaves flow, utility, and raw steps untouched at the top level", () => {
    const flow: EditorPipelineStep = {
      id: "flow",
      type: "flow",
      name: "Flow",
      params: {},
    };
    const raw: EditorPipelineStep = {
      id: "raw",
      type: "model",
      name: "Unknown",
      params: {},
      rawNirs4all: { custom: true },
    };

    expect(hydrateEditorStep(flow)).toBe(flow);
    expect(hydrateEditorStep(raw)).toBe(raw);
  });
});
