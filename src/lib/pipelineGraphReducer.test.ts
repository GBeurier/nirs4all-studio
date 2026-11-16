import { describe, expect, it } from "vitest";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import { insertPipelineStepAtPath } from "./pipelineGraphReducer";

const step = (id: string, extra: Partial<PipelineStep> = {}): PipelineStep => ({
  id,
  type: "preprocessing",
  name: id,
  params: {},
  ...extra,
});

const ids = (steps: PipelineStep[] | undefined) => steps?.map((entry) => entry.id);

describe("insertPipelineStepAtPath", () => {
  const added = step("added", { type: "model" });
  const pipeline = [
    step("first"),
    step("branching", { type: "flow", subType: "branch", branches: [[step("left")], [step("right-1"), step("right-2")]] }),
  ];

  it("inserts at the requested position of the root and of a nested container", () => {
    expect(ids(insertPipelineStepAtPath(pipeline, [], 1, added))).toEqual(["first", "added", "branching"]);

    const nested = insertPipelineStepAtPath(pipeline, ["branching", "branch", "1"], 1, added);
    expect(ids(nested)).toEqual(["first", "branching"]);
    expect(ids(nested[1].branches?.[1])).toEqual(["right-1", "added", "right-2"]);
    expect(ids(nested[1].branches?.[0])).toEqual(["left"]);
  });

  it("clamps a position past the end of a container that shrank meanwhile", () => {
    expect(ids(insertPipelineStepAtPath(pipeline, [], 7, added))).toEqual(["first", "branching", "added"]);

    const nested = insertPipelineStepAtPath(pipeline, ["branching", "branch", "0"], 4, added);
    expect(ids(nested[1].branches?.[0])).toEqual(["left", "added"]);
  });

  it("appends to the pipeline root when the container was removed meanwhile", () => {
    // The whole branching step, then only its second branch, are gone.
    expect(ids(insertPipelineStepAtPath([step("first")], ["branching", "branch", "1"], 0, added)))
      .toEqual(["first", "added"]);

    const oneBranch = [step("first"), step("branching", { type: "flow", subType: "branch", branches: [[step("left")]] })];
    const result = insertPipelineStepAtPath(oneBranch, ["branching", "branch", "1"], 0, added);
    expect(ids(result)).toEqual(["first", "branching", "added"]);
    expect(ids(result[1].branches?.[0])).toEqual(["left"]);
  });
});
