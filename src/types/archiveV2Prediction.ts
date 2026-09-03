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

/**
 * Renderer-owned pointer to an Archive V2 that is already persisted inside a
 * linked workspace. It deliberately carries no chain, bundle, or absolute
 * filesystem path: the native sidecar resolves `archive_ref` below the
 * selected workspace and verifies the content digest before replay.
 */
export interface PersistedArchiveV2Selection {
  readonly schema_version: 1;
  readonly kind: "persisted_archive_v2";
  readonly workspace_id: string;
  readonly archive_ref: string;
  readonly archive_sha256: string;
  readonly n_features: number;
  readonly target_names: readonly string[];
}

export interface ArchiveV2SelectionDraft {
  readonly workspace_id: string;
  readonly archive_ref: string;
  readonly archive_sha256: string;
  readonly n_features: number;
  readonly target_names: readonly string[];
}

export interface ArchiveV2CatalogueEntry {
  readonly archive_id: string;
  readonly archive_ref: string;
  readonly archive_sha256: string;
  readonly n_features: number;
  readonly target_names: readonly string[];
  readonly descriptor_fingerprint: string;
  readonly identity_status: "verified";
}

export interface ArchiveV2CatalogueResponse {
  readonly schema_version: 1;
  readonly operation: "archive_v2_catalogue";
  readonly workspace_id: string;
  readonly archives: readonly ArchiveV2CatalogueEntry[];
}
