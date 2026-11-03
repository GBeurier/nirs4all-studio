// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! `DatasetPackage` — the target-agnostic v3 package (`IO-002` / `IO-MM-002`).
//!
//! `AssembledDataset` stores its matrix payloads inline as dense `f32`
//! [`Matrix`]. That is fine for 1-D spectra but wrong for images / cubes (wrong
//! dtype, wrong rank, pathological JSON size). [`DatasetPackage`] is versioned
//! contract the `LOCK-IO` spec ratifies: a container of **typed payload blocks**
//! ([`PayloadBlock`]) plus a **payload manifest** ([`PayloadManifest`]) whose rows
//! carry a `content_hash`, a representation-ID hint and either inline bytes or a
//! large-payload **URI reference** ([`UriRef`]) — bytes are never embedded in the
//! canonical summary. Identity's **row-position fallback** is recorded explicitly
//! and fingerprinted ([`RowPositionFallback`]), not left silent.
//!
//! `DatasetPackage` v3 is distinct from the explicitly versioned
//! `AssembledDataset` v2 summary/full wire. [`DatasetPackage::from_assembled`]
//! preserves every v2-expressible payload (proven by round-tripping through
//! [`DatasetPackage::to_assembled`]); URI/tensor variants remain package-only.
//! Neither wire silently accepts its retired predecessor.
//!
//! Like the rest of `nirs4all-io-core`, this module is pure logic: no file IO,
//! no `nirs4all-formats`, no `dag-ml-data` dependency. The representation-ID
//! strings mirror the published `dag-ml-data` `builtin_models.rs` registry
//! (`DMD-001`); the `nirs4all-io-dagml` bridge owns the drift guard that asserts
//! [`repr_ids`] equals the real `dag_ml_data::REPRESENTATION_*` constants.

use indexmap::IndexMap;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::assemble::{
    identity_provenance_value, AssembledDataset, FoldProvenance, IdentityProvenance, PartitionBlock,
};
use super::folds::Fold;
use super::frame::{Cell, Frame, Matrix};
use crate::canonical_json::canonical_json;
use crate::spec::dataset_spec::AggregateSpec;

/// `DatasetPackage` wire-schema version. Distinct from
/// `DATASET_SPEC_SCHEMA_VERSION` (1): this is a separate v3 wire and does not
/// imply compatibility with package v2.
pub const DATASET_PACKAGE_VERSION: u32 = 3;

/// Frozen representation-ID strings — a verbatim mirror of the published
/// `dag-ml-data` `builtin_models.rs` registry (`DMD-001`). Kept here as plain
/// strings so the pure core stays free of a `dag-ml-data` dependency; the
/// `nirs4all-io-dagml` bridge asserts these equal the real
/// `dag_ml_data::REPRESENTATION_*` constants (drift guard).
pub mod repr_ids {
    /// `sample × wavelength` — a single 1-D signal source.
    pub const SIGNAL_1D: &str = "signal_1d";
    /// `sample × processing × wavelength` — a signal with preprocessing layers.
    pub const SIGNAL_WITH_PROCESSINGS: &str = "signal_with_processings";
    /// `sample × block × feature` — multi-source feature blocks (join output).
    pub const FEATURE_BLOCK_SET: &str = "feature_block_set";
    /// `sample` rank-1 numeric target.
    pub const TARGET_NUMERIC: &str = "target_numeric";
    /// `sample` rank-1 categorical target.
    pub const TARGET_CATEGORICAL: &str = "target_categorical";
    /// `sample × target` rank-2 numeric targets.
    pub const TARGET_NUMERIC_MATRIX: &str = "target_numeric_matrix";
    /// `sample × target` rank-2 categorical targets.
    pub const TARGET_CATEGORICAL_MATRIX: &str = "target_categorical_matrix";
    /// `sample × field` metadata table.
    pub const SAMPLE_METADATA: &str = "sample_metadata";
    /// `sample × height × width` grayscale image (net-new, declared).
    pub const GRAY_IMAGE: &str = "gray_image";
    /// `sample × height × width × channel=3` RGB image (net-new, declared).
    pub const RGB_IMAGE: &str = "rgb_image";
    /// `sample × height × width × channel` multichannel image (net-new, declared).
    pub const MC_IMAGE: &str = "mc_image";
    /// `sample × height × width × band` multispectral image (net-new, declared).
    pub const MULTISPECTRAL_IMAGE: &str = "multispectral_image";
}

// --------------------------------------------------------------------------- //
// Payload manifest                                                            //
// --------------------------------------------------------------------------- //

/// Where a payload's bytes live: inline in the package, or referenced by URI so
/// large image/cube bytes are never embedded in the canonical summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PayloadStorageKind {
    /// Bytes are carried in the in-memory payload block (small numeric payloads).
    Inline,
    /// Bytes live outside the package, referenced by a [`UriRef`] (large payloads).
    Uri,
}

/// One manifest row: a bytes-free description of a single payload block. Ties the
/// payload to a representation-ID hint, its shape/dtype, a `content_hash` (SHA-256
/// of the payload's canonical bytes) and its storage mode. Tampering with any
/// field changes the manifest root hash; tampering with the payload bytes changes
/// `content_hash`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PayloadManifestEntry {
    /// Stable payload id within the package (e.g. `train/x0`, `train/y`).
    pub id: String,
    /// Owning partition name.
    pub partition: String,
    /// io role: `features` | `targets` | `metadata` | `weights` | `mask`.
    pub role: String,
    /// Payload block kind (`feature_matrix`, `target_table`, `nd_tensor`, …).
    pub payload_kind: String,
    /// `dag-ml-data` representation-ID hint (`DMD-001`), when known.
    pub representation_id: Option<String>,
    /// Element dtype (`float32`, `mixed`, or the tensor/mask dtype).
    pub dtype: String,
    /// Payload shape (`[n_samples, n_features]`, tensor shape, …).
    pub shape: Vec<usize>,
    /// Axis names, best-effort (`sample`, `wavelength`, `processing`, …).
    pub axes: Vec<String>,
    /// SHA-256 (lowercase hex) of the payload's canonical bytes.
    pub content_hash: String,
    /// Byte length of the hashed payload serialization.
    pub byte_len: u64,
    /// Inline vs URI-referenced.
    pub storage: PayloadStorageKind,
    /// The URI, when `storage == Uri`.
    pub uri: Option<String>,
    /// The codec, when `storage == Uri`.
    pub codec: Option<String>,
}

