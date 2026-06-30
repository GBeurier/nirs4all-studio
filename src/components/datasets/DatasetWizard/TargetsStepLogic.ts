import type { AggregationConfig, TargetConfig, TaskType } from "@/types/datasets";

export interface DetectedColumn {
  name: string;
  type: "numeric" | "categorical" | "text";
  unique_values?: number;
  min?: number;
  max?: number;
  mean?: number;
  classes?: string[];
  inferred_task_type: TaskType;
}

export interface TargetSyncResult {
  targetCandidates: DetectedColumn[];
  targets: TargetConfig[];
  targetsChanged: boolean;
  defaultTarget?: string;
  defaultTargetChanged: boolean;
  taskType?: TaskType;
  taskTypeChanged: boolean;
}

export function parseTargetNumber(value: string, decimalSeparator: string = "."): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = normalizeNumberString(trimmed, decimalSeparator);
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) return parsed;

  const fallback = normalizeNumberString(trimmed, decimalSeparator === "," ? "." : ",");
  const fallbackParsed = Number(fallback);
  return Number.isFinite(fallbackParsed) ? fallbackParsed : null;
}

export function parseColumnsFromData(
  columnNames: string[],
  sampleData: string[][],
  decimalSeparator: string = "."
): DetectedColumn[] {
  if (!columnNames || columnNames.length === 0) return [];

  return columnNames.map((colName, idx) => {
    const sampleValues = getColumnSampleValues(sampleData, idx);
    const numericValues = sampleValues
      .map((value) => parseTargetNumber(value, decimalSeparator))
      .filter((value): value is number => value !== null);

    const uniqueCount = new Set(sampleValues).size;
    const isNumeric = sampleValues.length > 0 && numericValues.length >= sampleValues.length * 0.5;

    let colType: DetectedColumn["type"] = "text";
    let classes: string[] | undefined;
    let min: number | undefined;
    let max: number | undefined;
    let mean: number | undefined;

    if (isNumeric) {
      colType = "numeric";
      if (numericValues.length > 0) {
        min = Math.min(...numericValues);
        max = Math.max(...numericValues);
        mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      }
    } else if (uniqueCount <= 10 && uniqueCount > 0) {
      colType = "categorical";
      classes = [...new Set(sampleValues)];
    }

    return {
      name: String(colName),
      type: colType,
      unique_values: uniqueCount,
      min,
      max,
      mean,
      classes,
      inferred_task_type: inferTargetTaskType(colType, numericValues, uniqueCount, min, max),
    };
  });
}

export function getTargetCandidates(detectedColumns: DetectedColumn[]): DetectedColumn[] {
  return detectedColumns.filter((column) => column.type !== "text");
}

export function syncTargetsWithDetectedColumns(
  detectedColumns: DetectedColumn[],
  existingTargets: TargetConfig[],
  currentDefaultTarget: string = "",
  currentTaskType: TaskType = "auto"
): TargetSyncResult {
  const targetCandidates = getTargetCandidates(detectedColumns);
  if (targetCandidates.length === 0) {
    return {
      targetCandidates,
      targets: existingTargets,
      targetsChanged: false,
      defaultTargetChanged: false,
      taskTypeChanged: false,
    };
  }

  const targets = targetCandidates.map((column) => {
    const existing = existingTargets.find((target) => target.column === column.name);
    return existing
      ? { ...existing }
      : {
          column: column.name,
          type: column.inferred_task_type,
          classes: column.classes,
          is_default: false,
        };
  });

  const defaultTarget = deriveDefaultTarget(targets, currentDefaultTarget);
  const normalizedTargets = defaultTarget
    ? targets.map((target) => ({ ...target, is_default: target.column === defaultTarget }))
    : targets;
  const taskType = deriveTaskTypeFromTargets(normalizedTargets);

  return {
    targetCandidates,
    targets: normalizedTargets,
    targetsChanged: !areTargetsEqual(existingTargets, normalizedTargets),
    defaultTarget,
    defaultTargetChanged: !!defaultTarget && currentDefaultTarget !== defaultTarget,
    taskType,
    taskTypeChanged: !!taskType && currentTaskType !== taskType,
  };
}

export function deriveDefaultTarget(
  targets: TargetConfig[],
  currentDefaultTarget: string = ""
): string | undefined {
  const flaggedDefault = targets.find((target) => target.is_default)?.column;
  if (flaggedDefault) return flaggedDefault;

  if (currentDefaultTarget && targets.some((target) => target.column === currentDefaultTarget)) {
    return currentDefaultTarget;
  }

  return targets[0]?.column;
}

