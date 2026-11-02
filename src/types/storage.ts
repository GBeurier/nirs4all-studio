/**
 * Storage and maintenance types for the SQLite + Parquet workspace.
 */

export interface StorageStatusResponse {
  storage_mode: "migrated" | "legacy" | "mid_migration" | "new" | "unknown";
  has_prediction_arrays_table: boolean;
  has_arrays_directory: boolean;
  migration_needed: boolean;
}

export interface WorkspaceFormatStatusResponse {
  path: string | null;
  /** True when the workspace holds `store.duckdb` and no `store.sqlite`. */
  legacy_duckdb: boolean;
}

export interface DatasetStorageInfo {
  name: string;
  prediction_count: number;
  parquet_size_bytes: number;
}

export interface StorageHealthResponse {
  storage_mode: string;
  /** Size of the store.sqlite database. */
  store_size_bytes: number;
  parquet_total_size_bytes: number;
  total_predictions: number;
  total_datasets: number;
  datasets: DatasetStorageInfo[];
  orphan_metadata_count: number;
  orphan_array_count: number;
  corrupt_files: string[];
}

export interface CompactDatasetStats {
  rows_before: number;
  rows_after: number;
  rows_removed: number;
  bytes_before: number;
  bytes_after: number;
}

export interface CompactReport {
  datasets: Record<string, CompactDatasetStats>;
}

export interface CleanDeadLinksReport {
  metadata_orphans_removed: number;
  array_orphans_removed: number;
}

export interface RemoveBottomReport {
  removed: number;
  remaining: number;
  threshold_score: number;
}

export interface PredictionDeletionReport {
  success: boolean;
  scope: "prediction" | "prediction_group" | "chain" | "dataset";
  prediction_id?: string;
  chain_id?: string;
  fold_id?: string;
  dataset_name?: string;
  deleted_predictions: number;
  deleted_arrays: number;
  deleted_chains: number;
  deleted_pipelines: number;
  deleted_artifacts: number;
  updated_chains: number;
}