/// The package payload manifest: every payload's manifest row plus a `root`
/// fingerprint over all rows (canonical-JSON, so key order is stable). The root
/// is what a provider checks to detect tampering with payloads or the manifest.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PayloadManifest {
    /// SHA-256 (lowercase hex) over the canonical JSON of `entries`.
    pub root: String,
    /// One row per payload block, in package order.
    pub entries: Vec<PayloadManifestEntry>,
}

/// A large-payload manifest pointer: the `IO-MM-002` `UriBackedPayload` contract.
/// Carries everything a provider needs to fetch and verify external bytes without
/// embedding them.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UriRef {
    /// The location of the bytes (file path, object-store key, …).
    pub uri: String,
    /// Element dtype of the referenced payload.
    pub dtype: String,
    /// Shape of the referenced payload.
    pub shape: Vec<usize>,
    /// Axis names of the referenced payload.
    pub axes: Vec<String>,
    /// SHA-256 (lowercase hex) of the referenced bytes.
    pub content_hash: String,
    /// Byte length of the referenced payload.
    pub byte_len: u64,
    /// Optional codec / compression (e.g. `npy`, `zstd`).
    pub codec: Option<String>,
}

// --------------------------------------------------------------------------- //
// Typed payload blocks                                                        //
// --------------------------------------------------------------------------- //

/// A dense numeric feature source (the current `X` path), with its headers, unit,
/// signal type and any named preprocessing variants.
#[derive(Debug, Clone, PartialEq)]
pub struct FeatureMatrix {
    /// Native `sample × feature` matrix.
    pub matrix: Matrix,
    /// Per-feature headers (axis labels / column names).
    pub headers: Vec<String>,
    /// Header unit hint (`nm`, `cm-1`, `index`, …).
    pub header_unit: String,
    /// Signal type tag (`absorbance`, `reflectance`, …), when known.
    pub signal_type: Option<String>,
    /// Named preprocessing variants aligned to `matrix` rows.
    pub processings: Vec<(String, Matrix)>,
}

/// A target table: a `sample × target` numeric matrix plus categorical mappings.
#[derive(Debug, Clone, PartialEq)]
pub struct TargetTable {
    /// `sample × target` (encoded) matrix.
    pub matrix: Matrix,
    /// Target column headers.
    pub headers: Vec<String>,
    /// Per-column categorical mapping (`{"categories": [...]}`), when encoded.
    pub categorical: IndexMap<String, Value>,
    /// Representation-ID hint decided at construction (`target_numeric`, …).
    pub representation_id: Option<String>,
}

/// A metadata table (typed columns, sample-aligned).
#[derive(Debug, Clone, PartialEq)]
pub struct MetadataTable {
    /// The sample-aligned metadata frame.
    pub frame: Frame,
}

/// Per-sample training weights (sklearn-style `sample_weight`).
#[derive(Debug, Clone, PartialEq)]
pub struct WeightsVector {
    /// One weight per sample.
    pub values: Vec<f32>,
    /// The source column header, when known.
    pub header: Option<String>,
}

/// Decoded `nirs4all-formats` records carried as a payload (net-new as a package
/// payload; the input form already exists as `SourcePayload::Records`).
#[derive(Debug, Clone, PartialEq)]
pub struct SpectralRecordSet {
    /// The decoded records (one JSON object per observation).
    pub records: Vec<Value>,
}

/// An N-D tensor payload (image / cube / tensor). Manifest-/URI-backed in this
/// first slice — there is no in-core image decoder yet (OQ-1), so bytes live
/// behind a [`UriRef`].
#[derive(Debug, Clone, PartialEq)]
pub struct NdTensor {
    /// `dag-ml-data` representation-ID (`rgb_image`, `gray_image`, `cube_hwb`, …).
    pub representation_id: String,
    /// Element dtype (`uint8`, `int32`, `float32`, …).
    pub dtype: String,
    /// Tensor shape, e.g. `[sample, height, width, channel]`.
    pub shape: Vec<usize>,
    /// Axis names.
    pub axis_names: Vec<String>,
    /// Observation ids (one per leading-axis element).
    pub observation_ids: Vec<String>,
    /// The bytes reference.
    pub uri: UriRef,
}

/// A time-series payload (fixed or ragged length). URI-backed (net-new).
#[derive(Debug, Clone, PartialEq)]
pub struct SequenceBlock {
    /// `dag-ml-data` representation-ID (`series_mv`, …).
    pub representation_id: String,
    /// Element dtype.
    pub dtype: String,
    /// Number of channels.
    pub n_channels: usize,
    /// Per-observation sequence lengths (a single value ⇒ fixed length).
    pub lengths: Vec<usize>,
    /// The bytes reference.
    pub uri: UriRef,
}

/// A genotype variant/dosage matrix, descriptor-first (net-new). URI-backed; no
/// genotype-byte parsing is claimed here.
#[derive(Debug, Clone, PartialEq)]
pub struct GenotypeMatrix {
    /// `dag-ml-data` representation-ID (`variant_matrix` / `dosage_matrix`).
    pub representation_id: String,
    /// Number of variants.
    pub n_variants: usize,
    /// Number of samples.
    pub n_samples: usize,
    /// Encoding descriptor (`dosage`, `onehot`, …).
    pub encoding: String,
    /// The bytes reference.
    pub uri: UriRef,
}

/// A segmentation / ROI / label mask (net-new). URI-backed.
#[derive(Debug, Clone, PartialEq)]
pub struct MaskBlock {
    /// `dag-ml-data` representation-ID (`segmentation_mask` / `roi_mask`).
    pub representation_id: String,
    /// Element dtype (`bool`, `uint8`, …).
    pub dtype: String,
    /// Mask shape.
    pub shape: Vec<usize>,
    /// The bytes reference.
    pub uri: UriRef,
}

/// The tagged union of typed payload variants (`IO-MM-002`). Small numeric
/// payloads are inline; large image/cube/series/genotype payloads are carried as
/// URI-backed descriptors so no bytes land in the canonical summary.
#[derive(Debug, Clone, PartialEq)]
pub enum PayloadBlock {
    /// Dense numeric feature source (inline).
    FeatureMatrix(FeatureMatrix),
    /// Target table (inline).
    TargetTable(TargetTable),
    /// Metadata table (inline).
    MetadataTable(MetadataTable),
    /// Per-sample weights (inline).
    Weights(WeightsVector),
    /// Decoded formats records (inline).
    SpectralRecordSet(SpectralRecordSet),
    /// N-D tensor (URI-backed).
    NdTensor(NdTensor),
    /// Time series (URI-backed).
    SequenceBlock(SequenceBlock),
    /// Genotype matrix (URI-backed).
    GenotypeMatrix(GenotypeMatrix),
    /// Mask (URI-backed).
    MaskBlock(MaskBlock),
    /// A bare large-payload manifest pointer (URI-backed).
    UriBackedPayload(UriRef),
}

