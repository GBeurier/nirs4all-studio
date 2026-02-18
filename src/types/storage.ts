/**
 * Storage, migration, and maintenance types for hybrid DuckDB + Parquet mode.
 */

export interface StorageStatusResponse {
  storage_mode: "migrated" | "legacy" | "mid_migration" | "new" | "unknown";
  has_prediction_arrays_table: boolean;
  has_arrays_directory: boolean;
  migration_needed: boolean;
}

export interface MigrationStatusResponse {
  migration_needed: boolean;
  storage_mode: string;
  legacy_row_count: number | null;
  estimated_duration_seconds: number | null;
}

export interface MigrationReport {
  total_rows: number;
  rows_migrated: number;
  datasets_migrated: string[];
  verification_passed: boolean;
  verification_sample_size: number;
  verification_mismatches: number;
  duckdb_size_before: number;
  duckdb_size_after: number;
  parquet_total_size: number;
  duration_seconds: number;
  errors: string[];
}

export interface MigrationJobResponse {
  job_id: string;
}

export interface DatasetStorageInfo {
  name: string;
  prediction_count: number;
  parquet_size_bytes: number;
}

export interface StorageHealthResponse {
  storage_mode: string;
  migration_needed: boolean;
  duckdb_size_bytes: number;
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

