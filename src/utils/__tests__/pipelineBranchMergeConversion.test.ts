import { describe, expect, it } from "vitest";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  convertBranchToEditor,
  convertEditorBranchToNirs4all,
  convertEditorMergeToNirs4all,
  convertMergeToEditor,
} from "../pipelineBranchMergeConversion";
import type { Nirs4allBranchStep, Nirs4allStep } from "../nirs4allPipelineTypes";

function editorStepFromCanonical(step: Nirs4allStep): EditorPipelineStep {
  return {
    id: `editor-${String(step)}`,
    type: "preprocessing",
    name: String(step),
    params: {},
    classPath: typeof step === "string" ? step : undefined,
    rawNirs4all: typeof step === "string" ? undefined : step,
  };
}

function canonicalStepFromEditor(step: EditorPipelineStep): Nirs4allStep {
  if (step.rawNirs4all !== undefined) {
    return step.rawNirs4all as Nirs4allStep;
  }
  return step.classPath || step.name;
}

describe("pipelineBranchMergeConversion", () => {
  it("imports named duplication branches with metadata", () => {
    const editorStep = convertBranchToEditor({
      branch: {
        snv_branch: ["SNV"],
        msc_branch: ["MSC", "PCA"],
      },
    }, editorStepFromCanonical);

    expect(editorStep).toMatchObject({
      type: "flow",
      subType: "branch",
      name: "ParallelBranch",
      branchMode: "duplication",
    });
    expect(editorStep.branchMetadata).toEqual([
      { name: "snv_branch" },
      { name: "msc_branch" },
    ]);
    expect(editorStep.branches?.[1]).toEqual([
      expect.objectContaining({ classPath: "MSC" }),
      expect.objectContaining({ classPath: "PCA" }),
    ]);
  });

  it("imports separation branches as raw read-only branches", () => {
    const canonical = {
      branch: {
        by_tag: "instrument",
        steps: {
          a: ["SNV"],
          b: ["MSC"],
        },
      },
    } as unknown as Nirs4allBranchStep;

    const editorStep = convertBranchToEditor(canonical, editorStepFromCanonical);

    expect(editorStep).toMatchObject({
      type: "flow",
      subType: "branch",
      name: "Branch by tag: instrument",
      branchMode: "separation",
      rawNirs4all: canonical,
    });
    expect(editorStep.branches).toBeUndefined();
  });

  it("exports named and indexed branch payloads", () => {
    const named = convertEditorBranchToNirs4all({
      id: "branch-named",
      type: "flow",
      subType: "branch",
      name: "ParallelBranch",
      params: {},
      branches: [[editorStepFromCanonical("SNV")], [editorStepFromCanonical("MSC")]],
      branchMetadata: [{ name: "snv" }, { name: "msc" }],
    }, canonicalStepFromEditor);

    const indexed = convertEditorBranchToNirs4all({
      id: "branch-indexed",
      type: "flow",
      subType: "branch",
      name: "ParallelBranch",
      params: {},
      branches: [[editorStepFromCanonical("SNV")], [editorStepFromCanonical("MSC")]],
    }, canonicalStepFromEditor);

    expect(named).toEqual({ branch: { snv: ["SNV"], msc: ["MSC"] } });
    expect(indexed).toEqual({ branch: [["SNV"], ["MSC"]] });
  });

  it("imports simple and complex merge definitions", () => {
    const simple = convertMergeToEditor({ merge: "concat" });
    const complex = convertMergeToEditor({
      merge: {
        predictions: [
          { branch: 0, select: "best", metric: "rmse" },
          { branch: 1, select: { top_k: 3 } },
        ],
        features: [2],
        output_as: "features",
        on_missing: "warn",
      },
    });

    expect(simple).toMatchObject({
      type: "flow",
      subType: "merge",
      name: "Concatenate",
      params: { merge_type: "concat" },
      mergeConfig: { mode: "concat" },
    });
    expect(complex.mergeConfig).toMatchObject({
      mode: "predictions",
      predictions: [
        { branch: 0, select: "best", metric: "rmse" },
        { branch: 1, select: { top_k: 3 } },
      ],
      features: [2],
      output_as: "features",
      on_missing: "warn",
    });
    expect(complex.stackingConfig?.useOriginalFeatures).toBe(true);
  });

  it("exports merge config and filters editor-only merge params", () => {
    const structured = convertEditorMergeToNirs4all({
      id: "merge-structured",
      type: "flow",
      subType: "merge",
      name: "Merge",
      params: {},
      mergeConfig: {
        mode: "predictions",
        predictions: [{ branch: 0, select: "best", metric: "rmse" }],
        output_as: "predictions",
      },
    });

    const legacy = convertEditorMergeToNirs4all({
      id: "merge-legacy",
      type: "flow",
      subType: "merge",
      name: "Merge",
      params: {
        merge_type: "predictions",
        predictions: ["model_a"],
        _uiOnly: true,
      },
    });

    expect(structured).toEqual({
      merge: {
        predictions: [{ branch: 0, select: "best", metric: "rmse" }],
        output_as: "predictions",
      },
    });
    expect(legacy).toEqual({ merge: { predictions: ["model_a"] } });
  });
});