impl PayloadBlock {
    /// Build this payload's manifest row. Inline variants hash their canonical
    /// bytes; URI-backed variants trust the [`UriRef`]'s pre-computed hash.
    pub fn manifest_entry(&self, partition: &str, id: &str) -> PayloadManifestEntry {
        let base = |role: &str, kind: &str| PayloadManifestEntry {
            id: id.to_string(),
            partition: partition.to_string(),
            role: role.to_string(),
            payload_kind: kind.to_string(),
            representation_id: None,
            dtype: String::new(),
            shape: vec![],
            axes: vec![],
            content_hash: String::new(),
            byte_len: 0,
            storage: PayloadStorageKind::Inline,
            uri: None,
            codec: None,
        };
        let inline = |mut e: PayloadManifestEntry, bytes: &[u8]| {
            e.content_hash = sha256_hex(bytes);
            e.byte_len = bytes.len() as u64;
            e.storage = PayloadStorageKind::Inline;
            e
        };
        let from_uri = |mut e: PayloadManifestEntry, uri: &UriRef| {
            e.content_hash = uri.content_hash.clone();
            e.byte_len = uri.byte_len;
            e.storage = PayloadStorageKind::Uri;
            e.uri = Some(uri.uri.clone());
            e.codec = uri.codec.clone();
            e
        };
        match self {
            PayloadBlock::FeatureMatrix(fm) => {
                let has_proc = !fm.processings.is_empty();
                let mut axes = vec!["sample".to_string()];
                if has_proc {
                    axes.push("processing".to_string());
                }
                axes.push(feature_axis_name(&fm.header_unit).to_string());
                let mut e = base("features", "feature_matrix");
                e.representation_id = Some(
                    if has_proc {
                        repr_ids::SIGNAL_WITH_PROCESSINGS
                    } else {
                        repr_ids::SIGNAL_1D
                    }
                    .to_string(),
                );
                e.dtype = "float32".into();
                e.shape = vec![fm.matrix.n_rows, fm.matrix.n_cols];
                e.axes = axes;
                inline(e, &feature_content_bytes(fm))
            }
            PayloadBlock::TargetTable(tt) => {
                let mut e = base("targets", "target_table");
                e.representation_id = tt.representation_id.clone();
                e.dtype = "float32".into();
                e.shape = vec![tt.matrix.n_rows, tt.matrix.n_cols];
                e.axes = if tt.matrix.n_cols > 1 {
                    vec!["sample".into(), "target".into()]
                } else {
                    vec!["sample".into()]
                };
                inline(e, &target_content_bytes(tt))
            }
            PayloadBlock::MetadataTable(mt) => {
                let mut e = base("metadata", "metadata_table");
                e.representation_id = Some(repr_ids::SAMPLE_METADATA.to_string());
                e.dtype = "mixed".into();
                e.shape = vec![mt.frame.n_rows, mt.frame.columns.len()];
                e.axes = vec!["sample".into(), "field".into()];
                inline(e, frame_canonical_bytes(&mt.frame).as_bytes())
            }
            PayloadBlock::Weights(w) => {
                let mut e = base("weights", "weights");
                e.dtype = "float32".into();
                e.shape = vec![w.values.len()];
                e.axes = vec!["sample".into()];
                inline(e, &weights_content_bytes(w))
            }
            PayloadBlock::SpectralRecordSet(rs) => {
                let mut e = base("features", "spectral_record_set");
                e.dtype = "records".into();
                e.shape = vec![rs.records.len()];
                e.axes = vec!["sample".into()];
                let bytes = canonical_json(&Value::Array(rs.records.clone()))
                    .expect("records serialize")
                    .into_bytes();
                inline(e, &bytes)
            }
            PayloadBlock::NdTensor(t) => {
                let mut e = base("features", "nd_tensor");
                e.representation_id = Some(t.representation_id.clone());
                e.dtype = t.dtype.clone();
                e.shape = t.shape.clone();
                e.axes = t.axis_names.clone();
                from_uri(e, &t.uri)
            }
            PayloadBlock::SequenceBlock(s) => {
                let mut e = base("features", "sequence_block");
                e.representation_id = Some(s.representation_id.clone());
                e.dtype = s.dtype.clone();
                e.shape = s.uri.shape.clone();
                e.axes = s.uri.axes.clone();
                from_uri(e, &s.uri)
            }
            PayloadBlock::GenotypeMatrix(g) => {
                let mut e = base("features", "genotype_matrix");
                e.representation_id = Some(g.representation_id.clone());
                e.dtype = g.uri.dtype.clone();
                e.shape = vec![g.n_samples, g.n_variants];
                e.axes = vec!["sample".into(), "variant".into()];
                from_uri(e, &g.uri)
            }
            PayloadBlock::MaskBlock(m) => {
                let mut e = base("mask", "mask_block");
                e.representation_id = Some(m.representation_id.clone());
                e.dtype = m.dtype.clone();
                e.shape = m.shape.clone();
                e.axes = m.uri.axes.clone();
                from_uri(e, &m.uri)
            }
            PayloadBlock::UriBackedPayload(u) => {
                let mut e = base("features", "uri_backed");
                e.dtype = u.dtype.clone();
                e.shape = u.shape.clone();
                e.axes = u.axes.clone();
                from_uri(e, u)
            }
        }
    }
}

// --------------------------------------------------------------------------- //
// The package                                                                 //
// --------------------------------------------------------------------------- //

/// A partition's typed payloads, in package order.
#[derive(Debug, Clone, PartialEq)]
pub struct PackagePartition {
    /// Sample count for this partition.
    pub n_samples: usize,
    /// Feature-source ids aligned with `feature_matrix` payloads.
    pub source_ids: Vec<String>,
    /// `(payload id, block)` pairs.
    pub payloads: Vec<(String, PayloadBlock)>,
}

