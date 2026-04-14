import { describe, it, expect } from "vitest";
import { allNodes, canonicalNodes } from "@/data/nodes/definitions";
import type { NodeDefinition } from "@/data/nodes/types";

const VALID_TYPES = [
  "preprocessing",
  "y_processing",
  "splitting",
  "model",
  "augmentation",
  "filter",
  "flow",
  "utility",
];
const VALID_SOURCES = ["sklearn", "nirs4all", "custom", "editor"];
const VALID_PARAM_TYPES = [
  "int",
  "float",
  "bool",
  "string",
  "select",
  "range",
  "array",
  "object",
  "metadata_column",
];
const VALID_FINETUNE_TYPES = ["int", "float", "log_float", "categorical"];

// Nodes that are genuinely parameterless
const KNOWN_PARAMETERLESS = new Set([
  "preprocessing.haar",
  "preprocessing.maxabs_scaler",
  "model.tabpfn",
  "splitting.leave_one_out",
]);

const EXPECTED_SPLIT_GROUPING: Record<
  string,
  { groupRequired: boolean; groupHandling: "native" | "wrapper" }
> = {
  "splitting.kfold": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.repeated_kfold": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.shuffle_split": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.stratified_kfold": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.leave_one_out": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.group_kfold": { groupRequired: true, groupHandling: "native" },
  "splitting.group_shuffle_split": { groupRequired: true, groupHandling: "native" },
  "splitting.leave_one_group_out": { groupRequired: true, groupHandling: "native" },
  "splitting.leave_p_groups_out": { groupRequired: true, groupHandling: "native" },
  "splitting.leave_p_out": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.predefined_split": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.repeated_stratified_k_fold": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.stratified_group_k_fold": { groupRequired: true, groupHandling: "native" },
  "splitting.stratified_shuffle_split": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.time_series_split": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.kennard_stone": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.spxy": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.spxy_gfold": { groupRequired: true, groupHandling: "native" },
  "splitting.kmeans_splitter": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.split_splitter": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.kbins_stratified": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.binned_stratified_group_kfold": { groupRequired: true, groupHandling: "native" },
  "splitting.systematic_circular": { groupRequired: false, groupHandling: "wrapper" },
  "splitting.spxy_fold": { groupRequired: false, groupHandling: "wrapper" },
};

