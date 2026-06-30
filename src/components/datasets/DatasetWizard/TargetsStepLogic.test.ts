import { describe, expect, it } from "vitest";
import type { TargetConfig } from "@/types/datasets";
import {
  getAggregationMethodAdjustment,
  isTargetTypeModified,
  parseColumnsFromData,
  parseTargetNumber,
  resetTargetType,
  syncTargetsWithDetectedColumns,
  type DetectedColumn,
} from "./TargetsStepLogic";

const detectedColumn = (column: Partial<DetectedColumn> & Pick<DetectedColumn, "name">): DetectedColumn => ({
  type: "numeric",
  inferred_task_type: "regression",
  ...column,
});

describe("TargetsStepLogic column parsing", () => {
  it("parses decimal comma values for numeric target projection", () => {
    expect(parseTargetNumber("1,25", ",")).toBe(1.25);

    const [column] = parseColumnsFromData(
      ["moisture"],
      [["1,25"], ["2,50"], ["1,875"]],
      ","
    );

    expect(column).toMatchObject({
      name: "moisture",
      type: "numeric",
      unique_values: 3,
      min: 1.25,
      max: 2.5,
      mean: 1.875,
      inferred_task_type: "regression",
    });
  });

  it("infers binary and multiclass categorical targets", () => {
    const columns = parseColumnsFromData(
      ["pass_fail", "quality", "notes"],
      [
        ["pass", "low", "long free text row 1"],
        ["fail", "medium", "long free text row 2"],
        ["pass", "high", "long free text row 3"],
      ]
    );

    expect(columns[0]).toMatchObject({
      name: "pass_fail",
      type: "categorical",
      classes: ["pass", "fail"],
      inferred_task_type: "binary_classification",
    });
    expect(columns[1]).toMatchObject({
      name: "quality",
      type: "categorical",
      classes: ["low", "medium", "high"],
      inferred_task_type: "multiclass_classification",
    });
    expect(columns[2]).toMatchObject({
      name: "notes",
      type: "categorical",
      inferred_task_type: "multiclass_classification",
    });
  });

  it("infers numeric binary class labels from small integer values", () => {
    const [column] = parseColumnsFromData(
      ["approved"],
      [["0"], ["1"], ["1"], ["0"]]
    );

    expect(column).toMatchObject({
      type: "numeric",
      unique_values: 2,
      inferred_task_type: "binary_classification",
    });
  });
});

describe("TargetsStepLogic target synchronization", () => {
  it("preserves existing target overrides while adding new detected targets", () => {
    const existingTargets: TargetConfig[] = [
      {
        column: "protein",
        type: "binary_classification",
        unit: "mg/L",
        classes: ["low", "high"],
        is_default: true,
        label: "Protein override",
      },
    ];

    const result = syncTargetsWithDetectedColumns(
      [
        detectedColumn({ name: "protein", inferred_task_type: "regression" }),
        detectedColumn({ name: "batch", type: "text" }),
        detectedColumn({
          name: "quality",
          type: "categorical",
          classes: ["a", "b", "c"],
          inferred_task_type: "multiclass_classification",
        }),
      ],
      existingTargets,
      "protein",
      "binary_classification"
    );

    expect(result.targetsChanged).toBe(true);
    expect(result.targetCandidates.map((column) => column.name)).toEqual(["protein", "quality"]);
    expect(result.targets).toEqual([
      existingTargets[0],
      {
        column: "quality",
        type: "multiclass_classification",
        classes: ["a", "b", "c"],
        is_default: false,
      },
    ]);
    expect(result.defaultTarget).toBe("protein");
    expect(result.taskType).toBe("binary_classification");
  });

  it("selects the first target as default when none exists", () => {
    const result = syncTargetsWithDetectedColumns(
      [
        detectedColumn({ name: "moisture" }),
        detectedColumn({ name: "grade", inferred_task_type: "multiclass_classification" }),
      ],
      [],
      "",
      "auto"
    );

    expect(result.defaultTarget).toBe("moisture");
    expect(result.defaultTargetChanged).toBe(true);
    expect(result.taskType).toBe("regression");
    expect(result.targets).toEqual([
      {
        column: "moisture",
        type: "regression",
        classes: undefined,
        is_default: true,
      },
      {
        column: "grade",
        type: "multiclass_classification",
        classes: undefined,
        is_default: false,
      },
    ]);
  });

  it("detects modified target types and resets them to inferred values", () => {
    const detectedColumns = [
      detectedColumn({
        name: "quality",
        type: "categorical",
        classes: ["low", "high"],
        inferred_task_type: "binary_classification",
      }),
    ];
    const targets: TargetConfig[] = [
      { column: "quality", type: "regression", is_default: true },
    ];

    expect(isTargetTypeModified(detectedColumns, "quality", "regression")).toBe(true);
    expect(resetTargetType(targets, detectedColumns, "quality")).toEqual([
      {
        column: "quality",
        type: "binary_classification",
        classes: ["low", "high"],
        is_default: true,
      },
    ]);
  });
});

describe("TargetsStepLogic aggregation method adjustment", () => {
  it("switches enabled aggregation to vote for classification tasks", () => {
    expect(getAggregationMethodAdjustment("binary_classification", true, "mean")).toBe("vote");
  });

  it("switches enabled aggregation from vote to mean for regression tasks", () => {
    expect(getAggregationMethodAdjustment("regression", true, "vote")).toBe("mean");
  });

  it("leaves compatible or disabled aggregation methods unchanged", () => {
    expect(getAggregationMethodAdjustment("multiclass_classification", true, "vote")).toBeNull();
    expect(getAggregationMethodAdjustment("binary_classification", false, "mean")).toBeNull();
  });
});