/// An explicit, fingerprinted record of whether sample identity fell back to row
/// position. `used = true` means no aligned sample-id key existed, so identity
/// was derived from row order — a leakage/traceability hazard that must never be
/// silent (`LOCK-IO` / IO-MM-003).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RowPositionFallback {
    /// Whether identity fell back to row position.
    pub used: bool,
    /// Human-readable reason.
    pub reason: String,
    /// Partitions the decision applies to.
    pub partitions: Vec<String>,
    /// SHA-256 (lowercase hex) over the `{used, reason, partitions}` descriptor.
    pub fingerprint: String,
}

/// The target-agnostic v3 dataset package (`AssembledDataset v2`).
#[derive(Debug, Clone, PartialEq)]
pub struct DatasetPackage {
    /// Dataset name.
    pub name: String,
    /// Task type (`regression`, `binary`, `multiclass`, …).
    pub task_type: String,
    /// Dataset-level signal type.
    pub signal_type: String,
    /// Number of logical feature sources.
    pub n_sources: usize,
    /// Repetition/leakage key column, when declared.
    pub repetition: Option<String>,
    /// Scientific identity column names retained from `sample_index`.
    pub identity: IdentityProvenance,
    /// Aggregation policy, carried for lossless round-trip.
    pub aggregate: Option<AggregateSpec>,
    /// Cross-validation folds, carried for lossless round-trip.
    pub folds: Vec<Fold>,
    /// Stable observation IDs for folds, captured before partition reordering.
    pub fold_provenance: Vec<FoldProvenance>,
    /// Assembly warnings, carried for lossless round-trip.
    pub warnings: Vec<String>,
    /// Assembly audits, carried for lossless round-trip.
    pub audits: Vec<Value>,
    /// Per-partition typed payload blocks.
    pub partitions: IndexMap<String, PackagePartition>,
    /// Explicit row-position fallback diagnostic.
    pub row_position_fallback: RowPositionFallback,
}

impl DatasetPackage {
    /// Represent an [`AssembledDataset`] as a v3 package, losslessly. Each `X`
    /// source becomes a [`FeatureMatrix`] (carrying its processings), `y` a
    /// [`TargetTable`], metadata a [`MetadataTable`], weights a [`WeightsVector`].
    /// The row-position fallback decision is computed with the same rule the
    /// bridge uses for identity (aligned sample-id key in every partition).
    pub fn from_assembled(assembled: &AssembledDataset) -> DatasetPackage {
        let row_position_fallback = compute_row_position_fallback(assembled);
        let mut partitions: IndexMap<String, PackagePartition> = IndexMap::new();
        for (part, b) in &assembled.blocks {
            let mut payloads: Vec<(String, PayloadBlock)> = Vec::new();
            for k in 0..b.x.len() {
                let fm = FeatureMatrix {
                    matrix: b.x[k].clone(),
                    headers: b.feature_headers.get(k).cloned().unwrap_or_default(),
                    header_unit: b.header_units.get(k).cloned().unwrap_or_default(),
                    signal_type: b.signal_types.get(k).cloned().flatten(),
                    processings: b.processings.get(k).cloned().unwrap_or_default(),
                };
                payloads.push((format!("{part}/x{k}"), PayloadBlock::FeatureMatrix(fm)));
            }
            if let Some(y) = &b.y {
                let representation_id =
                    target_representation_id(&assembled.task_type, &b.y_headers, &b.y_categorical);
                let tt = TargetTable {
                    matrix: y.clone(),
                    headers: b.y_headers.clone(),
                    categorical: b.y_categorical.clone(),
                    representation_id,
                };
                payloads.push((format!("{part}/y"), PayloadBlock::TargetTable(tt)));
            }
            if let Some(meta) = &b.metadata {
                payloads.push((
                    format!("{part}/metadata"),
                    PayloadBlock::MetadataTable(MetadataTable {
                        frame: meta.clone(),
                    }),
                ));
            }
            if let Some(w) = &b.weights {
                payloads.push((
                    format!("{part}/weights"),
                    PayloadBlock::Weights(WeightsVector {
                        values: w.clone(),
                        header: b.weights_header.clone(),
                    }),
                ));
            }
            partitions.insert(
                part.clone(),
                PackagePartition {
                    n_samples: b.n_samples,
                    source_ids: b.source_ids.clone(),
                    payloads,
                },
            );
        }
        DatasetPackage {
            name: assembled.name.clone(),
            task_type: assembled.task_type.clone(),
            signal_type: assembled.signal_type.clone(),
            n_sources: assembled.n_sources,
            repetition: assembled.repetition.clone(),
            identity: assembled.identity.clone(),
            aggregate: assembled.aggregate.clone(),
            folds: assembled.folds.clone(),
            fold_provenance: assembled.fold_provenance.clone(),
            warnings: assembled.warnings.clone(),
            audits: assembled.audits.clone(),
            partitions,
            row_position_fallback,
        }
    }

    /// Reconstruct the [`AssembledDataset`] this package was built from. The
    /// inverse of [`from_assembled`](Self::from_assembled) over the v2-expressible
    /// payloads — the losslessness proof.
    pub fn to_assembled(&self) -> AssembledDataset {
        let mut blocks: IndexMap<String, PartitionBlock> = IndexMap::new();
        for (part, p) in &self.partitions {
            let mut block = PartitionBlock {
                n_samples: p.n_samples,
                source_ids: p.source_ids.clone(),
                ..Default::default()
            };
            for (_id, payload) in &p.payloads {
                match payload {
                    PayloadBlock::FeatureMatrix(fm) => {
                        block.x.push(fm.matrix.clone());
                        block.feature_headers.push(fm.headers.clone());
                        block.header_units.push(fm.header_unit.clone());
                        block.signal_types.push(fm.signal_type.clone());
                        block.processings.push(fm.processings.clone());
                    }
                    PayloadBlock::TargetTable(tt) => {
                        block.y = Some(tt.matrix.clone());
                        block.y_headers = tt.headers.clone();
                        block.y_categorical = tt.categorical.clone();
                    }
                    PayloadBlock::MetadataTable(mt) => {
                        block.metadata = Some(mt.frame.clone());
                    }
                    PayloadBlock::Weights(w) => {
                        block.weights = Some(w.values.clone());
                        block.weights_header = w.header.clone();
                    }
                    // Package-only payloads have no `PartitionBlock` slot.
                    _ => {}
                }
            }
            blocks.insert(part.clone(), block);
        }
        AssembledDataset {
            name: self.name.clone(),
            task_type: self.task_type.clone(),
            signal_type: self.signal_type.clone(),
            n_sources: self.n_sources,
            blocks,
            folds: self.folds.clone(),
            fold_provenance: self.fold_provenance.clone(),
            repetition: self.repetition.clone(),
            identity: self.identity.clone(),
            aggregate: self.aggregate.clone(),
            warnings: self.warnings.clone(),
            audits: self.audits.clone(),
        }
    }