describe("Node Definitions - Structural validation", () => {
  it("has at least 320 curated nodes", () => {
    expect(allNodes.length).toBeGreaterThanOrEqual(320);
  });

  it.each(allNodes.map((n) => [n.id, n]))(
    "%s has all required fields",
    (_id, node) => {
      const n = node as NodeDefinition;
      expect(n.id).toBeTruthy();
      expect(n.name).toBeTruthy();
      expect(n.type).toBeTruthy();
      expect(n.description).toBeTruthy();
      expect(Array.isArray(n.parameters)).toBe(true);
      expect(n.source).toBeTruthy();
    }
  );

  it("all IDs match required format", () => {
    const idPattern = /^[a-z_]+\.[a-z0-9_]+$/;
    for (const node of allNodes) {
      expect(node.id).toMatch(idPattern);
    }
  });

  it("all types are valid", () => {
    for (const node of allNodes) {
      expect(VALID_TYPES).toContain(node.type);
    }
  });

  it("all sources are valid", () => {
    for (const node of allNodes) {
      expect(VALID_SOURCES).toContain(node.source);
    }
  });

  it("all parameter types are valid", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        expect(VALID_PARAM_TYPES, `${node.id}.${param.name}`).toContain(
          param.type
        );
      }
    }
  });

  it("select-type params have options", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (param.type === "select") {
          expect(
            Array.isArray(param.options) && param.options.length > 0,
            `${node.id}.${param.name} should have options`
          ).toBe(true);
        }
      }
    }
  });

  it("numeric params with min and max have min <= max", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (
          (param.type === "int" || param.type === "float") &&
          param.min != null &&
          param.max != null
        ) {
          expect(
            param.min <= param.max,
            `${node.id}.${param.name}: min(${param.min}) > max(${param.max})`
          ).toBe(true);
        }
      }
    }
  });

  it("no duplicate node IDs", () => {
    const ids = allNodes.map((n) => n.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("all curated splitters expose webapp grouping metadata", () => {
    const splitters = allNodes.filter((n) => n.type === "splitting");
    expect(splitters.length).toBe(Object.keys(EXPECTED_SPLIT_GROUPING).length);

    for (const splitter of splitters) {
      expect(splitter._webapp_split, `${splitter.id} missing _webapp_split`).toBeDefined();
      expect(splitter._webapp_split?.runtimeOnlyParams).toContain("group_by");
      expect(["native", "wrapper"]).toContain(splitter._webapp_split?.groupHandling);
    }
  });

  it("splitter grouping metadata matches the library contract", () => {
    for (const [nodeId, expected] of Object.entries(EXPECTED_SPLIT_GROUPING)) {
      const splitter = allNodes.find((node) => node.id === nodeId);
      expect(splitter, `${nodeId} missing from curated registry`).toBeDefined();
      expect(splitter?._webapp_split).toEqual({
        ...expected,
        runtimeOnlyParams: ["group_by"],
      });
    }
  });
});

describe("Node Definitions - Finetuning configuration", () => {
  it("finetunable params have finetuneType and finetuneRange", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (param.finetunable) {
          expect(
            VALID_FINETUNE_TYPES,
            `${node.id}.${param.name} finetuneType`
          ).toContain(param.finetuneType);
          expect(
            Array.isArray(param.finetuneRange) &&
              param.finetuneRange.length === 2,
            `${node.id}.${param.name} finetuneRange`
          ).toBe(true);
        }
      }
    }
  });

  it("finetuneRange[0] < finetuneRange[1]", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (param.finetunable && param.finetuneRange) {
          expect(
            param.finetuneRange[0] < param.finetuneRange[1],
            `${node.id}.${param.name}: range [${param.finetuneRange}]`
          ).toBe(true);
        }
      }
    }
  });

  it("finetuneRange is within param min/max bounds", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (param.finetunable && param.finetuneRange) {
          if (param.min != null) {
            expect(
              param.finetuneRange[0] >= param.min,
              `${node.id}.${param.name}: finetuneRange[0](${param.finetuneRange[0]}) < min(${param.min})`
            ).toBe(true);
          }
          if (param.max != null) {
            expect(
              param.finetuneRange[1] <= param.max,
              `${node.id}.${param.name}: finetuneRange[1](${param.finetuneRange[1]}) > max(${param.max})`
            ).toBe(true);
          }
        }
      }
    }
  });

  it("nodes with supportsFinetuning have finetunable params", () => {
    for (const node of allNodes) {
      if (node.supportsFinetuning) {
        const hasFinetunable = node.parameters.some((p) => p.finetunable);
        expect(
          hasFinetunable,
          `${node.id} has supportsFinetuning but no finetunable params`
        ).toBe(true);
      }
    }
  });

  it("most model nodes have finetuning configured", () => {
    const models = allNodes.filter((n) => n.type === "model");
    const withFinetuning = models.filter((n) => n.supportsFinetuning);
    const ratio = withFinetuning.length / models.length;
    expect(ratio).toBeGreaterThan(0.5);
  });

  it("at least 25 nodes total have finetuning", () => {
    const withFinetuning = allNodes.filter((n) => n.supportsFinetuning);
    expect(withFinetuning.length).toBeGreaterThanOrEqual(25);
  });
});

