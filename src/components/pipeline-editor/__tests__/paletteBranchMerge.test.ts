import { describe, expect, it } from "vitest";
import { createStepFromOption } from "../stepFactory";
import { convertEditorBranchToNirs4all, convertEditorMergeToNirs4all, convertMergeToEditor } from "@/utils/pipelineBranchMergeConversion";

describe("palette branch and merge execution", () => {
  it("creates a source branch that preserves each source's own preprocessing", () => {
    const scale = createStepFromOption("preprocessing", { name: "StandardScaler", description: "scale", defaultParams: {} });
    const branch = createStepFromOption("flow", { name: "SourceBranch", description: "sources", classPath: "source_branch",
      defaultParams: { sources: ["NIR", "markers"] }, defaultBranches: [[scale], [scale]] });
    expect(branch.branchMode).toBe("separation");
    expect(branch.separationConfig?.kind).toBe("by_source");
    expect(convertEditorBranchToNirs4all(branch, child => child.name)).toEqual({
      branch: { by_source: true, steps: { NIR: ["StandardScaler"], markers: ["StandardScaler"] } },
    });
  });

  it.each(["predictions", "features"])("exports palette merge mode %s", mode => {
    const merge = createStepFromOption("flow", { name: "MergePredictions", description: "merge", classPath: "merge", defaultParams: { mode } });
    expect(merge.subType).toBe("merge");
    expect(convertEditorMergeToNirs4all(merge)).toEqual({ merge: mode });
  });

  it("exports and roundtrips source feature concatenation", () => {
    const merge = createStepFromOption("flow", { name: "MergeSources", description: "merge", classPath: "source_merge", defaultParams: { axis: "features" } });
    expect(merge.subType).toBe("merge");
    const canonical = { merge: { sources: "concat" } };
    expect(convertEditorMergeToNirs4all(merge)).toEqual(canonical);
    expect(convertEditorMergeToNirs4all(convertMergeToEditor(canonical))).toEqual(canonical);
    expect(() => convertEditorMergeToNirs4all({ ...merge, params: { axis: "samples" } })).toThrow("aligned samples");
    expect(() => convertEditorMergeToNirs4all({ ...merge, classPath: "merge", name: "MergePredictions", params: { mode: "average" } })).toThrow("Unsupported merge mode");
  });
});
