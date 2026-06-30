import { describe, expect, it } from "vitest";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  convertCartesianGeneratorToEditor,
  convertEditorGeneratorToNirs4all,
  convertGeneratorAlternativeToEditor,
  convertGridGeneratorToEditor,
  convertOrGeneratorToEditor,
  convertRangeGeneratorToEditor,
  convertSampleGeneratorToEditor,
  createNoOpEditorStep,
} from "../pipelineGeneratorConversion";
import type { Nirs4allGeneratorStep, Nirs4allStep } from "../nirs4allPipelineTypes";

function editorStepFromCanonical(step: Nirs4allStep): EditorPipelineStep {
  if (typeof step === "string") {
    return {
      id: `editor-${step}`,
      type: "preprocessing",
      name: step,
      params: {},
      classPath: step,
    };
  }
  return {
    id: "editor-object",
    type: "preprocessing",
    name: "ObjectStep",
    params: {},
    rawNirs4all: step,
  };
}

function canonicalStepFromEditor(step: EditorPipelineStep): Nirs4allStep {
  if (step.rawNirs4all !== undefined) {
    return step.rawNirs4all as Nirs4allStep;
  }
  return step.classPath || step.name;
}

describe("pipelineGeneratorConversion", () => {
  it("imports _or_ alternatives with no-op and modifier metadata", () => {
    const generator = convertOrGeneratorToEditor(
      {
        _or_: [null, "SNV", ["MSC", "PCA"]],
        pick: 1,
        then_arrange: 2,
        count: 3,
        _seed_: 42,
      },
      editorStepFromCanonical
    );

    expect(generator).toMatchObject({
      type: "flow",
      subType: "generator",
      name: "Or",
      generatorKind: "or",
      params: { _seed_: 42 },
      generatorOptions: {
        pick: 1,
        then_arrange: 2,
        count: 3,
      },
    });
    expect(generator.branches?.[0]?.[0]).toMatchObject({ isNoOp: true, rawNirs4all: null });
    expect(generator.branches?.[1]?.[0]).toMatchObject({ classPath: "SNV" });
    expect(generator.branches?.[2]).toHaveLength(2);
  });

  it("imports cartesian stage-level _or_ nodes and sequential stages", () => {
    const generator = convertCartesianGeneratorToEditor(
      {
        _cartesian_: [
          { _or_: ["SNV", null] },
          ["MSC", "PCA"],
        ],
        arrange: [1, 2],
        count: 4,
      },
      editorStepFromCanonical
    );

    expect(generator.generatorKind).toBe("cartesian");
    expect(generator.generatorOptions).toMatchObject({ arrange: [1, 2], count: 4 });
    expect(generator.branches?.[0]).toHaveLength(2);
    expect(generator.branches?.[0]?.[1]).toMatchObject({ isNoOp: true });
    expect(generator.branches?.[1]?.[0]).toMatchObject({
      subType: "sequential",
      children: [expect.objectContaining({ classPath: "MSC" }), expect.objectContaining({ classPath: "PCA" })],
    });
  });

  it("imports scalar grid, range, and sample generator configs", () => {
    const grid = convertGridGeneratorToEditor({
      _grid_: { n_components: [5, 10], scale: [true, false] },
      count: 2,
    });
    const range = convertRangeGeneratorToEditor({
      _log_range_: [1e-4, 1e-1, 5],
      param: "alpha",
      count: 3,
    });
    const sample = convertSampleGeneratorToEditor({
      _sample_: { distribution: "choice", values: ["snv", "msc"], num: 5 },
    });

    expect(grid.scalarGeneratorConfig?.entries).toEqual([
      expect.objectContaining({ key: "n_components", values: [5, 10] }),
      expect.objectContaining({ key: "scale", values: [true, false] }),
    ]);
    expect(range).toMatchObject({
      generatorKind: "log_range",
      stepGenerator: { type: "_log_range_", values: [1e-4, 1e-1, 5], param: "alpha", count: 3 },
    });
    expect(sample.scalarGeneratorConfig?.sample).toEqual({
      distribution: "choice",
      choices: ["snv", "msc"],
      num: 5,
    });
  });

  it("exports scalar grid and sample configs from editor state", () => {
    const grid = convertEditorGeneratorToNirs4all({
      id: "grid",
      type: "flow",
      subType: "generator",
      name: "Grid",
      params: { _seed_: 11 },
      generatorKind: "grid",
      generatorOptions: { count: 2 },
      scalarGeneratorConfig: {
        entries: [
          { id: "e1", key: "n_components", values: [3, 6] },
          { id: "e2", key: "alpha", values: [0.1, 0.5] },
        ],
      },
    }, canonicalStepFromEditor);

    const sample = convertEditorGeneratorToNirs4all({
      id: "sample",
      type: "flow",
      subType: "generator",
      name: "Sample",
      params: {},
      generatorKind: "sample",
      scalarGeneratorConfig: {
        sample: { distribution: "choice", choices: ["snv", "msc"], num: 5 },
      },
    }, canonicalStepFromEditor);

    expect(grid).toEqual({
      _grid_: { n_components: [3, 6], alpha: [0.1, 0.5] },
      count: 2,
      _seed_: 11,
    });
    expect(sample).toEqual({
      _sample_: { distribution: "choice", values: ["snv", "msc"], num: 5 },
    });
  });

  it("exports no-op alternatives and cartesian sequential stages", () => {
    const noOp = createNoOpEditorStep();
    const orGenerator = convertEditorGeneratorToNirs4all({
      id: "or",
      type: "flow",
      subType: "generator",
      name: "Or",
      params: {},
      generatorKind: "or",
      branches: [[noOp], [editorStepFromCanonical("SNV")]],
      generatorOptions: { pick: 1 },
    }, canonicalStepFromEditor);

    const cartesianGenerator = convertEditorGeneratorToNirs4all({
      id: "cart",
      type: "flow",
      subType: "generator",
      name: "Cartesian",
      params: {},
      generatorKind: "cartesian",
      branches: [[noOp], [{
        id: "seq",
        type: "flow",
        subType: "sequential",
        name: "Sequential",
        params: {},
        children: [editorStepFromCanonical("MSC"), editorStepFromCanonical("PCA")],
      }]],
    }, canonicalStepFromEditor);

    expect(orGenerator).toEqual({ _or_: [null, "SNV"], pick: 1 });
    expect(cartesianGenerator).toEqual({
      _cartesian_: [{ _or_: [null] }, ["MSC", "PCA"]],
    });
  });

  it("keeps generator alternative conversion available for container helpers", () => {
    const alternatives = convertGeneratorAlternativeToEditor(
      ["SNV", null, "MSC"] as Nirs4allStep[],
      editorStepFromCanonical
    );

    expect(alternatives).toEqual([
      expect.objectContaining({ classPath: "SNV" }),
      expect.objectContaining({ isNoOp: true }),
      expect.objectContaining({ classPath: "MSC" }),
    ]);
  });
});