describe("Node Definitions - Sweep preset validation", () => {
  it("nodes with supportsParameterSweeps have sweepable params", () => {
    for (const node of allNodes) {
      if (node.supportsParameterSweeps && node.parameters.length > 0) {
        const hasSweepable = node.parameters.some((p) => p.sweepable);
        // Allow nodes that only have bool/select params (those are sweepable as generators)
        if (!hasSweepable) {
          const hasOnlyBoolSelect = node.parameters.every(
            (p) =>
              p.type === "bool" ||
              p.type === "select" ||
              p.isAdvanced ||
              p.isHidden
          );
          expect(
            hasOnlyBoolSelect,
            `${node.id} has supportsParameterSweeps but no sweepable params`
          ).toBe(true);
        }
      }
    }
  });

  it("sweepPresets have valid structure", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (param.sweepPresets) {
          expect(
            Array.isArray(param.sweepPresets),
            `${node.id}.${param.name} sweepPresets`
          ).toBe(true);
          for (const preset of param.sweepPresets) {
            expect(preset.label).toBeTruthy();
            expect(["range", "choices"]).toContain(preset.type);
            expect(preset.values).toBeDefined();
          }
        }
      }
    }
  });

  it("at least 10 nodes have sweep presets", () => {
    const withPresets = allNodes.filter((n) =>
      n.parameters.some((p) => p.sweepPresets && p.sweepPresets.length > 0)
    );
    expect(withPresets.length).toBeGreaterThanOrEqual(10);
  });
});

describe("Node Definitions - Parameter quality", () => {
  it("no exposed copy/verbose/n_jobs params", () => {
    const forbidden = ["copy", "verbose", "n_jobs"];
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (forbidden.includes(param.name)) {
          expect(
            param.isAdvanced || param.isHidden,
            `${node.id}.${param.name} should be isAdvanced or isHidden`
          ).toBe(true);
        }
      }
    }
  });

  it("random_state params are advanced", () => {
    for (const node of allNodes) {
      for (const param of node.parameters) {
        if (param.name === "random_state") {
          expect(
            param.isAdvanced === true,
            `${node.id}.random_state should be isAdvanced`
          ).toBe(true);
        }
      }
    }
  });

  it("sweepable nodes have params (except known parameterless)", () => {
    for (const node of allNodes) {
      if (
        node.supportsParameterSweeps &&
        node.parameters.length === 0 &&
        !KNOWN_PARAMETERLESS.has(node.id)
      ) {
        expect(
          false,
          `${node.id} has supportsParameterSweeps but empty params`
        ).toBe(true);
      }
    }
  });
});

describe("Node Definitions - Coverage statistics", () => {
  it("reports node counts by type", () => {
    const counts: Record<string, number> = {};
    for (const node of allNodes) {
      counts[node.type] = (counts[node.type] || 0) + 1;
    }
    console.log("\n  Node counts by type:", counts);
    console.log("  Total:", allNodes.length);

    const fineTuned = allNodes.filter((n) => n.supportsFinetuning).length;
    const withSweepPresets = allNodes.filter((n) =>
      n.parameters.some((p) => p.sweepPresets?.length)
    ).length;
    console.log("  With finetuning:", fineTuned);
    console.log("  With sweep presets:", withSweepPresets);
  });
});

describe("Node Definitions - Cross-reference with canonical registry", () => {
  it("curated nirs4all/sklearn nodes exist in canonical registry", () => {
    const canonicalPaths = new Set(canonicalNodes.map((n) => n.classPath));
    const canonicalIds = new Set(canonicalNodes.map((n) => n.id));

    let missingCount = 0;
    const missing: string[] = [];

    for (const node of allNodes) {
      if (
        node.source === "nirs4all" ||
        node.source === "sklearn"
      ) {
        const found =
          canonicalPaths.has(node.classPath) || canonicalIds.has(node.id);
        if (!found && node.type !== "flow" && node.type !== "utility") {
          missing.push(`${node.id} (${node.classPath})`);
          missingCount++;
        }
      }
    }

    if (missing.length > 0) {
      console.log("\n  Curated nodes not in canonical:", missing);
    }
    // Allow mismatches (nirs4all operators not in canonical, DL, meta, etc.)
    expect(missingCount).toBeLessThan(70);
  });
});
