import { describe, expect, it } from "vitest";
import { castParamRecord, cloneParamValue } from "../pipelineValueUtils";

describe("pipelineValueUtils", () => {
  it("deep-clones arrays and records", () => {
    const original: { range: [number, { nested: string[] }] } = {
      range: [1, { nested: ["a"] }],
    };
    const cloned = cloneParamValue(original) as typeof original;

    cloned.range[1].nested.push("b");

    expect(original).toEqual({ range: [1, { nested: ["a"] }] });
    expect(cloned).toEqual({ range: [1, { nested: ["a", "b"] }] });
  });

  it("casts param records while dropping undefined values", () => {
    expect(castParamRecord({
      keep: 1,
      drop: undefined,
      nested: { value: ["x"] },
    })).toEqual({
      keep: 1,
      nested: { value: ["x"] },
    });
  });
});