    /// Build the payload manifest: one row per payload, plus a `root` fingerprint
    /// over the canonical JSON of all rows.
    pub fn manifest(&self) -> PayloadManifest {
        let mut entries: Vec<PayloadManifestEntry> = Vec::new();
        for (part, p) in &self.partitions {
            for (id, payload) in &p.payloads {
                entries.push(payload.manifest_entry(part, id));
            }
        }
        let entries_value = serde_json::to_value(&entries).expect("manifest entries serialize");
        let root = sha256_hex(
            canonical_json(&entries_value)
                .expect("manifest serializes")
                .as_bytes(),
        );
        PayloadManifest { root, entries }
    }

    /// A stable, **bytes-free** canonical summary for goldens. Emits dataset-level
    /// metadata, per-partition sample counts, the payload manifest (hashes /
    /// shapes / storage only — never the payload bytes) and the row-position
    /// fallback diagnostic.
    pub fn to_summary_value(&self) -> Value {
        let mut parts = Map::new();
        for (name, p) in &self.partitions {
            parts.insert(
                name.clone(),
                json!({ "n_samples": p.n_samples, "source_ids": p.source_ids }),
            );
        }
        let aggregate = self.aggregate.as_ref().map(|a| {
            json!({
                "by": a.by,
                "method": a.method.value(),
                "exclude_outliers": a.exclude_outliers,
                "outlier_threshold": a.outlier_threshold,
            })
        });
        let manifest = serde_json::to_value(self.manifest()).expect("manifest serializes");
        let row_position_fallback =
            serde_json::to_value(&self.row_position_fallback).expect("fallback serializes");
        json!({
            "schema_version": DATASET_PACKAGE_VERSION,
            "name": self.name,
            "task_type": self.task_type,
            "signal_type": self.signal_type,
            "n_sources": self.n_sources,
            "repetition": self.repetition,
            "identity": {
                "provenance": identity_provenance_value(&self.identity),
                "row_position_fallback": row_position_fallback,
            },
            "folds": self.folds.iter().map(|(tr, vl)| vec![tr.clone(), vl.clone()]).collect::<Vec<_>>(),
            "fold_provenance": self.fold_provenance.iter().map(|fold| json!({
                "train_observation_ids": fold.train_observation_ids,
                "validation_observation_ids": fold.validation_observation_ids,
            })).collect::<Vec<_>>(),
            "aggregate": aggregate,
            "partitions": Value::Object(parts),
            "manifest": manifest,
        })
    }

    /// The canonical-JSON string of [`to_summary_value`](Self::to_summary_value).
    pub fn to_canonical_summary(&self) -> String {
        canonical_json(&self.to_summary_value()).expect("summary serializes")
    }
}

