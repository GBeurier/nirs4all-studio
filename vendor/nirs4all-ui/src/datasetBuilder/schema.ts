/**
 * Pure derivations over the current set of sources: the aggregate role schema,
 * the partition preview, and small immutable mutators the container uses to
 * apply role changes without owning any React state itself.
 */

import { PARTITION_VALUES } from "./detect.js";
import type {
  ColumnRef,
  DatasetColumn,
  DatasetRole,
  DatasetSchemaSummary,
  DatasetSource,
  PartitionBucket,
  PartitionMode,
  PartitionPreviewModel,
} from "./types.js";

function ref(source: DatasetSource, column: DatasetColumn): ColumnRef {
  return {
    sourceId: source.id,
    sourceName: source.name,
    columnId: column.id,
    columnName: column.name,
  };
}

/** Aggregate every source's column roles into one schema summary. */
export function deriveSchema(sources: DatasetSource[]): DatasetSchemaSummary {
  const summary: DatasetSchemaSummary = {
    xSources: [],
    yColumns: [],
    metadataColumns: [],
    idColumns: [],
    partitionColumns: [],
    replicateColumns: [],
    groupColumns: [],
  };
  for (const source of sources) {
    let hasX = false;
    for (const col of source.columns) {
      switch (col.assignedRole) {
        case "x":
          hasX = true;
          break;
        case "y":
          summary.yColumns.push(ref(source, col));
          break;
        case "metadata":
          summary.metadataColumns.push(ref(source, col));
          break;
        case "id":
          summary.idColumns.push(ref(source, col));
          break;
        case "partition":
          summary.partitionColumns.push(ref(source, col));
          break;
        case "replicate":
          summary.replicateColumns.push(ref(source, col));
          break;
        case "group":
          summary.groupColumns.push(ref(source, col));
          break;
        default:
          break;
      }
    }
    if (hasX) summary.xSources.push(source.id);
  }
  return summary;
}

/** Count columns by role for the mapping-table help panel + progress bar. */
export function countRoles(columns: DatasetColumn[]): {
  total: number;
  assigned: number;
  byRole: Record<DatasetRole, number>;
} {
  const byRole = {
    x: 0,
    y: 0,
    metadata: 0,
    id: 0,
    partition: 0,
    replicate: 0,
    group: 0,
    ignored: 0,
  } as Record<DatasetRole, number>;
  let assigned = 0;
  for (const col of columns) {
    byRole[col.assignedRole] += 1;
    if (col.assignedRole !== "ignored") assigned += 1;
  }
  return { total: columns.length, assigned, byRole };
}

/** Build a partition preview from the first detected partition column. */
export function derivePartitionPreview(
  sources: DatasetSource[],
  mode: PartitionMode = "train_test",
  approxTotal?: number,
): PartitionPreviewModel {
  const partitionCol = findPartitionColumn(sources);
  // Samples align by ID across sources, so the sample count is best approximated
  // by the widest declared row count rather than a sum.
  const total = approxTotal ?? sources.reduce((acc, s) => Math.max(acc, s.rowCount ?? 0), 0);

  if (mode === "train_only") {
    return {
      mode,
      detected: false,
      total,
      buckets: [{ id: "train", label: "Train", count: total, ratio: 1 }],
    };
  }

  if (partitionCol) {
    // We don't have raw rows here; approximate an 80/20 (or 60/20/20) split from
    // the declared row count so the preview is meaningful without the data.
    return {
      mode,
      detected: true,
      columnName: partitionCol.columnName,
      total,
      buckets: defaultBuckets(mode, total),
    };
  }

  return { mode, detected: false, total, buckets: defaultBuckets(mode, total) };
}

function defaultBuckets(mode: PartitionMode, total: number): PartitionBucket[] {
  let raw: Array<[string, string, number]>;
  if (mode === "train_val_test") {
    raw = [
      ["train", "Train", total * 0.6],
      ["validation", "Validation", total * 0.2],
      ["test", "Test", total * 0.2],
    ];
  } else if (mode === "folds") {
    const k = 5;
    raw = Array.from(
      { length: k },
      (_, i) => [`fold_${i + 1}`, `Fold ${i + 1}`, total / k] as [string, string, number],
    );
  } else {
    raw = [
      ["train", "Train", total * 0.8],
      ["test", "Test", total * 0.2],
    ];
  }
  return raw.map(([id, label, count]) => ({
    id,
    label,
    count: Math.round(count),
    ratio: total > 0 ? count / total : 0,
  }));
}

export function findPartitionColumn(sources: DatasetSource[]): ColumnRef | undefined {
  for (const source of sources) {
    const col = source.columns.find((c) => c.assignedRole === "partition");
    if (col) return ref(source, col);
  }
  return undefined;
}

/** Immutably set the role for a set of column ids inside one source. */
export function assignRoleToColumns(
  source: DatasetSource,
  columnIds: Set<string>,
  role: DatasetRole,
): DatasetSource {
  return {
    ...source,
    columns: source.columns.map((col) =>
      columnIds.has(col.id) ? { ...col, assignedRole: role, manual: true } : col,
    ),
  };
}

/** Immutably toggle a column's selection flag. */
export function toggleColumnSelection(
  source: DatasetSource,
  columnId: string,
  selected?: boolean,
): DatasetSource {
  return {
    ...source,
    columns: source.columns.map((col) =>
      col.id === columnId ? { ...col, selected: selected ?? !col.selected } : col,
    ),
  };
}

export function isRecognizedPartitionValue(value: string): boolean {
  return PARTITION_VALUES.has(value.trim().toLowerCase());
}
