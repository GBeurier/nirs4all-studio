/**
 * Dataset Builder view-model types.
 *
 * The reusable contract shared by every host of the `DatasetBuilder` wizard.
 * Hosts parse files into `DatasetSource` descriptors (columns + preview values +
 * detected native types) and hand them to the component; the package never reads
 * files, hits the network, or executes a runtime — it only derives roles,
 * validation, partitions, and the final export config from these descriptors.
 */

/** The role a column (or a whole source) plays in the assembled dataset. */
export type DatasetRole =
  | "x"
  | "y"
  | "metadata"
  | "id"
  | "partition"
  | "replicate"
  | "group"
  | "ignored";

/** The kind of signal a source carries — drives the config-panel options. */
export type SignalType =
  | "spectra"
  | "table"
  | "image"
  | "timeseries"
  | "hyperspectral"
  | "metadata"
  | "target"
  | "other";

/** Native column value type as sniffed by the host parser. */
export type ColumnType = "text" | "integer" | "float" | "boolean" | "date" | "unknown";

/** Fine-grained meaning layered on top of a role (e.g. a Y that is a class). */
export type SemanticType =
  | "regression"
  | "classification"
  | "wavelength"
  | "identifier"
  | "temporal"
  | "categorical";

/** How a whole source is consumed by the dataset. */
export type SourceUseAs =
  | "x_train"
  | "x_test"
  | "x_train_test"
  | "y_train"
  | "y_test"
  | "metadata"
  | "metadata_train_test"
  | "join_table"
  | "partition"
  | "auxiliary";

export type SourceStatus = "uploaded" | "parsed" | "warning" | "error";

export type HeaderMode = "horizontal" | "vertical" | "none";

export type WizardStep = "source" | "role" | "columns" | "validation";

export type ValidationLevel = "ok" | "warning" | "error";

/** Task typing for a target column. */
export type TargetTask =
  | "auto"
  | "regression"
  | "classification"
  | "multilabel"
  | "multiclass"
  | "ordinal";

export interface SourceParsing {
  separator?: string | undefined;
  decimal?: "." | "," | undefined;
  encoding?: string | undefined;
  headerMode?: HeaderMode | undefined;
  headerRow?: number | undefined;
  sheetName?: string | undefined;
  /** image sources: accepted extensions / id extraction pattern. */
  extensions?: string[] | undefined;
  idPattern?: string | undefined;
  /** timeseries sources */
  timeColumn?: string | undefined;
  frequency?: string | undefined;
}

export interface SourceUsage {
  role?: DatasetRole;
  useAs?: SourceUseAs;
}

export interface DatasetColumn {
  id: string;
  name: string;
  previewValue?: string | number | null;
  detectedType: ColumnType;
  assignedRole: DatasetRole;
  semanticType?: SemanticType;
  /** true when the role came from a user action rather than auto-detection. */
  manual?: boolean;
  selected?: boolean;
  warnings?: string[];
}

export interface DatasetSource {
  id: string;
  name: string;
  kind: "file" | "folder";
  /** e.g. "csv", "xlsx", "parquet", "images", "spc". */
  fileType: string;
  signalType: SignalType;
  status: SourceStatus;
  rowCount?: number;
  columnCount?: number;
  sizeBytes?: number;
  parsing: SourceParsing;
  usage: SourceUsage;
  columns: DatasetColumn[];
  /** free-form issues surfaced by the host parser. */
  notes?: string[];
}

/** Aggregate role assignment across every source, used by validation + export. */
export interface DatasetSchemaSummary {
  xSources: string[];
  yColumns: ColumnRef[];
  metadataColumns: ColumnRef[];
  idColumns: ColumnRef[];
  partitionColumns: ColumnRef[];
  replicateColumns: ColumnRef[];
  groupColumns: ColumnRef[];
}

export interface ColumnRef {
  sourceId: string;
  sourceName: string;
  columnId: string;
  columnName: string;
}

export interface ValidationCheck {
  id: string;
  level: ValidationLevel;
  label: string;
  details?: string;
}

export interface ValidationResult {
  status: ValidationLevel;
  checks: ValidationCheck[];
}

export type PartitionMode = "train_test" | "train_only" | "train_val_test" | "folds";

export interface PartitionBucket {
  id: string;
  label: string;
  count: number;
  ratio: number;
}

export interface PartitionPreviewModel {
  mode: PartitionMode;
  /** the column the split is read from, when detected. */
  columnName?: string;
  buckets: PartitionBucket[];
  total: number;
  detected: boolean;
}

/** The JSON object produced by the wizard — the reusable dataset config. */
export interface DatasetExportConfig {
  name: string;
  sources: ExportSource[];
  targets: ExportTarget[];
  metadata: ExportMetadataGroup[];
  joins: ExportJoin[];
  partition?: ExportPartition | undefined;
  replicates?: ExportReplicates | undefined;
}

export interface ExportSource {
  name: string;
  signal_type: SignalType;
  use_as?: SourceUseAs | undefined;
  id_column?: string | undefined;
  replicate_column?: string | undefined;
  partition_column?: string | undefined;
  x_columns?: string[] | undefined;
  parsing: {
    separator?: string | undefined;
    decimal?: "." | "," | undefined;
    header_mode?: HeaderMode | undefined;
  };
}

export interface ExportTarget {
  source: string;
  column: string;
  task: TargetTask;
}

export interface ExportMetadataGroup {
  source: string;
  columns: string[];
}

export interface ExportJoin {
  left: string;
  right: string;
  on: string;
  strategy: JoinStrategy;
}

export type JoinStrategy = "inner" | "left" | "strict" | "allow_missing";

export interface ExportPartition {
  type: "column" | "random" | "manual" | "none";
  column?: string | undefined;
  values?: Record<string, string[]> | undefined;
}

export type ReplicateStrategy = "keep" | "average" | "stack" | "augment" | "hierarchy";

export interface ExportReplicates {
  column: string;
  strategy: ReplicateStrategy;
}

export type MissingPolicy = "forbid" | "allow" | "impute" | "drop_rows";
export type MultiSourceAlign = "sample_id" | "plot_id" | "row_index" | "temporal";

/** Advanced, collapsed source options. Defaults are conservative + leakage-safe. */
export interface AdvancedOptions {
  joinStrategy: JoinStrategy;
  replicateStrategy: ReplicateStrategy;
  multiSourceAlign: MultiSourceAlign;
  missingPolicy: MissingPolicy;
  yTask: TargetTask;
}

export const DEFAULT_ADVANCED_OPTIONS: AdvancedOptions = {
  joinStrategy: "strict",
  replicateStrategy: "keep",
  multiSourceAlign: "sample_id",
  missingPolicy: "forbid",
  yTask: "auto",
};