// --------------------------------------------------------------------------- //
// Helpers                                                                     //
// --------------------------------------------------------------------------- //

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Little-endian `f32` bytes, row-major — matches numpy `float32` C-order
/// `tobytes()` so the hash is stable across a future Python mirror.
fn matrix_bytes(m: &Matrix) -> Vec<u8> {
    let mut out = Vec::with_capacity(m.data.len() * 4);
    for v in &m.data {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// A feature source's canonical bytes: native matrix, then headers, then each
/// named processing variant (name + matrix), so any change to the source's data
/// or processing stack changes the hash.
fn feature_content_bytes(fm: &FeatureMatrix) -> Vec<u8> {
    let mut out = matrix_bytes(&fm.matrix);
    out.extend_from_slice(fm.headers.join("\u{1f}").as_bytes());
    for (name, m) in &fm.processings {
        out.push(0);
        out.extend_from_slice(name.as_bytes());
        out.push(0);
        out.extend_from_slice(&matrix_bytes(m));
    }
    out
}

fn target_content_bytes(tt: &TargetTable) -> Vec<u8> {
    let mut out = matrix_bytes(&tt.matrix);
    out.extend_from_slice(tt.headers.join("\u{1f}").as_bytes());
    let cat = Value::Object(
        tt.categorical
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    );
    out.push(0);
    out.extend_from_slice(
        canonical_json(&cat)
            .expect("categorical serializes")
            .as_bytes(),
    );
    out
}

fn weights_content_bytes(w: &WeightsVector) -> Vec<u8> {
    let mut out = Vec::with_capacity(w.values.len() * 4);
    for v in &w.values {
        out.extend_from_slice(&v.to_le_bytes());
    }
    if let Some(h) = &w.header {
        out.push(0);
        out.extend_from_slice(h.as_bytes());
    }
    out
}

fn cell_value(c: &Cell) -> Value {
    match c {
        Cell::Bool(b) => Value::from(*b),
        Cell::Int(i) => Value::from(*i),
        Cell::Float(f) => Value::from(*f),
        Cell::Str(s) => Value::from(s.clone()),
        Cell::Na => Value::Null,
    }
}

/// A frame's deterministic value (name/dtype/values per column) for hashing.
fn frame_canonical_bytes(f: &Frame) -> String {
    let columns: Vec<Value> = f
        .columns
        .iter()
        .map(|c| {
            json!({
                "name": c.name,
                "dtype": c.dtype.label(),
                "values": c.values.iter().map(cell_value).collect::<Vec<_>>(),
            })
        })
        .collect();
    let v = json!({ "n_rows": f.n_rows, "columns": columns });
    canonical_json(&v).expect("frame serializes")
}

/// Spectral axis name from a header unit — mirrors the bridge's `feature_axis`.
fn feature_axis_name(unit: &str) -> &'static str {
    let u = unit.to_ascii_lowercase();
    if u.contains("nm") || u.contains("nanomet") || u.contains("wavelength") {
        "wavelength"
    } else if u.contains("cm-1")
        || u.contains("cm^-1")
        || u.contains("1/cm")
        || u.contains("wavenumber")
        || u.contains("cm\u{207b}\u{b9}")
    {
        "wavenumber"
    } else {
        "feature"
    }
}

/// Pick a target representation-ID with the same rule the bridge uses: a single
/// target ⇒ `target_numeric` / `target_categorical`; uniform-kind multivariate ⇒
/// the matrix variant; mixed kinds ⇒ `None` (the bridge emits per-target specs).
fn target_representation_id(
    task_type: &str,
    headers: &[String],
    categorical: &IndexMap<String, Value>,
) -> Option<String> {
    if headers.is_empty() {
        return None;
    }
    let is_cat =
        |h: &str| categorical.contains_key(h) || matches!(task_type, "binary" | "multiclass");
    let kinds: Vec<bool> = headers.iter().map(|h| is_cat(h)).collect();
    let all_same = kinds.iter().all(|k| *k == kinds[0]);
    if headers.len() == 1 {
        Some(
            if kinds[0] {
                repr_ids::TARGET_CATEGORICAL
            } else {
                repr_ids::TARGET_NUMERIC
            }
            .to_string(),
        )
    } else if all_same {
        Some(
            if kinds[0] {
                repr_ids::TARGET_CATEGORICAL_MATRIX
            } else {
                repr_ids::TARGET_NUMERIC_MATRIX
            }
            .to_string(),
        )
    } else {
        None
    }
}

/// Decide + describe the row-position fallback with the bridge's identity rule:
/// identity is key-based iff a stable sample-id key is declared and aligned (present,
/// length == `n_samples`) in every partition; otherwise it falls back to row
/// position.
fn compute_row_position_fallback(a: &AssembledDataset) -> RowPositionFallback {
    let partitions: Vec<String> = a.blocks.keys().cloned().collect();
    let sample_id = a.identity.sample_id.as_deref();
    let has_sample_id = sample_id.is_some_and(|col| {
        a.blocks.values().all(|b| {
            b.metadata
                .as_ref()
                .is_some_and(|f| f.has_column(col) && f.str_column(col).len() == b.n_samples)
        })
    });
    let (used, reason) = if has_sample_id {
        (
            false,
            format!(
                "stable sample-id key '{}' is aligned in every partition",
                sample_id.expect("has_sample_id implies a key")
            ),
        )
    } else if let Some(col) = sample_id {
        (
            true,
            format!(
                "sample-id key '{col}' is absent or not aligned in every partition; sample identity falls back to row position"
            ),
        )
    } else {
        (
            true,
            "no stable sample-id key declared; sample identity falls back to row position"
                .to_string(),
        )
    };
    let descriptor = json!({ "used": used, "reason": reason, "partitions": partitions });
    let fingerprint = sha256_hex(
        canonical_json(&descriptor)
            .expect("descriptor serializes")
            .as_bytes(),
    );
    RowPositionFallback {
        used,
        reason,
        partitions,
        fingerprint,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materialize::frame::Column;

    fn matrix(rows: usize, cols: usize) -> Matrix {
        Matrix {
            data: (0..rows * cols).map(|v| v as f32).collect(),
            n_rows: rows,
            n_cols: cols,
        }
    }

    fn base_block() -> PartitionBlock {
        PartitionBlock {
            n_samples: 2,
            source_ids: vec!["spectra".into()],
            x: vec![matrix(2, 3)],
            feature_headers: vec![vec!["1000".into(), "1010".into(), "1020".into()]],
            header_units: vec!["nm".into()],
            signal_types: vec![Some("absorbance".into())],
            processings: vec![vec![]],
            y: Some(matrix(2, 1)),
            y_headers: vec!["protein".into()],
            y_categorical: Default::default(),
            metadata: Some(Frame::from_columns(
                vec![
                    Column::from_cells("batch", vec![Cell::Str("a".into()), Cell::Str("b".into())]),
                    Column::from_cells("rep", vec![Cell::Str("r1".into()), Cell::Str("r2".into())]),
                ],
                "text",
            )),
            weights: Some(vec![1.0, 2.0]),
            weights_header: Some("w".into()),
        }
    }

    fn assembled(block: PartitionBlock) -> AssembledDataset {
        let mut a = AssembledDataset {
            name: "demo".into(),
            task_type: "regression".into(),
            signal_type: "absorbance".into(),
            n_sources: 1,
            blocks: IndexMap::new(),
            folds: vec![],
            fold_provenance: vec![],
            repetition: None,
            identity: IdentityProvenance::default(),
            aggregate: None,
            warnings: vec![],
            audits: vec![],
        };
        a.blocks.insert("train".into(), block);
        a
    }

    fn uri_ref(name: &str, dtype: &str, shape: Vec<usize>, axes: Vec<&str>) -> UriRef {
        let bytes = format!("{name}:{dtype}:{shape:?}");
        UriRef {
            uri: format!("s3://bucket/{name}.bin"),
            dtype: dtype.into(),
            shape,
            axes: axes.into_iter().map(str::to_string).collect(),
            content_hash: sha256_hex(bytes.as_bytes()),
            byte_len: bytes.len() as u64,
            codec: Some("raw".into()),
        }
    }

    #[test]
    fn from_assembled_round_trips_losslessly() {
        let a = assembled(base_block());
        let pkg = DatasetPackage::from_assembled(&a);
        // The v2-expressible payload is reconstructed byte-for-byte.
        assert_eq!(pkg.to_assembled().to_full_value(), a.to_full_value());
    }

    #[test]
    fn round_trip_preserves_multi_source_and_processings() {
        let mut block = base_block();
        block.x.push(matrix(2, 2));
        block
            .feature_headers
            .push(vec!["1200".into(), "1210".into()]);
        block.header_units.push("cm-1".into());
        block.signal_types.push(Some("reflectance".into()));
        block.processings = vec![vec![("snv".into(), matrix(2, 3))], vec![]];
        let mut a = assembled(block);
        a.n_sources = 2;
        let pkg = DatasetPackage::from_assembled(&a);
        assert_eq!(pkg.to_assembled().to_full_value(), a.to_full_value());
    }

    #[test]
    fn summary_is_deterministic_and_carries_no_payload_bytes() {
        let a = assembled(base_block());
        let pkg = DatasetPackage::from_assembled(&a);
        let s1 = pkg.to_canonical_summary();
        let s2 = pkg.to_canonical_summary();
        assert_eq!(s1, s2, "canonical summary must be deterministic");
        // Manifest present, hashes look like SHA-256, bytes are not embedded.
        let manifest = pkg.manifest();
        assert!(manifest.entries.iter().all(|e| e.content_hash.len() == 64));
        assert!(manifest.entries.iter().all(|e| e.byte_len > 0));
        assert_eq!(manifest.root.len(), 64);
        // The feature matrix has raw values 0..6; a payload-carrying JSON would
        // serialize them. The bytes-free summary must not.
        assert!(
            !s1.contains("\"data\""),
            "summary must not embed raw matrix data arrays"
        );
    }

    #[test]
    fn manifest_maps_feature_target_metadata_weights() {
        let a = assembled(base_block());
        let pkg = DatasetPackage::from_assembled(&a);
        let m = pkg.manifest();
        let by_id = |id: &str| m.entries.iter().find(|e| e.id == id).unwrap();
        assert_eq!(
            by_id("train/x0").representation_id.as_deref(),
            Some("signal_1d")
        );
        assert_eq!(by_id("train/x0").axes, vec!["sample", "wavelength"]);
        assert_eq!(
            by_id("train/y").representation_id.as_deref(),
            Some("target_numeric")
        );
        assert_eq!(
            by_id("train/metadata").representation_id.as_deref(),
            Some("sample_metadata")
        );
        assert_eq!(by_id("train/weights").role, "weights");
        assert!(m
            .entries
            .iter()
            .all(|e| e.storage == PayloadStorageKind::Inline));
    }

    #[test]
    fn processing_stack_lifts_to_signal_with_processings() {
        let mut block = base_block();
        block.processings = vec![vec![("snv".into(), matrix(2, 3))]];
        let pkg = DatasetPackage::from_assembled(&assembled(block));
        let e = pkg
            .manifest()
            .entries
            .into_iter()
            .find(|e| e.id == "train/x0")
            .unwrap();
        assert_eq!(
            e.representation_id.as_deref(),
            Some("signal_with_processings")
        );
        assert_eq!(e.axes, vec!["sample", "processing", "wavelength"]);
    }

    #[test]
    fn uniform_multivariate_targets_lift_to_matrix_representation() {
        let mut block = base_block();
        block.y = Some(matrix(2, 2));
        block.y_headers = vec!["protein".into(), "moisture".into()];
        let pkg = DatasetPackage::from_assembled(&assembled(block));
        let e = pkg
            .manifest()
            .entries
            .into_iter()
            .find(|e| e.id == "train/y")
            .unwrap();
        assert_eq!(
            e.representation_id.as_deref(),
            Some("target_numeric_matrix")
        );
        assert_eq!(e.axes, vec!["sample", "target"]);
    }

    #[test]
    fn content_hash_and_root_detect_payload_tampering() {
        let a = assembled(base_block());
        let root0 = DatasetPackage::from_assembled(&a).manifest().root;
        let x0 = DatasetPackage::from_assembled(&a)
            .manifest()
            .entries
            .into_iter()
            .find(|e| e.id == "train/x0")
            .unwrap()
            .content_hash;

        // Flip a single feature value.
        let mut tampered = a.clone();
        tampered.blocks["train"].x[0].data[0] += 1.0;
        let m1 = DatasetPackage::from_assembled(&tampered).manifest();
        let x1 = m1.entries.iter().find(|e| e.id == "train/x0").unwrap();
        assert_ne!(x0, x1.content_hash, "feature hash must change on tamper");
        assert_ne!(root0, m1.root, "manifest root must change on tamper");
    }

    #[test]
    fn row_position_fallback_is_recorded_when_no_key() {
        let pkg = DatasetPackage::from_assembled(&assembled(base_block()));
        let f = &pkg.row_position_fallback;
        assert!(f.used, "no sample-id key ⇒ row-position fallback");
        assert!(f.reason.contains("no stable sample-id key"));
        assert_eq!(f.fingerprint.len(), 64);
        assert_eq!(f.partitions, vec!["train"]);
    }

    #[test]
    fn row_position_fallback_off_when_key_aligned() {
        let mut a = assembled(base_block());
        a.identity.sample_id = Some("rep".into()); // aligned metadata column of len 2
        let pkg = DatasetPackage::from_assembled(&a);
        assert!(!pkg.row_position_fallback.used);
        assert!(pkg
            .row_position_fallback
            .reason
            .contains("sample-id key 'rep'"));
    }

    #[test]
    fn summary_has_one_versioned_identity_object_and_round_trips_provenance() {
        let mut a = assembled(base_block());
        a.identity = IdentityProvenance {
            source_ids: vec!["spectra".into()],
            sample_id: Some("sample_id".into()),
            observation_id: Some("scan_id".into()),
            repetition_id: Some("rep".into()),
            group_id: Some("batch".into()),
        };
        a.fold_provenance = vec![FoldProvenance {
            train_observation_ids: vec!["O1".into()],
            validation_observation_ids: vec!["O2".into()],
        }];
        let package = DatasetPackage::from_assembled(&a);
        let value = package.to_summary_value();
        assert_eq!(value["schema_version"], Value::from(3));
        assert_eq!(
            package.to_assembled().to_full_value()["assembled_schema_version"],
            Value::from(2),
            "the binding-facing assembled wire is explicitly versioned"
        );
        assert_eq!(value["identity"].as_object().unwrap().len(), 2);
        assert_eq!(
            value["identity"]["provenance"]["sample_id"],
            Value::String("sample_id".into())
        );
        assert_eq!(
            package.to_assembled().identity,
            a.identity,
            "package round-trip keeps identity provenance"
        );
        assert_eq!(package.to_assembled().fold_provenance, a.fold_provenance);
    }

    #[test]
    fn v3_cross_language_canonical_summary_matches_golden() {
        let mut a = assembled(base_block());
        a.identity = IdentityProvenance {
            source_ids: vec!["spectra".into()],
            sample_id: Some("sample_id".into()),
            observation_id: Some("observation_id".into()),
            repetition_id: Some("rep".into()),
            group_id: Some("batch".into()),
        };
        a.folds = vec![(vec![0], vec![1])];
        a.fold_provenance = vec![FoldProvenance {
            train_observation_ids: vec!["O1".into()],
            validation_observation_ids: vec!["O2".into()],
        }];
        let metadata = a.blocks["train"].metadata.as_mut().unwrap();
        metadata.columns.push(Column::from_cells(
            "sample_id",
            vec![Cell::Str("S1".into()), Cell::Str("S2".into())],
        ));
        metadata.columns.push(Column::from_cells(
            "observation_id",
            vec![Cell::Str("O1".into()), Cell::Str("O2".into())],
        ));

        assert_eq!(
            DatasetPackage::from_assembled(&a).to_canonical_summary(),
            include_str!("../../../../tests/goldens/dataset_package_v3.cross_language.canonical")
        );
    }

    #[test]
    fn repetition_does_not_disable_row_position_fallback() {
        let mut a = assembled(base_block());
        a.repetition = Some("rep".into());
        assert!(
            DatasetPackage::from_assembled(&a)
                .row_position_fallback
                .used
        );
    }

    #[test]
    fn uri_backed_payload_references_bytes_without_embedding() {
        let uri = UriRef {
            uri: "s3://bucket/cube.npy".into(),
            dtype: "float32".into(),
            shape: vec![4, 128, 128, 3],
            axes: vec![
                "sample".into(),
                "height".into(),
                "width".into(),
                "channel".into(),
            ],
            content_hash: "a".repeat(64),
            byte_len: 4 * 128 * 128 * 3 * 4,
            codec: Some("npy".into()),
        };
        let tensor = PayloadBlock::NdTensor(NdTensor {
            representation_id: repr_ids::RGB_IMAGE.into(),
            dtype: "uint8".into(),
            shape: vec![4, 128, 128, 3],
            axis_names: vec![
                "sample".into(),
                "height".into(),
                "width".into(),
                "channel".into(),
            ],
            observation_ids: vec!["o0".into(), "o1".into(), "o2".into(), "o3".into()],
            uri: uri.clone(),
        });
        let e = tensor.manifest_entry("train", "train/img");
        assert_eq!(e.storage, PayloadStorageKind::Uri);
        assert_eq!(e.uri.as_deref(), Some("s3://bucket/cube.npy"));
        assert_eq!(e.content_hash, uri.content_hash);
        assert_eq!(e.byte_len, uri.byte_len);
        assert_eq!(e.representation_id.as_deref(), Some("rgb_image"));

        // A package carrying it summarizes without embedding any tensor bytes.
        let mut pkg = DatasetPackage::from_assembled(&assembled(base_block()));
        pkg.partitions["train"]
            .payloads
            .push(("train/img".into(), tensor));
        let summary = pkg.to_canonical_summary();
        assert!(summary.contains("s3://bucket/cube.npy"));
        assert!(summary.contains("\"uri\""));
        assert!(!summary.contains("\"data\""));
    }

    #[test]
    fn spectral_record_set_manifest_hashes_inline_records() {
        let records = PayloadBlock::SpectralRecordSet(SpectralRecordSet {
            records: vec![
                json!({
                    "metadata": {"sample_id": "s1"},
                    "signals": {"absorbance": {"values": [0.1, 0.2]}}
                }),
                json!({
                    "metadata": {"sample_id": "s2"},
                    "signals": {"absorbance": {"values": [0.3, 0.4]}}
                }),
            ],
        });
        let entry = records.manifest_entry("train", "train/records");
        assert_eq!(entry.role, "features");
        assert_eq!(entry.payload_kind, "spectral_record_set");
        assert_eq!(entry.dtype, "records");
        assert_eq!(entry.shape, vec![2]);
        assert_eq!(entry.axes, vec!["sample"]);
        assert_eq!(entry.storage, PayloadStorageKind::Inline);
        assert!(entry.byte_len > 0);

        let tampered = PayloadBlock::SpectralRecordSet(SpectralRecordSet {
            records: vec![json!({
                "metadata": {"sample_id": "s1"},
                "signals": {"absorbance": {"values": [0.1, 0.9]}}
            })],
        });
        let tampered_entry = tampered.manifest_entry("train", "train/records");
        assert_ne!(entry.content_hash, tampered_entry.content_hash);
    }

    #[test]
    fn uri_backed_declared_variants_have_distinct_manifest_shapes() {
        let sequence_uri = uri_ref(
            "series",
            "float32",
            vec![2, 10, 3],
            vec!["sample", "time", "channel"],
        );
        let genotype_uri = uri_ref("dosage", "uint8", vec![2, 4], vec!["sample", "variant"]);
        let mask_uri = uri_ref(
            "mask",
            "bool",
            vec![2, 64, 64],
            vec!["sample", "height", "width"],
        );
        let bare_uri = uri_ref(
            "cube",
            "uint16",
            vec![2, 8, 8, 16],
            vec!["sample", "height", "width", "band"],
        );

        let cases = vec![
            (
                PayloadBlock::SequenceBlock(SequenceBlock {
                    representation_id: "series_mv".into(),
                    dtype: "float32".into(),
                    n_channels: 3,
                    lengths: vec![10, 10],
                    uri: sequence_uri.clone(),
                }),
                "sequence_block",
                Some("series_mv"),
                "features",
                vec![2, 10, 3],
                vec!["sample", "time", "channel"],
                sequence_uri,
            ),
            (
                PayloadBlock::GenotypeMatrix(GenotypeMatrix {
                    representation_id: "dosage_matrix".into(),
                    n_variants: 4,
                    n_samples: 2,
                    encoding: "dosage".into(),
                    uri: genotype_uri.clone(),
                }),
                "genotype_matrix",
                Some("dosage_matrix"),
                "features",
                vec![2, 4],
                vec!["sample", "variant"],
                genotype_uri,
            ),
            (
                PayloadBlock::MaskBlock(MaskBlock {
                    representation_id: "segmentation_mask".into(),
                    dtype: "bool".into(),
                    shape: vec![2, 64, 64],
                    uri: mask_uri.clone(),
                }),
                "mask_block",
                Some("segmentation_mask"),
                "mask",
                vec![2, 64, 64],
                vec!["sample", "height", "width"],
                mask_uri,
            ),
            (
                PayloadBlock::UriBackedPayload(bare_uri.clone()),
                "uri_backed",
                None,
                "features",
                vec![2, 8, 8, 16],
                vec!["sample", "height", "width", "band"],
                bare_uri,
            ),
        ];

        for (payload, kind, repr, role, shape, axes, uri) in cases {
            let entry = payload.manifest_entry("train", kind);
            assert_eq!(entry.payload_kind, kind);
            assert_eq!(entry.representation_id.as_deref(), repr);
            assert_eq!(entry.role, role);
            assert_eq!(entry.shape, shape);
            assert_eq!(entry.axes, axes);
            assert_eq!(entry.storage, PayloadStorageKind::Uri);
            assert_eq!(entry.uri.as_deref(), Some(uri.uri.as_str()));
            assert_eq!(entry.content_hash, uri.content_hash);
            assert_eq!(entry.byte_len, uri.byte_len);
            assert_eq!(entry.codec, uri.codec);
        }
    }
}
