/**
 * Native Pipeline Format - Generator Serialization Tests
 * =======================================================
 *
 * Tests for validating that generator/workflow nodes (_or_, _cartesian_,
 * _grid_, _zip_, _chain_, _sample_, _range_, _log_range_) correctly
 * serialize and deserialize between editor format and native format.
 *
 * Run with: npx vitest run src/utils/__tests__/nativePipelineFormat.test.ts
 */

import { describe, it, expect } from "vitest";
import { toNativeFormat, fromNativeFormat, type NativePipelineStep } from "../nativePipelineFormat";
import type { PipelineStep } from "@/components/pipeline-editor/types";
import { migrateStep } from "@/components/pipeline-editor/types";

// Helper to create a minimal editor step
function makeStep(overrides: Partial<PipelineStep> & { name: string }): PipelineStep {
  return {
    id: `test-${overrides.name}-${Math.random().toString(36).slice(2, 8)}`,
    type: "preprocessing",
    params: {},
    ...overrides,
  };
}

// Helper to create a simple preprocessing step
function preprocessingStep(name: string): PipelineStep {
  return makeStep({ name, type: "preprocessing" });
}

// ============================================================================
// Editor → Native (toNativeFormat)
// ============================================================================

describe("toNativeFormat - Generator serialization", () => {
  describe("_or_ generator", () => {
    it("serializes _or_ with branches", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [
          [preprocessingStep("SNV")],
          [preprocessingStep("MSC")],
        ],
      });

      const result = toNativeFormat([step]);
      expect(result).toHaveLength(1);

      const native = result[0] as Record<string, unknown>;
      expect(native._or_).toBeDefined();
      expect(native._or_).toEqual(["SNV", "MSC"]);
    });

    it("serializes _or_ with multi-step branches", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [
          [preprocessingStep("SNV"), preprocessingStep("Detrend")],
          [preprocessingStep("MSC")],
        ],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._or_).toEqual([["SNV", "Detrend"], "MSC"]);
    });

    it("serializes _or_ with pick/arrange", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [
          [preprocessingStep("SNV")],
          [preprocessingStep("MSC")],
          [preprocessingStep("Detrend")],
        ],
        generatorOptions: { pick: 2 },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._or_).toHaveLength(3);
      expect(native.pick).toBe(2);
    });

    it("serializes _or_ with second-order selection", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [
          [preprocessingStep("SNV")],
          [preprocessingStep("MSC")],
        ],
        generatorOptions: { pick: 1, then_pick: 1 },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native.pick).toBe(1);
      expect(native.then_pick).toBe(1);
    });

    it("serializes empty _or_", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._or_).toEqual([]);
    });
  });

  describe("_cartesian_ generator", () => {
    it("serializes _cartesian_ with stages", () => {
      const step = makeStep({
        name: "Cartesian",
        type: "flow",
        subType: "generator",
        generatorKind: "cartesian",
        branches: [
          [preprocessingStep("SNV"), preprocessingStep("MSC")],
          [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
        ],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._cartesian_).toBeDefined();
      expect(native._cartesian_).toEqual([
        ["SNV", "MSC"],
        ["StandardScaler", "MinMaxScaler"],
      ]);
    });

    it("serializes _cartesian_ with pick", () => {
      const step = makeStep({
        name: "Cartesian",
        type: "flow",
        subType: "generator",
        generatorKind: "cartesian",
        branches: [
          [preprocessingStep("SNV"), preprocessingStep("MSC")],
          [preprocessingStep("StandardScaler")],
        ],
        generatorOptions: { pick: 1 },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._cartesian_).toBeDefined();
      expect(native.pick).toBe(1);
    });
  });

  describe("_grid_ generator", () => {
    it("serializes _grid_ with named branches", () => {
      const step = makeStep({
        name: "Grid",
        type: "flow",
        subType: "generator",
        generatorKind: "grid",
        branches: [
          [preprocessingStep("SNV"), preprocessingStep("MSC")],
          [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
        ],
        branchMetadata: [{ name: "preprocessing" }, { name: "scaling" }],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._grid_).toBeDefined();
      const grid = native._grid_ as Record<string, unknown[]>;
      expect(grid.preprocessing).toEqual(["SNV", "MSC"]);
      expect(grid.scaling).toEqual(["StandardScaler", "MinMaxScaler"]);
    });
  });

  describe("_zip_ generator", () => {
    it("serializes _zip_ with named branches", () => {
      const step = makeStep({
        name: "Zip",
        type: "flow",
        subType: "generator",
        generatorKind: "zip",
        branches: [
          [preprocessingStep("SNV"), preprocessingStep("MSC")],
          [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
        ],
        branchMetadata: [{ name: "transform" }, { name: "scaler" }],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._zip_).toBeDefined();
      const zip = native._zip_ as Record<string, unknown[]>;
      expect(zip.transform).toEqual(["SNV", "MSC"]);
      expect(zip.scaler).toEqual(["StandardScaler", "MinMaxScaler"]);
    });
  });

  describe("_chain_ generator", () => {
    it("serializes _chain_ with branches", () => {
      const step = makeStep({
        name: "Chain",
        type: "flow",
        subType: "generator",
        generatorKind: "chain",
        branches: [
          [preprocessingStep("SNV")],
          [preprocessingStep("MSC")],
          [preprocessingStep("Detrend")],
        ],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._chain_).toBeDefined();
      expect(native._chain_).toEqual(["SNV", "MSC", "Detrend"]);
    });
  });

  describe("_sample_ generator", () => {
    it("serializes _sample_ with distribution params", () => {
      const step = makeStep({
        name: "Sample",
        type: "flow",
        subType: "generator",
        generatorKind: "sample",
        params: {
          distribution: "uniform",
          from: 0.1,
          to: 1.0,
          num: 5,
        },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._sample_).toBeDefined();
      const sample = native._sample_ as Record<string, unknown>;
      expect(sample.distribution).toBe("uniform");
      expect(sample.from).toBe(0.1);
      expect(sample.to).toBe(1.0);
      expect(sample.num).toBe(5);
    });

    it("serializes _sample_ with normal distribution", () => {
      const step = makeStep({
        name: "Sample",
        type: "flow",
        subType: "generator",
        generatorKind: "sample",
        params: {
          distribution: "normal",
          mean: 0,
          std: 1,
          num: 10,
        },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      const sample = native._sample_ as Record<string, unknown>;
      expect(sample.distribution).toBe("normal");
      expect(sample.mean).toBe(0);
      expect(sample.std).toBe(1);
    });
  });

  describe("shared modifiers", () => {
    it("omits count when 0 or absent", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [[preprocessingStep("SNV")]],
        generatorOptions: { count: 0 },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native.count).toBeUndefined();
    });

    it("omits count from params when 0", () => {
      const step = makeStep({
        name: "Cartesian",
        type: "flow",
        subType: "generator",
        generatorKind: "cartesian",
        params: { count: 0 },
        branches: [
          [preprocessingStep("SNV")],
          [preprocessingStep("MSC")],
        ],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native.count).toBeUndefined();
    });

    it("includes count when > 0", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [
          [preprocessingStep("SNV")],
          [preprocessingStep("MSC")],
        ],
        generatorOptions: { count: 5 },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native.count).toBe(5);
    });

    it("includes count from params when > 0 and generatorOptions is empty", () => {
      const step = makeStep({
        name: "Cartesian",
        type: "flow",
        subType: "generator",
        generatorKind: "cartesian",
        params: { count: 3 },
        branches: [
          [preprocessingStep("SNV")],
          [preprocessingStep("MSC")],
        ],
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native.count).toBe(3);
    });

    it("includes seed when set", () => {
      const step = makeStep({
        name: "Or",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [[preprocessingStep("SNV")]],
        params: { _seed_: 42 },
      });

      const result = toNativeFormat([step]);
      const native = result[0] as Record<string, unknown>;
      expect(native._seed_).toBe(42);
    });
  });
});

// ============================================================================
// Native → Editor (fromNativeFormat)
// ============================================================================

describe("fromNativeFormat - Generator deserialization", () => {
  describe("_or_ generator", () => {
    it("deserializes _or_ with alternatives", () => {
      const native: NativePipelineStep[] = [
        { _or_: ["SNV", "MSC", "Detrend"] },
      ];

      const result = fromNativeFormat(native);
      expect(result).toHaveLength(1);
      expect(result[0].generatorKind).toBe("or");
      expect(result[0].subType).toBe("generator");
      expect(result[0].branches).toHaveLength(3);
      expect(result[0].branches![0][0].name).toBe("SNV");
    });

    it("deserializes _or_ with pick/arrange", () => {
      const native: NativePipelineStep[] = [
        { _or_: ["SNV", "MSC"], pick: 1, arrange: 2 },
      ];

      const result = fromNativeFormat(native);
      expect(result[0].generatorOptions?.pick).toBe(1);
      expect(result[0].generatorOptions?.arrange).toBe(2);
    });
  });

  describe("_cartesian_ generator", () => {
    it("deserializes _cartesian_ with stages", () => {
      const native: NativePipelineStep[] = [
        { _cartesian_: [["SNV", "MSC"], ["StandardScaler", "MinMaxScaler"]] },
      ];

      const result = fromNativeFormat(native);
      expect(result).toHaveLength(1);
      expect(result[0].generatorKind).toBe("cartesian");
      expect(result[0].subType).toBe("generator");
      expect(result[0].branches).toHaveLength(2);
      expect(result[0].branches![0]).toHaveLength(2);
      expect(result[0].branches![0][0].name).toBe("SNV");
      expect(result[0].branches![1][0].name).toBe("StandardScaler");
    });

    it("deserializes _cartesian_ with count", () => {
      const native: NativePipelineStep[] = [
        { _cartesian_: [["SNV"], ["MSC"]], count: 3 },
      ];

      const result = fromNativeFormat(native);
      expect(result[0].generatorOptions?.count).toBe(3);
    });
  });

  describe("_grid_ generator", () => {
    it("deserializes _grid_ with param branches", () => {
      const native: NativePipelineStep[] = [
        { _grid_: { preprocessing: ["SNV", "MSC"], scaling: ["StandardScaler", "MinMaxScaler"] } },
      ];

      const result = fromNativeFormat(native);
      expect(result).toHaveLength(1);
      expect(result[0].generatorKind).toBe("grid");
      expect(result[0].subType).toBe("generator");
      expect(result[0].branches).toHaveLength(2);
      expect(result[0].branchMetadata?.[0]?.name).toBe("preprocessing");
      expect(result[0].branchMetadata?.[1]?.name).toBe("scaling");
      expect(result[0].branches![0]).toHaveLength(2);
    });
  });

  describe("_zip_ generator", () => {
    it("deserializes _zip_ with param branches", () => {
      const native: NativePipelineStep[] = [
        { _zip_: { transform: ["SNV", "MSC"], scaler: ["StandardScaler", "MinMaxScaler"] } },
      ];

      const result = fromNativeFormat(native);
      expect(result).toHaveLength(1);
      expect(result[0].generatorKind).toBe("zip");
      expect(result[0].subType).toBe("generator");
      expect(result[0].branches).toHaveLength(2);
      expect(result[0].branchMetadata?.[0]?.name).toBe("transform");
      expect(result[0].branchMetadata?.[1]?.name).toBe("scaler");
    });
  });

  describe("_chain_ generator", () => {
    it("deserializes _chain_ with configs", () => {
      const native: NativePipelineStep[] = [
        { _chain_: ["SNV", "MSC", "Detrend"] },
      ];

      const result = fromNativeFormat(native);
      expect(result).toHaveLength(1);
      expect(result[0].generatorKind).toBe("chain");
      expect(result[0].subType).toBe("generator");
      expect(result[0].branches).toHaveLength(3);
      expect(result[0].branches![0][0].name).toBe("SNV");
    });

    it("deserializes _chain_ with multi-step configs", () => {
      const native: NativePipelineStep[] = [
        { _chain_: [["SNV", "Detrend"], "MSC"] },
      ];

      const result = fromNativeFormat(native);
      expect(result[0].branches).toHaveLength(2);
      expect(result[0].branches![0]).toHaveLength(2);
      expect(result[0].branches![1]).toHaveLength(1);
    });
  });

  describe("_sample_ generator", () => {
    it("deserializes _sample_ with uniform distribution", () => {
      const native: NativePipelineStep[] = [
        { _sample_: { distribution: "uniform", from: 0.1, to: 1.0, num: 5 } },
      ];

      const result = fromNativeFormat(native);
      expect(result).toHaveLength(1);
      expect(result[0].generatorKind).toBe("sample");
      expect(result[0].subType).toBe("generator");
      expect(result[0].params.distribution).toBe("uniform");
      expect(result[0].params.from).toBe(0.1);
      expect(result[0].params.to).toBe(1.0);
      expect(result[0].params.num).toBe(5);
    });

    it("deserializes _sample_ with normal distribution", () => {
      const native: NativePipelineStep[] = [
        { _sample_: { distribution: "normal", mean: 0, std: 1, num: 10 } },
      ];

      const result = fromNativeFormat(native);
      expect(result[0].params.distribution).toBe("normal");
      expect(result[0].params.mean).toBe(0);
      expect(result[0].params.std).toBe(1);
    });
  });
});

// ============================================================================
// Round-trip tests (editor → native → editor)
// ============================================================================

describe("Generator round-trip tests", () => {
  it("_or_ round-trips correctly", () => {
    const original = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
      generatorKind: "or",
      branches: [
        [preprocessingStep("SNV")],
        [preprocessingStep("MSC")],
      ],
      generatorOptions: { pick: 1 },
    });

    const native = toNativeFormat([original]);
    const restored = fromNativeFormat(native);

    expect(restored).toHaveLength(1);
    expect(restored[0].generatorKind).toBe("or");
    expect(restored[0].branches).toHaveLength(2);
    expect(restored[0].branches![0][0].name).toBe("SNV");
    expect(restored[0].branches![1][0].name).toBe("MSC");
    expect(restored[0].generatorOptions?.pick).toBe(1);
  });

  it("_cartesian_ round-trips correctly", () => {
    const original = makeStep({
      name: "Cartesian",
      type: "flow",
      subType: "generator",
      generatorKind: "cartesian",
      branches: [
        [preprocessingStep("SNV"), preprocessingStep("MSC")],
        [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
      ],
    });

    const native = toNativeFormat([original]);
    const restored = fromNativeFormat(native);

    expect(restored).toHaveLength(1);
    expect(restored[0].generatorKind).toBe("cartesian");
    expect(restored[0].branches).toHaveLength(2);
    expect(restored[0].branches![0]).toHaveLength(2);
    expect(restored[0].branches![0][0].name).toBe("SNV");
    expect(restored[0].branches![1][0].name).toBe("StandardScaler");
  });

  it("_grid_ round-trips correctly", () => {
    const original = makeStep({
      name: "Grid",
      type: "flow",
      subType: "generator",
      generatorKind: "grid",
      branches: [
        [preprocessingStep("SNV"), preprocessingStep("MSC")],
        [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
      ],
      branchMetadata: [{ name: "preprocessing" }, { name: "scaling" }],
    });

    const native = toNativeFormat([original]);
    const restored = fromNativeFormat(native);

    expect(restored).toHaveLength(1);
    expect(restored[0].generatorKind).toBe("grid");
    expect(restored[0].branches).toHaveLength(2);
    expect(restored[0].branchMetadata?.[0]?.name).toBe("preprocessing");
    expect(restored[0].branchMetadata?.[1]?.name).toBe("scaling");
    expect(restored[0].branches![0][0].name).toBe("SNV");
  });

  it("_zip_ round-trips correctly", () => {
    const original = makeStep({
      name: "Zip",
      type: "flow",
      subType: "generator",
      generatorKind: "zip",
      branches: [
        [preprocessingStep("SNV"), preprocessingStep("MSC")],
        [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
      ],
      branchMetadata: [{ name: "transform" }, { name: "scaler" }],
    });

    const native = toNativeFormat([original]);
    const restored = fromNativeFormat(native);

    expect(restored).toHaveLength(1);
    expect(restored[0].generatorKind).toBe("zip");
    expect(restored[0].branches).toHaveLength(2);
    expect(restored[0].branchMetadata?.[0]?.name).toBe("transform");
    expect(restored[0].branchMetadata?.[1]?.name).toBe("scaler");
  });

  it("_chain_ round-trips correctly", () => {
    const original = makeStep({
      name: "Chain",
      type: "flow",
      subType: "generator",
      generatorKind: "chain",
      branches: [
        [preprocessingStep("SNV")],
        [preprocessingStep("MSC")],
        [preprocessingStep("Detrend")],
      ],
    });

    const native = toNativeFormat([original]);
    const restored = fromNativeFormat(native);

    expect(restored).toHaveLength(1);
    expect(restored[0].generatorKind).toBe("chain");
    expect(restored[0].branches).toHaveLength(3);
    expect(restored[0].branches![0][0].name).toBe("SNV");
    expect(restored[0].branches![2][0].name).toBe("Detrend");
  });

  it("_sample_ round-trips correctly", () => {
    const original = makeStep({
      name: "Sample",
      type: "flow",
      subType: "generator",
      generatorKind: "sample",
      params: {
        distribution: "uniform",
        from: 0.1,
        to: 1.0,
        num: 5,
      },
    });

    const native = toNativeFormat([original]);
    const restored = fromNativeFormat(native);

    expect(restored).toHaveLength(1);
    expect(restored[0].generatorKind).toBe("sample");
    expect(restored[0].params.distribution).toBe("uniform");
    expect(restored[0].params.from).toBe(0.1);
    expect(restored[0].params.to).toBe(1.0);
    expect(restored[0].params.num).toBe(5);
  });

  it("count is preserved through round-trip when > 0", () => {
    const original = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
      generatorKind: "or",
      branches: [
        [preprocessingStep("SNV")],
        [preprocessingStep("MSC")],
      ],
      generatorOptions: { count: 5 },
    });

    const native = toNativeFormat([original]);
    const nativeStep = native[0] as Record<string, unknown>;
    expect(nativeStep.count).toBe(5);

    const restored = fromNativeFormat(native);
    expect(restored[0].generatorOptions?.count).toBe(5);
  });

  it("seed is preserved through round-trip", () => {
    const original = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
      generatorKind: "or",
      branches: [[preprocessingStep("SNV")]],
      params: { _seed_: 42 },
    });

    const native = toNativeFormat([original]);
    const nativeStep = native[0] as Record<string, unknown>;
    expect(nativeStep._seed_).toBe(42);
  });
});

// ============================================================================
// migrateStep tests
// ============================================================================

describe("migrateStep - backfills missing fields", () => {
  it("backfills generatorKind for Cartesian step", () => {
    const step = makeStep({
      name: "Cartesian",
      type: "flow",
      subType: "generator",
      // generatorKind is missing!
    });

    const migrated = migrateStep(step);
    expect(migrated.generatorKind).toBe("cartesian");
  });

  it("backfills generatorKind for Or step", () => {
    const step = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
    });

    const migrated = migrateStep(step);
    expect(migrated.generatorKind).toBe("or");
  });

  it("backfills generatorKind for Grid step", () => {
    const step = makeStep({
      name: "Grid",
      type: "flow",
      subType: "generator",
    });

    const migrated = migrateStep(step);
    expect(migrated.generatorKind).toBe("grid");
  });

  it("backfills generatorKind for Zip step", () => {
    const migrated = migrateStep(makeStep({ name: "Zip", type: "flow", subType: "generator" }));
    expect(migrated.generatorKind).toBe("zip");
  });

  it("backfills generatorKind for Chain step", () => {
    const migrated = migrateStep(makeStep({ name: "Chain", type: "flow", subType: "generator" }));
    expect(migrated.generatorKind).toBe("chain");
  });

  it("backfills generatorKind for Sample step", () => {
    const migrated = migrateStep(makeStep({ name: "Sample", type: "flow", subType: "generator" }));
    expect(migrated.generatorKind).toBe("sample");
  });

  it("does not overwrite existing generatorKind", () => {
    const step = makeStep({
      name: "Cartesian",
      type: "flow",
      subType: "generator",
      generatorKind: "cartesian",
    });

    const migrated = migrateStep(step);
    expect(migrated.generatorKind).toBe("cartesian");
  });

  it("backfills subType from name", () => {
    const step = makeStep({
      name: "Cartesian",
      type: "flow",
      // subType is missing!
    });

    const migrated = migrateStep(step);
    expect(migrated.subType).toBe("generator");
    expect(migrated.generatorKind).toBe("cartesian");
  });

  it("recursively migrates branches", () => {
    const step = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
      branches: [
        [makeStep({ name: "Cartesian", type: "flow", subType: "generator" })],
      ],
    });

    const migrated = migrateStep(step);
    expect(migrated.generatorKind).toBe("or");
    expect(migrated.branches![0][0].generatorKind).toBe("cartesian");
  });

  it("does not modify non-generator steps", () => {
    const step = makeStep({ name: "SNV", type: "preprocessing" });
    const migrated = migrateStep(step);
    expect(migrated.generatorKind).toBeUndefined();
    expect(migrated).toEqual(step);
  });
});
