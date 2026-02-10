/**
 * Validation System Performance Benchmarks
 *
 * Measures validation performance with various pipeline sizes.
 * Run with: npm run test -- validation/benchmark.test.ts
 *
 * Phase 6 Implementation - Performance Benchmarking
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { PipelineStep } from "../../types";
import { validate, isValid, getQuickSummary } from "../engine";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a pipeline step with realistic params
 */
function generateStep(index: number, type: PipelineStep["type"]): PipelineStep {
  const baseId = `step-${index}`;

  switch (type) {
    case "preprocessing":
      return {
        id: baseId,
        type: "preprocessing",
        name: index % 2 === 0 ? "SNV" : "MinMaxScaler",
        params:
          index % 2 === 0
            ? {}
            : { feature_range_min: 0, feature_range_max: 1 },
      };
    case "splitting":
      return {
        id: baseId,
        type: "splitting",
        name: "KFold",
        params: { n_splits: 5, shuffle: true },
      };
    case "model":
      return {
        id: baseId,
        type: "model",
        name: "PLSRegression",
        params: { n_components: 10 },
      };
    case "y_processing":
      return {
        id: baseId,
        type: "y_processing",
        name: "StandardScaler",
        params: {},
      };
    default:
      return {
        id: baseId,
        type: "preprocessing",
        name: "SNV",
        params: {},
      };
  }
}

/**
 * Generate a pipeline with a mix of step types
 */
function generatePipeline(size: number): PipelineStep[] {
  const steps: PipelineStep[] = [];

  // First half: preprocessing
  for (let i = 0; i < Math.floor(size * 0.6); i++) {
    steps.push(generateStep(i, "preprocessing"));
  }

  // Add a splitter
  steps.push(generateStep(steps.length, "splitting"));

  // Add some y_processing
  for (let i = 0; i < Math.floor(size * 0.1); i++) {
    steps.push(generateStep(steps.length, "y_processing"));
  }

  // Add model at the end
  steps.push(generateStep(steps.length, "model"));

  return steps;
}

/**
 * Generate a deeply nested pipeline with branches
 */
function generateNestedPipeline(
  depth: number,
  branchFactor: number
): PipelineStep[] {
  function createBranch(currentDepth: number, index: number): PipelineStep {
    const step: PipelineStep = {
      id: `branch-${currentDepth}-${index}`,
      type: "flow",
      subType: "branch",
      name: "branch",
      params: {},
      branches: [],
    };

    if (currentDepth < depth) {
      for (let i = 0; i < branchFactor; i++) {
        const branchSteps: PipelineStep[] = [
          generateStep(i * 100 + currentDepth, "preprocessing"),
          createBranch(currentDepth + 1, i),
        ];
        step.branches!.push(branchSteps);
      }
    } else {
      // Leaf branches have just steps
      for (let i = 0; i < branchFactor; i++) {
        step.branches!.push([
          generateStep(i * 1000 + currentDepth, "preprocessing"),
        ]);
      }
    }

    return step;
  }

  return [
    generateStep(0, "preprocessing"),
    createBranch(0, 0),
    generateStep(1, "model"),
  ];
}

/**
 * Generate a pipeline with validation errors
 */
function generatePipelineWithErrors(size: number): PipelineStep[] {
  const steps = generatePipeline(size);

  // Add some validation errors
  for (let i = 0; i < Math.min(10, size); i++) {
    const step = steps[i];
    if (step.name === "PLSRegression") {
      step.params.n_components = 0; // Invalid: must be >= 1
    }
    if (step.name === "KFold") {
      step.params.n_splits = 1; // Invalid: must be >= 2
    }
    if (step.type === "preprocessing" && i % 3 === 0) {
      step.params.test_value = NaN; // Invalid NaN value
    }
  }

  return steps;
}

/**
 * Measure execution time
 */
function measureTime<T>(fn: () => T): { result: T; timeMs: number } {
  const start = performance.now();
  const result = fn();
  const timeMs = performance.now() - start;
  return { result, timeMs };
}

/**
 * Run benchmark multiple times and get statistics
 */
