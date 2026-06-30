import { describe, expect, it } from "vitest";
import type { PipelineStep, ScalarGeneratorEntry } from "../../../types";
import {
  addScalarEntry,
  calculatePrimarySelectionCount,
  calculateVariantsForValue,
  combinations,
  configToOptions,
  createScalarEntryDrafts,
  extractConfig,
  formatSelectionValue,
  getGeneratorOptionCount,
  getPrimarySelectionDescription,
  getPrimarySelectionSummary,
  getSecondarySelectionSummary,
  isRange,
  parseJsonArrayDraft,
  permutations,
  removeScalarEntry,
  renameScalarEntry,
  stringifyJsonDraft,
  updateScalarEntryValues,
  type SelectionConfig,
} from "../GeneratorRenderer.helpers";

function makeStep(overrides: Partial<PipelineStep>): PipelineStep {
  return {
    id: "gen-1",
    type: "flow",
    name: "Generator",
    params: {},
    ...overrides,
  };
}

function selectionConfig(overrides: Partial<SelectionConfig>): SelectionConfig {
  return {
    primaryMode: "none",
    secondaryMode: "none",
    ...overrides,
  };
}

function makeScalarEntry(overrides: Partial<ScalarGeneratorEntry>): ScalarGeneratorEntry {
  return {
    id: "entry-1",
    key: "alpha",
    values: [1, 2],
    ...overrides,
  };
}

describe("isRange", () => {
  it("treats a two-element array as a range", () => {
    expect(isRange([1, 3])).toBe(true);
  });

  it("treats scalars and undefined as non-ranges", () => {
    expect(isRange(2)).toBe(false);
    expect(isRange(undefined)).toBe(false);
  });
});

describe("combinations", () => {
  it("computes C(n, k) for valid inputs", () => {
    expect(combinations(5, 2)).toBe(10);
    expect(combinations(4, 4)).toBe(1);
    expect(combinations(6, 0)).toBe(1);
  });

  it("returns 0 when k is out of bounds", () => {
    expect(combinations(3, 4)).toBe(0);
    expect(combinations(3, -1)).toBe(0);
  });

  it("stays integer for larger values despite float division", () => {
    expect(combinations(10, 5)).toBe(252);
  });
});

describe("permutations", () => {
  it("computes P(n, k) for valid inputs", () => {
    expect(permutations(5, 2)).toBe(20);
    expect(permutations(4, 0)).toBe(1);
    expect(permutations(3, 3)).toBe(6);
  });

  it("returns 0 when k is out of bounds", () => {
    expect(permutations(3, 4)).toBe(0);
    expect(permutations(3, -1)).toBe(0);
  });
});

describe("calculateVariantsForValue", () => {
  it("uses combinations for pick scalars", () => {
    expect(calculateVariantsForValue(5, "pick", 2)).toBe(10);
  });

  it("uses permutations for arrange scalars", () => {
    expect(calculateVariantsForValue(5, "arrange", 2)).toBe(20);
  });

  it("sums across an inclusive range for pick", () => {
    // C(4,1) + C(4,2) + C(4,3) = 4 + 6 + 4 = 14
    expect(calculateVariantsForValue(4, "pick", [1, 3])).toBe(14);
  });

  it("sums across an inclusive range for arrange", () => {
    // P(3,1) + P(3,2) = 3 + 6 = 9
    expect(calculateVariantsForValue(3, "arrange", [1, 2])).toBe(9);
  });
});

describe("calculatePrimarySelectionCount", () => {
  it("returns the base count when pick/arrange is unsupported", () => {
    expect(
      calculatePrimarySelectionCount(
        selectionConfig({ primaryMode: "pick", primaryValue: 2 }),
        false,
        5,
      ),
    ).toBe(5);
  });

  it("uses pick combinations for primary pick mode", () => {
    expect(
      calculatePrimarySelectionCount(
        selectionConfig({ primaryMode: "pick", primaryValue: 2 }),
        true,
        5,
      ),
    ).toBe(10);
  });

  it("uses arrange permutations for primary arrange mode", () => {
    expect(
      calculatePrimarySelectionCount(
        selectionConfig({ primaryMode: "arrange", primaryValue: [1, 2] }),
        true,
        3,
      ),
    ).toBe(9);
  });
});

