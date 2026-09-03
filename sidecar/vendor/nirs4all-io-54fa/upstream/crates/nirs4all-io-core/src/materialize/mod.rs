// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Materialization core: the fs-free assembly layer.
//!
//! The typed frame, relational join engine, fold parser, the pure CSV-from-bytes
//! decoder, and the dataset assembler all live here so they are reachable from
//! the WASM binding (which depends on this pure core only). The facade
//! (`nirs4all-io`) owns the file IO — path resolution, byte reads, gzip/zip
//! decompression, index-file and fold-file reads — and delegates to
//! [`assemble_in_memory`] so a single assembly core backs both paths (D-R4 / D-R7).

pub mod assemble;
pub mod folds;
pub mod frame;
pub mod join;
pub mod loaders;
pub mod package;

pub use assemble::{
    assemble_in_memory, AssembledDataset, FoldProvenance, IdentityProvenance, InMemorySource,
    PartitionBlock, SourcePayload, ASSEMBLED_DATASET_VERSION,
};
pub use folds::{parse_fold_str, Fold};
pub use frame::{Cell, Column, Frame, Matrix};
pub use join::{concat_features, concat_samples, join_tables, merge_by_key, JoinAudit};
pub use loaders::{apply_na_policy, effective_params, read_table_bytes, LoadedTable};
pub use package::{
    repr_ids, DatasetPackage, FeatureMatrix, GenotypeMatrix, MaskBlock, MetadataTable, NdTensor,
    PackagePartition, PayloadBlock, PayloadManifest, PayloadManifestEntry, PayloadStorageKind,
    RowPositionFallback, SequenceBlock, SpectralRecordSet, TargetTable, UriRef, WeightsVector,
    DATASET_PACKAGE_VERSION,
};
