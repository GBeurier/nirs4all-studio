/**
 * Closed renderer contract for native prediction from an already-persisted
 * Archive V2. Dataset loading, file upload, fitting, and fallback are outside
 * this surface.
 */

export interface ArchiveV2ArrayPredictionRequest {
  readonly schema_version: 1;
  readonly operation: "archive_v2_predict";
  readonly workspace_id: string;
  readonly archive: {
    readonly ref: string;
    readonly sha256: string;
  };
  readonly input: {
    readonly kind: "array";
    readonly sample_ids: readonly string[];
    readonly x: readonly (readonly number[])[];
    readonly expected_target_names: readonly string[];
  };
  readonly execution: {
    readonly engine: "core_rust_methods";
    readonly allow_fallback: false;
  };
}

export interface ArchiveV2ArrayPredictionResponse {
  readonly schema_version: 1;
  readonly operation: "archive_v2_predict";
  readonly archive_id: string;
  readonly archive_sha256: string;
  readonly engine: "core_rust_methods";
  readonly fallback_used: false;
  readonly sample_ids: readonly string[];
  readonly target_names: readonly string[];
  readonly values: readonly (readonly number[])[];
  readonly provenance: {
    readonly executor: string;
    readonly archive_ref: string;
    readonly workspace_id: string;
  };
}
