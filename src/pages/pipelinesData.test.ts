import { describe, expect, it } from "vitest";
import type { ChainSummary } from "@/types/aggregated-predictions";
import type { Pipeline, PipelinePreset } from "@/types/pipelines";
import type { Run } from "@/types/runs";
import {
  extractRecentRuns,
  filterRecentRuns,
  matchesPipelineSearch,
  matchesPresetSearch,
  pickBestChain,
  scoreOf,
  sortPipelineItems,
  sortPresetItems,
} from "./pipelinesData";

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "p1",
    name: "Pipeline",
    description: "",
    category: "custom",
    steps: [],
    isFavorite: false,
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  } as Pipeline;
}

function makePreset(overrides: Partial<PipelinePreset> = {}): PipelinePreset {
  return {
    id: "preset",
    name: "Preset",
    description: "",
    complexity: 5,
    default_variant: "regression",
    available_variants: [],
    variants: {},
    steps_count: 0,
    ...overrides,
  } as PipelinePreset;
}

function makeChain(overrides: Partial<ChainSummary> = {}): ChainSummary {
  return {
    chain_id: "c1",
    metric: null,
    final_test_score: null,
    final_agg_test_score: null,
    cv_val_score: null,
    cv_test_score: null,
    ...overrides,
  } as ChainSummary;
}

describe("matchesPipelineSearch", () => {
  it("returns true for an empty query", () => {
    expect(matchesPipelineSearch(makePipeline({ name: "Anything" }), "")).toBe(true);
  });

  it("matches name, description, and tags (query pre-lowercased)", () => {
    const p = makePipeline({ name: "SNV Model", description: "best one", tags: ["snv", "pls"] });
    expect(matchesPipelineSearch(p, "snv")).toBe(true);
    expect(matchesPipelineSearch(p, "best")).toBe(true);
    expect(matchesPipelineSearch(p, "pls")).toBe(true);
    expect(matchesPipelineSearch(p, "absent")).toBe(false);
  });
});

describe("matchesPresetSearch", () => {
  it("matches name, description, and variants/task_type", () => {
    const preset = makePreset({
      name: "Quick PLS",
      description: "fast",
      available_variants: ["regression", "classification"],
    });
    expect(matchesPresetSearch(preset, "")).toBe(true);
    expect(matchesPresetSearch(preset, "quick")).toBe(true);
    expect(matchesPresetSearch(preset, "fast")).toBe(true);
    expect(matchesPresetSearch(preset, "classification")).toBe(true);
    expect(matchesPresetSearch(preset, "nope")).toBe(false);
  });

  it("falls back to task_type when variants absent", () => {
    const preset = makePreset({ available_variants: undefined, task_type: "regression" });
    expect(matchesPresetSearch(preset, "regression")).toBe(true);
  });
});