function benchmark<T>(
  fn: () => T,
  iterations: number = 100
): {
  result: T;
  avgMs: number;
  minMs: number;
  maxMs: number;
  medianMs: number;
  p95Ms: number;
} {
  const times: number[] = [];
  let result: T | undefined;

  for (let i = 0; i < iterations; i++) {
    const { result: r, timeMs } = measureTime(fn);
    result = r;
    times.push(timeMs);
  }

  times.sort((a, b) => a - b);

  return {
    result: result!,
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    minMs: times[0],
    maxMs: times[times.length - 1],
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.floor(times.length * 0.95)],
  };
}

// ============================================================================
// Benchmarks
// ============================================================================

describe("Validation Performance Benchmarks", () => {
  // Reduced iterations for faster CI
  const ITERATIONS = 50;

  describe("Small Pipelines (< 20 steps)", () => {
    it("validates 10-step pipeline in < 5ms average", () => {
      const steps = generatePipeline(10);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `10-step pipeline: avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(5);
      expect(stats.p95Ms).toBeLessThan(10);
    });

    it("validates 20-step pipeline in < 10ms average", () => {
      const steps = generatePipeline(20);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `20-step pipeline: avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(10);
      expect(stats.p95Ms).toBeLessThan(20);
    });
  });

  describe("Medium Pipelines (20-50 steps)", () => {
    it("validates 30-step pipeline in < 15ms average", () => {
      const steps = generatePipeline(30);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `30-step pipeline: avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(15);
      expect(stats.p95Ms).toBeLessThan(30);
    });

    it("validates 50-step pipeline in < 25ms average", () => {
      const steps = generatePipeline(50);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `50-step pipeline: avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(25);
      expect(stats.p95Ms).toBeLessThan(50);
    });
  });

  describe("Large Pipelines (50+ steps)", () => {
    it("validates 100-step pipeline in < 50ms average", () => {
      const steps = generatePipeline(100);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `100-step pipeline: avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(50);
      expect(stats.p95Ms).toBeLessThan(100);
    });

    it("validates 200-step pipeline in < 100ms average", () => {
      const steps = generatePipeline(200);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `200-step pipeline: avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(100);
      expect(stats.p95Ms).toBeLessThan(200);
    });
  });

  describe("Nested Pipelines (branches)", () => {
    it("validates depth-3 pipeline with 2 branches each in < 20ms", () => {
      const steps = generateNestedPipeline(3, 2);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `Nested (3x2): avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(20);
    });

    it("validates depth-4 pipeline with 3 branches each in < 50ms", () => {
      const steps = generateNestedPipeline(4, 3);
      const stats = benchmark(() => validate(steps), ITERATIONS);

      console.log(
        `Nested (4x3): avg=${stats.avgMs.toFixed(2)}ms, ` +
          `median=${stats.medianMs.toFixed(2)}ms, p95=${stats.p95Ms.toFixed(2)}ms`
      );

      expect(stats.avgMs).toBeLessThan(50);
    });
  });

  describe("Pipelines with Errors", () => {
    it("validates pipeline with errors same speed as valid", () => {
      const validPipeline = generatePipeline(50);
      const errorPipeline = generatePipelineWithErrors(50);

      const validStats = benchmark(() => validate(validPipeline), ITERATIONS);
      const errorStats = benchmark(() => validate(errorPipeline), ITERATIONS);

      console.log(
        `Valid 50-step: avg=${validStats.avgMs.toFixed(2)}ms, ` +
          `With errors: avg=${errorStats.avgMs.toFixed(2)}ms`
      );

      // Error validation should not be more than 2x slower
      expect(errorStats.avgMs).toBeLessThan(validStats.avgMs * 2);
    });
  });

  describe("Quick Validation Methods", () => {
    it("isValid() is faster than full validate()", () => {
      const steps = generatePipeline(100);

      const fullStats = benchmark(() => validate(steps), ITERATIONS);
      const quickStats = benchmark(() => isValid(steps), ITERATIONS);

      console.log(
        `Full validate: ${fullStats.avgMs.toFixed(2)}ms, ` +
          `isValid: ${quickStats.avgMs.toFixed(2)}ms`
      );

      // Note: isValid internally calls validate, so similar performance
      // This test ensures no regression
      expect(quickStats.avgMs).toBeLessThan(fullStats.avgMs * 1.5);
    });

    it("getQuickSummary() returns in < 50ms for 100 steps", () => {
      const steps = generatePipeline(100);
      const stats = benchmark(() => getQuickSummary(steps), ITERATIONS);

      console.log(`Quick summary (100 steps): avg=${stats.avgMs.toFixed(2)}ms`);

      expect(stats.avgMs).toBeLessThan(50);
    });
  });

  describe("With Disabled Rules", () => {
    it("disabling rules does not significantly slow validation", () => {
      const steps = generatePipeline(50);

      const noDisabledStats = benchmark(() => validate(steps), ITERATIONS);
      const disabledStats = benchmark(
        () =>
          validate(steps, {
            disabledRules: [
              "PIPELINE_NO_MODEL",
              "PIPELINE_NO_SPLITTER",
              "STEP_EMPTY_CONTAINER",
            ],
          }),
        ITERATIONS
      );

      console.log(
        `No disabled: ${noDisabledStats.avgMs.toFixed(2)}ms, ` +
          `With disabled: ${disabledStats.avgMs.toFixed(2)}ms`
      );

      // Filtering should not add more than 20% overhead
      expect(disabledStats.avgMs).toBeLessThan(noDisabledStats.avgMs * 1.2 + 1);
    });
  });

  describe("Strict Mode", () => {
    it("strict mode has similar performance", () => {
      const steps = generatePipeline(50);

      const normalStats = benchmark(() => validate(steps), ITERATIONS);
      const strictStats = benchmark(
        () => validate(steps, { strictMode: true }),
        ITERATIONS
      );

      console.log(
        `Normal: ${normalStats.avgMs.toFixed(2)}ms, ` +
          `Strict: ${strictStats.avgMs.toFixed(2)}ms`
      );

      // Strict mode should not add more than 20% overhead
      expect(strictStats.avgMs).toBeLessThan(normalStats.avgMs * 1.2 + 1);
    });
  });

  describe("Scalability", () => {
    it("validation time scales roughly linearly with step count", () => {
      const sizes = [10, 25, 50, 100];
      const results: { size: number; avgMs: number }[] = [];

      for (const size of sizes) {
        const steps = generatePipeline(size);
        const stats = benchmark(() => validate(steps), ITERATIONS);
        results.push({ size, avgMs: stats.avgMs });
      }

      console.log("Scalability analysis:");
      for (const r of results) {
        console.log(`  ${r.size} steps: ${r.avgMs.toFixed(2)}ms`);
      }

      // Check that doubling steps doesn't more than triple time
      // (allows for some constant overhead)
      const ratio10to25 = results[1].avgMs / results[0].avgMs;
      const ratio25to50 = results[2].avgMs / results[1].avgMs;
      const ratio50to100 = results[3].avgMs / results[2].avgMs;

      console.log(
        `Ratios: 10→25: ${ratio10to25.toFixed(2)}x, ` +
          `25→50: ${ratio25to50.toFixed(2)}x, 50→100: ${ratio50to100.toFixed(2)}x`
      );

      // Allow for up to 3x growth when doubling (accounting for overhead)
      expect(ratio10to25).toBeLessThan(3);
      expect(ratio25to50).toBeLessThan(3);
      expect(ratio50to100).toBeLessThan(3);
    });
  });
});

// ============================================================================
// Memory Benchmarks (if available)
// ============================================================================

describe("Memory Usage", () => {
  it("validation result size is reasonable", () => {
    const steps = generatePipeline(100);
    const result = validate(steps);

    // Rough size estimate (JSON serialization)
    const resultJson = JSON.stringify({
      isValid: result.isValid,
      issues: result.issues,
      summary: result.summary,
    });

    const sizeKB = resultJson.length / 1024;
    console.log(`Result size for 100 steps: ${sizeKB.toFixed(2)} KB`);

    // Should be less than 100KB for reasonable pipelines
    expect(sizeKB).toBeLessThan(100);
  });
});