export function deriveTaskTypeFromTargets(targets: TargetConfig[]): TaskType | undefined {
  const defaultTarget = targets.find((target) => target.is_default) || targets[0];
  return defaultTarget && defaultTarget.type !== "auto" ? defaultTarget.type : undefined;
}

export function updateTargetType(
  targets: TargetConfig[],
  column: string,
  type: TaskType
): TargetConfig[] {
  return targets.map((target) => (target.column === column ? { ...target, type } : target));
}

export function updateTargetUnit(
  targets: TargetConfig[],
  column: string,
  unit: string
): TargetConfig[] {
  return targets.map((target) => (target.column === column ? { ...target, unit } : target));
}

export function selectDefaultTarget(targets: TargetConfig[], column: string): TargetConfig[] {
  return targets.map((target) => ({ ...target, is_default: target.column === column }));
}

export function resetTargetType(
  targets: TargetConfig[],
  detectedColumns: DetectedColumn[],
  column: string
): TargetConfig[] {
  const detectedColumn = detectedColumns.find((detected) => detected.name === column);
  if (!detectedColumn) return targets;

  return targets.map((target) =>
    target.column === column
      ? { ...target, type: detectedColumn.inferred_task_type, classes: detectedColumn.classes }
      : target
  );
}

export function isTargetTypeModified(
  detectedColumns: DetectedColumn[],
  column: string,
  currentType: TaskType
): boolean {
  const detectedColumn = detectedColumns.find((detected) => detected.name === column);
  return detectedColumn ? detectedColumn.inferred_task_type !== currentType : false;
}

export function getAggregationMethodAdjustment(
  taskType: TaskType,
  aggregationEnabled: boolean,
  currentMethod: AggregationConfig["method"]
): AggregationConfig["method"] | null {
  if (!aggregationEnabled) return null;

  const isClassification = taskType.includes("classification");
  if (isClassification && currentMethod !== "vote") return "vote";
  if (!isClassification && currentMethod === "vote") return "mean";
  return null;
}

function getColumnSampleValues(sampleData: string[][] = [], columnIndex: number): string[] {
  return sampleData
    .map((row) => row?.[columnIndex])
    .filter((value): value is string => value !== null && value !== undefined && value !== "");
}

function inferTargetTaskType(
  columnType: DetectedColumn["type"],
  numericValues: number[],
  uniqueCount: number,
  min?: number,
  max?: number
): TaskType {
  if (columnType === "numeric") {
    const isAllIntegers = numericValues.every((value) => Number.isInteger(value));
    const hasSignificantDecimals = numericValues.some((value) => {
      const fractional = Math.abs(value % 1);
      return fractional > 0.001 && fractional < 0.999;
    });
    const range = (max ?? 0) - (min ?? 0);

    if (hasSignificantDecimals || range > 10) {
      return "regression";
    }

    if (isAllIntegers && uniqueCount <= 10 && (max ?? 0) <= 10) {
      return uniqueCount === 2 ? "binary_classification" : "multiclass_classification";
    }

    return "regression";
  }

  if (columnType === "categorical") {
    return uniqueCount === 2 ? "binary_classification" : "multiclass_classification";
  }

  return "regression";
}

function normalizeNumberString(value: string, decimalSeparator: string): string {
  const withoutSpaces = value.replace(/\s/g, "");
  if (decimalSeparator === ",") {
    return withoutSpaces.replace(/\./g, "").replace(",", ".");
  }

  if (decimalSeparator === ".") {
    if (withoutSpaces.includes(".") && withoutSpaces.includes(",")) {
      return withoutSpaces.replace(/,/g, "");
    }

    if (!withoutSpaces.includes(".") && hasLikelyDecimalComma(withoutSpaces)) {
      return withoutSpaces.replace(",", ".");
    }

    return withoutSpaces.replace(/,/g, "");
  }

  return withoutSpaces;
}

function hasLikelyDecimalComma(value: string): boolean {
  const commaMatches = value.match(/,/g);
  if (!commaMatches || commaMatches.length !== 1) return false;

  const [, fraction = ""] = value.split(",");
  return fraction.length > 0 && fraction.length !== 3;
}

function areTargetsEqual(left: TargetConfig[], right: TargetConfig[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((target, index) => areTargetEqual(target, right[index]));
}

function areTargetEqual(left: TargetConfig, right: TargetConfig): boolean {
  return (
    left.column === right.column &&
    left.type === right.type &&
    left.unit === right.unit &&
    left.is_default === right.is_default &&
    left.label === right.label &&
    left.description === right.description &&
    stringArraysEqual(left.classes, right.classes)
  );
}

function stringArraysEqual(left?: string[], right?: string[]): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}
