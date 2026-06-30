import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  buildDatasetSchemaTargetProjection,
  buildDatasetTargetRefs,
  getDefaultDatasetTargetColumn,
  normalizeDatasetSchemaTaskType,
} from "../datasetSchemaTargets";

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "corn",
    name: "Corn",
    path: "/data/corn.csv",
    linked_at: "2026-01-01T00:00:00",
    task_type: "regression",
    default_target: "protein",
    targets: [
      {
        column: "protein",
        type: "regression",
        unit: "%",
        label: "Protein",
      },
      {
        column: "moisture",
        type: "regression",
        unit: "%",
      },
    ],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
    },
    ...overrides,
  };
}

describe("datasetSchemaTargets", () => {
  it("normalizes known and unknown dataset schema task types", () => {
    expect(normalizeDatasetSchemaTaskType("auto")).toBe("auto");
    expect(normalizeDatasetSchemaTaskType("regression")).toBe("regression");
    expect(normalizeDatasetSchemaTaskType("classification")).toBe("classification");
    expect(normalizeDatasetSchemaTaskType("binary_classification")).toBe("binary_classification");
    expect(normalizeDatasetSchemaTaskType("multiclass_classification")).toBe("multiclass_classification");
    expect(normalizeDatasetSchemaTaskType("unsupported")).toBe("unknown");
    expect(normalizeDatasetSchemaTaskType(undefined)).toBe("unknown");
  });

  it("selects explicit, marked, first, or missing default target columns", () => {
    expect(getDefaultDatasetTargetColumn(dataset(), ["protein", "moisture"])).toBe("protein");
    expect(getDefaultDatasetTargetColumn(dataset({
      default_target: undefined,
      targets: undefined,
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        targets: [
          { column: "protein", type: "regression" },
          { column: "moisture", type: "regression", is_default: true },
        ],
      },
    }), ["protein", "moisture"])).toBe("moisture");
    expect(getDefaultDatasetTargetColumn(dataset({ default_target: undefined }), ["protein"])).toBe("protein");
    expect(getDefaultDatasetTargetColumn(dataset({ default_target: undefined, targets: undefined }), [])).toBe(null);
  });

  it("builds target refs with dataset-level target metadata overriding config targets", () => {
    const targetRefs = buildDatasetTargetRefs(
      dataset({
        task_type: "regression",
        targets: [
          {
            column: "protein",
            type: "binary_classification",
            label: "Protein class",
          },
        ],
        config: {
          delimiter: ",",
          decimal_separator: ".",
          has_header: true,
          targets: [
            {
              column: "protein",
              type: "regression",
              unit: "%",
              label: "Protein %",
            },
            {
              column: "moisture",
              type: "auto",
              unit: "%",
            },
            {
              column: "ash",
              type: "classification",
              label: "Ash class",
            },
          ],
        },
      }),
      ["protein", "moisture", "ash"],
      "moisture",
      "regression",
    );

    expect(targetRefs).toEqual([
      {
        column: "protein",
        label: "Protein class",
        taskType: "binary_classification",
        isDefault: false,
      },
      {
        column: "moisture",
        label: "moisture",
        taskType: "auto",
        unit: "%",
        isDefault: true,
      },
      {
        column: "ash",
        label: "Ash class",
        taskType: "classification",
        isDefault: false,
      },
    ]);
  });

  it("builds the complete target projection consumed by dataset schema refs", () => {
    expect(buildDatasetSchemaTargetProjection(dataset())).toEqual({
      targetColumns: ["protein", "moisture"],
      defaultTargetColumn: "protein",
      taskType: "regression",
      targetRefs: [
        {
          column: "protein",
          label: "Protein",
          taskType: "regression",
          unit: "%",
          isDefault: true,
        },
        {
          column: "moisture",
          label: "moisture",
          taskType: "regression",
          unit: "%",
          isDefault: false,
        },
      ],
    });
  });
});