describe("generator display helpers", () => {
  it("uses scalar entries for grid and zip option counts", () => {
    expect(
      getGeneratorOptionCount({
        generatorKind: "grid",
        scalarEntryCount: 3,
        sampleCount: 8,
        branchCount: 5,
      }),
    ).toBe(3);
    expect(
      getGeneratorOptionCount({
        generatorKind: "zip",
        scalarEntryCount: 2,
        sampleCount: 8,
        branchCount: 5,
      }),
    ).toBe(2);
  });

  it("uses sample count for sample generators and branch count otherwise", () => {
    expect(
      getGeneratorOptionCount({
        generatorKind: "sample",
        scalarEntryCount: 3,
        sampleCount: 8,
        branchCount: 5,
      }),
    ).toBe(8);
    expect(
      getGeneratorOptionCount({
        generatorKind: "or",
        scalarEntryCount: 3,
        sampleCount: 8,
        branchCount: 5,
      }),
    ).toBe(5);
  });

  it("formats scalar and range selection values", () => {
    expect(formatSelectionValue(undefined)).toBe("");
    expect(formatSelectionValue(2)).toBe("2");
    expect(formatSelectionValue([1, 3])).toBe("1 to 3");
  });

  it("describes primary selection math without JSX", () => {
    expect(
      getPrimarySelectionDescription(
        selectionConfig({ primaryMode: "pick", primaryValue: 2 }),
        5,
      ),
    ).toBe("C(5, 2) = 10 combinations");
    expect(
      getPrimarySelectionDescription(
        selectionConfig({ primaryMode: "arrange", primaryValue: [1, 2] }),
        3,
      ),
    ).toBe("All permutations from 1 to 2");
  });

  it("summarizes primary and secondary selections", () => {
    expect(getPrimarySelectionSummary(selectionConfig({}), "cartesian")).toBe(
      "All stage combinations",
    );
    expect(getPrimarySelectionSummary(selectionConfig({}), "or")).toBe(
      "Each option tested individually",
    );
    expect(
      getPrimarySelectionSummary(
        selectionConfig({ primaryMode: "pick", primaryValue: [1, 3] }),
        "or",
      ),
    ).toBe("All combinations from 1 to 3");
    expect(
      getSecondarySelectionSummary(
        selectionConfig({ secondaryMode: "then_arrange", secondaryValue: 2 }),
      ),
    ).toBe("\u2192 Then arrange 2 from results");
  });
});

describe("draft helpers", () => {
  it("stringifies values with the same pretty JSON shape as the editor draft", () => {
    expect(stringifyJsonDraft(["snv", "msc"])).toBe('[\n  "snv",\n  "msc"\n]');
  });

  it("creates scalar entry drafts keyed by entry id", () => {
    expect(
      createScalarEntryDrafts([
        makeScalarEntry({ id: "a", values: [1, 2] }),
        makeScalarEntry({ id: "b", values: ["x"] }),
      ]),
    ).toEqual({
      a: "[\n  1,\n  2\n]",
      b: '[\n  "x"\n]',
    });
  });

  it("parses only JSON arrays from textarea drafts", () => {
    expect(parseJsonArrayDraft("[1, 2]")).toEqual([1, 2]);
    expect(parseJsonArrayDraft('{"not":"array"}')).toBeUndefined();
    expect(parseJsonArrayDraft("not json")).toBeUndefined();
  });
});