describe("sortPipelineItems", () => {
  const a = makePipeline({ id: "a", name: "Beta", runCount: 1, updatedAt: "2024-01-01T00:00:00Z", steps: [{}, {}] as never });
  const b = makePipeline({ id: "b", name: "Alpha", runCount: 5, updatedAt: "2024-03-01T00:00:00Z", steps: [{}] as never });

  it("sorts by name ascending", () => {
    expect(sortPipelineItems([a, b], "name").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("sorts by runCount descending", () => {
    expect(sortPipelineItems([a, b], "runCount").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("sorts by steps descending", () => {
    expect(sortPipelineItems([a, b], "steps").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("sorts by lastModified (newest first) and does not mutate input", () => {
    const input = [a, b];
    expect(sortPipelineItems(input, "lastModified").map((p) => p.id)).toEqual(["b", "a"]);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("sortPresetItems", () => {
  it("sorts by complexity ascending without mutating input", () => {
    const input = [makePreset({ id: "hard", complexity: 9 }), makePreset({ id: "easy", complexity: 2 })];
    expect(sortPresetItems(input).map((p) => p.id)).toEqual(["easy", "hard"]);
    expect(input.map((p) => p.id)).toEqual(["hard", "easy"]);
  });
});

describe("scoreOf", () => {
  it("prefers final_test_score, then falls through to cv scores", () => {
    expect(scoreOf(makeChain({ final_test_score: 0.9 }))).toBe(0.9);
    expect(scoreOf(makeChain({ final_agg_test_score: 0.8 }))).toBe(0.8);
    expect(scoreOf(makeChain({ cv_val_score: 0.7 }))).toBe(0.7);
    expect(scoreOf(makeChain({ cv_test_score: 0.6 }))).toBe(0.6);
    expect(scoreOf(makeChain())).toBeNull();
  });
});

describe("pickBestChain", () => {
  it("returns null for an empty list", () => {
    expect(pickBestChain([])).toBeNull();
  });

  it("returns the first chain when none are scored", () => {
    const first = makeChain({ chain_id: "first" });
    expect(pickBestChain([first, makeChain({ chain_id: "second" })])?.chain_id).toBe("first");
  });

  it("picks the highest score for higher-is-better metrics", () => {
    const chains = [
      makeChain({ chain_id: "lo", metric: "r2", final_test_score: 0.5 }),
      makeChain({ chain_id: "hi", metric: "r2", final_test_score: 0.9 }),
    ];
    expect(pickBestChain(chains)?.chain_id).toBe("hi");
  });

  it("picks the lowest score for error-like metrics", () => {
    const chains = [
      makeChain({ chain_id: "good", metric: "rmse", final_test_score: 0.1 }),
      makeChain({ chain_id: "bad", metric: "rmse", final_test_score: 0.8 }),
    ];
    expect(pickBestChain(chains)?.chain_id).toBe("good");
  });
});

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run1",
    name: "Run 1",
    status: "completed",
    created_at: "2024-01-01T00:00:00Z",
    datasets: [],
    ...overrides,
  } as Run;
}

describe("extractRecentRuns", () => {
  it("returns an empty array for missing/empty runs", () => {
    expect(extractRecentRuns(undefined, 10)).toEqual([]);
    expect(extractRecentRuns([], 10)).toEqual([]);
  });

  it("flattens runs → datasets → pipelines, sorts newest first, and respects the limit", () => {
    const runs = [
      makeRun({
        id: "old",
        created_at: "2024-01-01T00:00:00Z",
        datasets: [
          { dataset_id: "d", dataset_name: "DS", pipelines: [{ id: "pa", pipeline_id: "p", pipeline_name: "Old", status: "completed" }] },
        ] as never,
      }),
      makeRun({
        id: "new",
        started_at: "2024-06-01T00:00:00Z",
        created_at: "2024-05-01T00:00:00Z",
        datasets: [
          { dataset_id: "d", dataset_name: "DS", pipelines: [{ id: "pb", pipeline_id: "p", pipeline_name: "New", status: "running" }] },
        ] as never,
      }),
    ];
    const result = extractRecentRuns(runs, 1);
    expect(result).toHaveLength(1);
    expect(result[0].pipelineName).toBe("New");
    expect(result[0].createdAt).toBe("2024-06-01T00:00:00Z");
    expect(result[0].listKey).toBe("new:pb");
  });

  it("builds stable fallback keys when pipeline id is missing", () => {
    const runs = [
      makeRun({
        id: "r",
        datasets: [
          {
            dataset_id: "d",
            dataset_name: "DS",
            pipelines: [
              { pipeline_id: "p", pipeline_name: "A", status: "completed" },
              { pipeline_id: "p", pipeline_name: "B", status: "completed" },
            ],
          },
        ] as never,
      }),
    ];
    const keys = extractRecentRuns(runs, 10).map((r) => r.listKey);
    expect(keys).toEqual(["r:DS:p:0", "r:DS:p:1"]);
  });

  it("defaults a blank pipeline name to 'Unknown pipeline'", () => {
    const runs = [
      makeRun({
        datasets: [
          { dataset_id: "d", dataset_name: "DS", pipelines: [{ id: "x", pipeline_id: "p", pipeline_name: "", status: "completed" }] },
        ] as never,
      }),
    ];
    expect(extractRecentRuns(runs, 10)[0].pipelineName).toBe("Unknown pipeline");
  });
});

describe("filterRecentRuns", () => {
  const entries = [
    { listKey: "1", pipelineId: "p", pipelineName: "SNV Model", runId: "r", runName: "Run A", datasetName: "Corn", status: "completed", createdAt: "" },
    { listKey: "2", pipelineId: "p", pipelineName: "MSC Model", runId: "r", runName: "Run B", datasetName: "Wheat", status: "completed", createdAt: "" },
  ];

  it("returns all entries for an empty query", () => {
    expect(filterRecentRuns(entries, "")).toHaveLength(2);
  });

  it("matches pipeline name, dataset name, or run name", () => {
    expect(filterRecentRuns(entries, "snv").map((e) => e.listKey)).toEqual(["1"]);
    expect(filterRecentRuns(entries, "wheat").map((e) => e.listKey)).toEqual(["2"]);
    expect(filterRecentRuns(entries, "run a").map((e) => e.listKey)).toEqual(["1"]);
    expect(filterRecentRuns(entries, "zzz")).toHaveLength(0);
  });
});