describe("scalar entry helpers", () => {
  it("adds a new scalar entry using the next parameter label", () => {
    expect(addScalarEntry([makeScalarEntry({ id: "first" })], "second")).toEqual([
      makeScalarEntry({ id: "first" }),
      { id: "second", key: "param_2", values: [] },
    ]);
  });

  it("removes scalar entries by id without mutating the others", () => {
    const entries = [
      makeScalarEntry({ id: "a" }),
      makeScalarEntry({ id: "b", key: "beta" }),
    ];

    expect(removeScalarEntry(entries, "a")).toEqual([
      makeScalarEntry({ id: "b", key: "beta" }),
    ]);
    expect(entries).toHaveLength(2);
  });

  it("renames and updates values for a matching scalar entry", () => {
    const entries = [
      makeScalarEntry({ id: "a" }),
      makeScalarEntry({ id: "b", key: "beta", values: [3] }),
    ];

    expect(renameScalarEntry(entries, "b", "gamma")).toEqual([
      makeScalarEntry({ id: "a" }),
      makeScalarEntry({ id: "b", key: "gamma", values: [3] }),
    ]);
    expect(updateScalarEntryValues(entries, "a", ["x", "y"])).toEqual([
      makeScalarEntry({ id: "a", values: ["x", "y"] }),
      makeScalarEntry({ id: "b", key: "beta", values: [3] }),
    ]);
  });
});

describe("extractConfig", () => {
  it("defaults to none/none when no generator options are set", () => {
    expect(extractConfig(makeStep({}))).toEqual({
      primaryMode: "none",
      primaryValue: undefined,
      secondaryMode: "none",
      secondaryValue: undefined,
      count: undefined,
      seed: undefined,
    });
  });

  it("prefers arrange over pick for the primary mode", () => {
    const config = extractConfig(
      makeStep({ generatorOptions: { arrange: 2, pick: 3 } }),
    );
    expect(config.primaryMode).toBe("arrange");
    expect(config.primaryValue).toBe(2);
  });

  it("reads pick, then_pick, count and the seed from params", () => {
    const config = extractConfig(
      makeStep({
        generatorOptions: { pick: [1, 2], then_pick: 2, count: 5 },
        params: { _seed_: 7 },
      }),
    );
    expect(config).toEqual({
      primaryMode: "pick",
      primaryValue: [1, 2],
      secondaryMode: "then_pick",
      secondaryValue: 2,
      count: 5,
      seed: 7,
    });
  });

  it("prefers then_arrange over then_pick for the secondary mode", () => {
    const config = extractConfig(
      makeStep({ generatorOptions: { then_arrange: 2, then_pick: 3 } }),
    );
    expect(config.secondaryMode).toBe("then_arrange");
    expect(config.secondaryValue).toBe(2);
  });
});

describe("configToOptions", () => {
  it("omits primary keys when the mode is none", () => {
    expect(configToOptions(selectionConfig({ primaryValue: 2 }))).toEqual({});
  });

  it("omits primary keys when the value is undefined", () => {
    expect(configToOptions(selectionConfig({ primaryMode: "pick" }))).toEqual({});
  });

  it("serializes pick and then_pick", () => {
    const opts = configToOptions(
      selectionConfig({
        primaryMode: "pick",
        primaryValue: [1, 3],
        secondaryMode: "then_pick",
        secondaryValue: 2,
      }),
    );
    expect(opts).toEqual({ pick: [1, 3], then_pick: 2 });
  });

  it("serializes arrange and then_arrange", () => {
    const opts = configToOptions(
      selectionConfig({
        primaryMode: "arrange",
        primaryValue: 2,
        secondaryMode: "then_arrange",
        secondaryValue: 1,
      }),
    );
    expect(opts).toEqual({ arrange: 2, then_arrange: 1 });
  });

  it("only includes count when it is a positive number", () => {
    expect(configToOptions(selectionConfig({ count: 0 }))).toEqual({});
    expect(configToOptions(selectionConfig({ count: 4 }))).toEqual({ count: 4 });
  });

  it("never serializes the seed into generator options", () => {
    expect(configToOptions(selectionConfig({ seed: 42 }))).toEqual({});
  });

  it("round-trips through extractConfig for a populated step", () => {
    const step = makeStep({
      generatorOptions: { arrange: [1, 2], then_pick: 2, count: 3 },
    });
    expect(configToOptions(extractConfig(step))).toEqual(step.generatorOptions);
  });
});
