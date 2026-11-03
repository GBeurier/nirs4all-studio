//! Canonical built-in data-model declarations.
//!
//! These constructors give host bindings and aggregate distributions one shared
//! vocabulary for common scientific data shapes. They intentionally describe
//! schemas and planner-visible adapters only; payload loading, feature
//! extraction and numerical execution stay in the owning host/provider crates.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::adapter::{
    AdapterRegistrySpec, AdapterSpec, InputPortSpec, ModelInputSpec, PlanningPolicy,
};
use crate::ids::{RepresentationId, SourceId, TypeId};
use crate::model::{
    AxisKind, AxisSpec, RepresentationSpec, SignalKind, SourceDescriptor, SourceGranularity,
};
use crate::plan::FitScope;

pub const TYPE_DENSE_SIGNAL: &str = "dense_signal";
pub const TYPE_TABLE: &str = "table";
pub const TYPE_MULTI_BLOCK: &str = "multi_block";
pub const TYPE_TIME_SERIES: &str = "time_series";
pub const TYPE_GENOTYPE_MATRIX: &str = "genotype_matrix";
pub const TYPE_IMAGE_RGB: &str = "image_rgb";
pub const TYPE_GRAY_IMAGE: &str = "gray_image";
pub const TYPE_MULTICHANNEL_IMAGE: &str = "multichannel_image";
pub const TYPE_HYPERSPECTRAL_CUBE: &str = "hyperspectral_cube";
pub const TYPE_LABEL_MASK: &str = "label_mask";
pub const TYPE_METADATA: &str = "metadata";
pub const TYPE_TARGET: &str = "target";
pub const TYPE_MASS_SPEC: &str = "mass_spec";
pub const TYPE_TEXT: &str = "text";

pub const REPRESENTATION_SIGNAL_1D: &str = "signal_1d";
pub const REPRESENTATION_SIGNAL_WITH_PROCESSINGS: &str = "signal_with_processings";
pub const REPRESENTATION_RAMAN_SIGNAL: &str = "raman_signal";
pub const REPRESENTATION_FTIR_SIGNAL: &str = "ftir_signal";
pub const REPRESENTATION_TABULAR_NUMERIC: &str = "tabular_numeric";
pub const REPRESENTATION_TABULAR_MIXED: &str = "tabular_mixed";
pub const REPRESENTATION_FEATURE_BLOCK_SET: &str = "feature_block_set";
pub const REPRESENTATION_SERIES_MV: &str = "series_mv";
pub const REPRESENTATION_CLIMATE_SERIES_MV: &str = "climate_series_mv";
pub const REPRESENTATION_VARIANT_MATRIX: &str = "variant_matrix";
pub const REPRESENTATION_DOSAGE_MATRIX: &str = "dosage_matrix";
pub const REPRESENTATION_RGB_IMAGE: &str = "rgb_image";
pub const REPRESENTATION_GRAY_IMAGE: &str = "gray_image";
pub const REPRESENTATION_MC_IMAGE: &str = "mc_image";
pub const REPRESENTATION_MULTISPECTRAL_IMAGE: &str = "multispectral_image";
pub const REPRESENTATION_CUBE_HWB: &str = "cube_hwb";
pub const REPRESENTATION_HYPERSPECTRAL_CUBE: &str = REPRESENTATION_CUBE_HWB;
pub const REPRESENTATION_SEGMENTATION_MASK: &str = "segmentation_mask";
pub const REPRESENTATION_ROI_MASK: &str = "roi_mask";
pub const REPRESENTATION_SAMPLE_METADATA: &str = "sample_metadata";
pub const REPRESENTATION_TARGET_NUMERIC: &str = "target_numeric";
pub const REPRESENTATION_TARGET_CATEGORICAL: &str = "target_categorical";
pub const REPRESENTATION_TARGET_NUMERIC_MATRIX: &str = "target_numeric_matrix";
pub const REPRESENTATION_TARGET_CATEGORICAL_MATRIX: &str = "target_categorical_matrix";
pub const REPRESENTATION_MASS_SPECTRUM: &str = "mass_spectrum";
pub const REPRESENTATION_TEXT_RAW: &str = "text_raw";
pub const REPRESENTATION_TEXT_TOKEN_IDS: &str = "text_token_ids";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum BuiltinDataModel {
    NirsSignal1d,
    NirsSignalWithProcessings,
    RamanSignal,
    FtirSignal,
    TabularNumeric,
    TabularMixed,
    FeatureBlockSet,
    SeriesMultivariate,
    ClimateSeriesMultivariate,
    GenotypeVariantMatrix,
    GenotypeDosageMatrix,
    RgbImage,
    GrayImage,
    MultichannelImage,
    MultispectralImage,
    HyperspectralCube,
    SegmentationMask,
    RoiMask,
    SampleMetadata,
    TargetNumeric,
    TargetCategorical,
    TargetNumericMatrix,
    TargetCategoricalMatrix,
    MassSpectrum,
    TextRaw,
    TextTokenIds,
}

pub const BUILTIN_DATA_MODELS: &[BuiltinDataModel] = &[
    BuiltinDataModel::NirsSignal1d,
    BuiltinDataModel::NirsSignalWithProcessings,
    BuiltinDataModel::RamanSignal,
    BuiltinDataModel::FtirSignal,
    BuiltinDataModel::TabularNumeric,
    BuiltinDataModel::TabularMixed,
    BuiltinDataModel::FeatureBlockSet,
    BuiltinDataModel::SeriesMultivariate,
    BuiltinDataModel::ClimateSeriesMultivariate,
    BuiltinDataModel::GenotypeVariantMatrix,
    BuiltinDataModel::GenotypeDosageMatrix,
    BuiltinDataModel::RgbImage,
    BuiltinDataModel::GrayImage,
    BuiltinDataModel::MultichannelImage,
    BuiltinDataModel::MultispectralImage,
    BuiltinDataModel::HyperspectralCube,
    BuiltinDataModel::SegmentationMask,
    BuiltinDataModel::RoiMask,
    BuiltinDataModel::SampleMetadata,
    BuiltinDataModel::TargetNumeric,
    BuiltinDataModel::TargetCategorical,
    BuiltinDataModel::TargetNumericMatrix,
    BuiltinDataModel::TargetCategoricalMatrix,
    BuiltinDataModel::MassSpectrum,
    BuiltinDataModel::TextRaw,
    BuiltinDataModel::TextTokenIds,
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BuiltinDataModelSpec {
    pub key: String,
    pub modality: String,
    pub representation: RepresentationSpec,
}

impl BuiltinDataModelSpec {
    pub fn source_descriptor(
        &self,
        source_id: impl Into<String>,
        name: impl Into<String>,
        sample_key: impl Into<String>,
        granularity: SourceGranularity,
    ) -> crate::Result<SourceDescriptor> {
        let descriptor = SourceDescriptor {
            id: SourceId::new(source_id)?,
            name: name.into(),
            type_id: self.representation.type_id.clone(),
            modality: self.modality.clone(),
            native_representation: self.representation.clone(),
            sample_key: sample_key.into(),
            granularity,
            schema: BTreeMap::new(),
            tags: BTreeMap::new(),
            shape_contract: None,
        };
        descriptor.validate()?;
        Ok(descriptor)
    }
}

impl BuiltinDataModel {
    pub fn key(self) -> &'static str {
        match self {
            Self::NirsSignal1d => "nirs.signal_1d",
            Self::NirsSignalWithProcessings => "nirs.signal_with_processings",
            Self::RamanSignal => "spectroscopy.raman_signal",
            Self::FtirSignal => "spectroscopy.ftir_signal",
            Self::TabularNumeric => "tabular.numeric",
            Self::TabularMixed => "tabular.mixed",
            Self::FeatureBlockSet => "features.block_set",
            Self::SeriesMultivariate => "series.multivariate",
            Self::ClimateSeriesMultivariate => "climate.series_multivariate",
            Self::GenotypeVariantMatrix => "genotype.variant_matrix",
            Self::GenotypeDosageMatrix => "genotype.dosage_matrix",
            Self::RgbImage => "image.rgb",
            Self::GrayImage => "image.gray",
            Self::MultichannelImage => "image.multichannel",
            Self::MultispectralImage => "image.multispectral",
            Self::HyperspectralCube => "hyperspectral.cube",
            Self::SegmentationMask => "image.segmentation_mask",
            Self::RoiMask => "image.roi_mask",
            Self::SampleMetadata => "metadata.sample",
            Self::TargetNumeric => "target.numeric",
            Self::TargetCategorical => "target.categorical",
            Self::TargetNumericMatrix => "target.numeric_matrix",
            Self::TargetCategoricalMatrix => "target.categorical_matrix",
            Self::MassSpectrum => "mass_spec.spectrum",
            Self::TextRaw => "text.raw",
            Self::TextTokenIds => "text.token_ids",
        }
    }

    pub fn modality(self) -> &'static str {
        match self {
            Self::NirsSignal1d | Self::NirsSignalWithProcessings => "nirs",
            Self::RamanSignal => "raman",
            Self::FtirSignal => "ftir",
            Self::TabularNumeric | Self::TabularMixed => "tabular",
            Self::FeatureBlockSet => "multi_block",
            Self::SeriesMultivariate => "time_series",
            Self::ClimateSeriesMultivariate => "climate",
            Self::GenotypeVariantMatrix | Self::GenotypeDosageMatrix => "genotype",
            Self::RgbImage
            | Self::GrayImage
            | Self::MultichannelImage
            | Self::MultispectralImage => "image",
            Self::HyperspectralCube => "hyperspectral",
            Self::SegmentationMask | Self::RoiMask => "image_mask",
            Self::SampleMetadata => "metadata",
            Self::TargetNumeric
            | Self::TargetCategorical
            | Self::TargetNumericMatrix
            | Self::TargetCategoricalMatrix => "target",
            Self::MassSpectrum => "mass_spec",
            Self::TextRaw | Self::TextTokenIds => "text",
        }
    }

    pub fn representation(self) -> RepresentationSpec {
        match self {
            Self::NirsSignal1d => signal_1d(SignalKind::Unknown),
            Self::NirsSignalWithProcessings => signal_with_processings(SignalKind::Unknown),
            Self::RamanSignal => raman_signal(),
            Self::FtirSignal => ftir_signal(),
            Self::TabularNumeric => tabular_numeric(),
            Self::TabularMixed => tabular_mixed(),
            Self::FeatureBlockSet => feature_block_set(),
            Self::SeriesMultivariate => series_mv(REPRESENTATION_SERIES_MV),
            Self::ClimateSeriesMultivariate => series_mv(REPRESENTATION_CLIMATE_SERIES_MV),
            Self::GenotypeVariantMatrix => genotype_variant_matrix(),
            Self::GenotypeDosageMatrix => genotype_dosage_matrix(),
            Self::RgbImage => rgb_image(),
            Self::GrayImage => gray_image(),
            Self::MultichannelImage => multichannel_image(),
            Self::MultispectralImage => multispectral_image(),
            Self::HyperspectralCube => hyperspectral_cube(),
            Self::SegmentationMask => segmentation_mask(),
            Self::RoiMask => roi_mask(),
            Self::SampleMetadata => sample_metadata(),
            Self::TargetNumeric => target_numeric(),
            Self::TargetCategorical => target_categorical(),
            Self::TargetNumericMatrix => target_numeric_matrix(),
            Self::TargetCategoricalMatrix => target_categorical_matrix(),
            Self::MassSpectrum => mass_spectrum(),
            Self::TextRaw => text_raw(),
            Self::TextTokenIds => text_token_ids(),
        }
    }

    pub fn spec(self) -> BuiltinDataModelSpec {
        BuiltinDataModelSpec {
            key: self.key().to_string(),
            modality: self.modality().to_string(),
            representation: self.representation(),
        }
    }
}

pub fn builtin_data_model_specs() -> Vec<BuiltinDataModelSpec> {
    BUILTIN_DATA_MODELS
        .iter()
        .copied()
        .map(BuiltinDataModel::spec)
        .collect()
}

pub fn builtin_representations() -> Vec<RepresentationSpec> {
    BUILTIN_DATA_MODELS
        .iter()
        .copied()
        .map(BuiltinDataModel::representation)
        .collect()
}

pub fn tabular_numeric_model_input_spec() -> ModelInputSpec {
    ModelInputSpec {
        ports: vec![InputPortSpec {
            name: "x".to_string(),
            accepted_representations: vec![rid(REPRESENTATION_TABULAR_NUMERIC)],
            accepted_types: vec![tid(TYPE_TABLE)],
            rank: Some(2),
            multi_source: true,
            optional: false,
        }],
        default_fusion: None,
    }
}

pub fn builtin_adapter_registry_spec() -> AdapterRegistrySpec {
    AdapterRegistrySpec {
        adapters: vec![
            stateless_adapter(
                "spectra.flatten",
                TYPE_DENSE_SIGNAL,
                REPRESENTATION_SIGNAL_WITH_PROCESSINGS,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                10,
                false,
            ),
            stateless_adapter(
                "spectra.identity_features",
                TYPE_DENSE_SIGNAL,
                REPRESENTATION_SIGNAL_1D,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                5,
                false,
            ),
            stateless_adapter(
                "spectra.raman_flatten",
                TYPE_DENSE_SIGNAL,
                REPRESENTATION_RAMAN_SIGNAL,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                8,
                false,
            ),
            stateless_adapter(
                "spectra.ftir_flatten",
                TYPE_DENSE_SIGNAL,
                REPRESENTATION_FTIR_SIGNAL,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                8,
                false,
            ),
            stateless_adapter(
                "features.blocks.flatten",
                TYPE_MULTI_BLOCK,
                REPRESENTATION_FEATURE_BLOCK_SET,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                5,
                false,
            ),
            stateless_adapter(
                "weather.aggregate",
                TYPE_TIME_SERIES,
                REPRESENTATION_CLIMATE_SERIES_MV,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                20,
                true,
            ),
            stateless_adapter(
                "series.aggregate",
                TYPE_TIME_SERIES,
                REPRESENTATION_SERIES_MV,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                20,
                true,
            ),
            stateless_adapter(
                "genotype.dosage",
                TYPE_GENOTYPE_MATRIX,
                REPRESENTATION_VARIANT_MATRIX,
                TYPE_GENOTYPE_MATRIX,
                REPRESENTATION_DOSAGE_MATRIX,
                8,
                false,
            ),
            stateful_adapter(
                "genotype.pca",
                TYPE_GENOTYPE_MATRIX,
                REPRESENTATION_DOSAGE_MATRIX,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                30,
                true,
            ),
            stateful_adapter(
                "tabular.encoder",
                TYPE_TABLE,
                REPRESENTATION_TABULAR_MIXED,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                15,
                false,
            ),
            stateless_adapter(
                "image.channel_stats",
                TYPE_IMAGE_RGB,
                REPRESENTATION_RGB_IMAGE,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                25,
                true,
            ),
            stateless_adapter(
                "image.gray_stats",
                TYPE_GRAY_IMAGE,
                REPRESENTATION_GRAY_IMAGE,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                20,
                true,
            ),
            stateless_adapter(
                "image.multichannel_stats",
                TYPE_MULTICHANNEL_IMAGE,
                REPRESENTATION_MC_IMAGE,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                30,
                true,
            ),
            stateless_adapter(
                "image.multispectral_stats",
                TYPE_MULTICHANNEL_IMAGE,
                REPRESENTATION_MULTISPECTRAL_IMAGE,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                30,
                true,
            ),
            stateful_adapter(
                "image.embedding",
                TYPE_IMAGE_RGB,
                REPRESENTATION_RGB_IMAGE,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                60,
                true,
            ),
            stateless_adapter(
                "image.raw_tensor_chw",
                TYPE_IMAGE_RGB,
                REPRESENTATION_RGB_IMAGE,
                TYPE_MULTICHANNEL_IMAGE,
                REPRESENTATION_MC_IMAGE,
                5,
                false,
            ),
            stateless_adapter(
                "hsi.spatial_mean",
                TYPE_HYPERSPECTRAL_CUBE,
                REPRESENTATION_HYPERSPECTRAL_CUBE,
                TYPE_DENSE_SIGNAL,
                REPRESENTATION_SIGNAL_1D,
                20,
                true,
            ),
            stateless_adapter(
                "hsi.flatten",
                TYPE_HYPERSPECTRAL_CUBE,
                REPRESENTATION_HYPERSPECTRAL_CUBE,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                80,
                false,
            ),
            stateless_adapter(
                "mask.area_features",
                TYPE_LABEL_MASK,
                REPRESENTATION_SEGMENTATION_MASK,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                15,
                true,
            ),
            stateless_adapter(
                "mask.roi_area_features",
                TYPE_LABEL_MASK,
                REPRESENTATION_ROI_MASK,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                10,
                true,
            ),
            stateful_adapter(
                "metadata.encoder",
                TYPE_METADATA,
                REPRESENTATION_SAMPLE_METADATA,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                15,
                true,
            ),
            stateless_adapter(
                "ms.bin_to_table",
                TYPE_MASS_SPEC,
                REPRESENTATION_MASS_SPECTRUM,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                25,
                true,
            ),
            stateful_adapter(
                "text.embedding",
                TYPE_TEXT,
                REPRESENTATION_TEXT_RAW,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                50,
                true,
            ),
            stateless_adapter(
                "text.bag_of_tokens",
                TYPE_TEXT,
                REPRESENTATION_TEXT_TOKEN_IDS,
                TYPE_TABLE,
                REPRESENTATION_TABULAR_NUMERIC,
                35,
                true,
            ),
        ],
    }
}

pub fn default_builtin_planning_policy() -> PlanningPolicy {
    PlanningPolicy {
        allow_lossy: true,
        allow_stateful: true,
        allow_supervised: false,
        require_user_choice_on_ambiguity: true,
        max_hops: Some(4),
        ..PlanningPolicy::default()
    }
}

pub fn signal_1d(signal_type: SignalKind) -> RepresentationSpec {
    representation(
        REPRESENTATION_SIGNAL_1D,
        TYPE_DENSE_SIGNAL,
        Some(2),
        vec![
            sample_axis(),
            axis("wavelength", AxisKind::Wavelength, Some("nm"), None, false),
        ],
        RepresentationStorage::new("ndarray", Some("float64"), false, false, Some(signal_type)),
    )
}

pub fn signal_with_processings(signal_type: SignalKind) -> RepresentationSpec {
    representation(
        REPRESENTATION_SIGNAL_WITH_PROCESSINGS,
        TYPE_DENSE_SIGNAL,
        Some(3),
        vec![
            sample_axis(),
            axis("processing", AxisKind::Processing, None, None, false),
            axis("wavelength", AxisKind::Wavelength, Some("nm"), None, false),
        ],
        RepresentationStorage::new("ndarray", Some("float64"), false, false, Some(signal_type)),
    )
}

pub fn raman_signal() -> RepresentationSpec {
    spectroscopy_signal(REPRESENTATION_RAMAN_SIGNAL)
}

pub fn ftir_signal() -> RepresentationSpec {
    spectroscopy_signal(REPRESENTATION_FTIR_SIGNAL)
}

pub fn tabular_numeric() -> RepresentationSpec {
    representation(
        REPRESENTATION_TABULAR_NUMERIC,
        TYPE_TABLE,
        Some(2),
        vec![
            sample_axis(),
            axis("feature", AxisKind::Feature, None, None, false),
        ],
        RepresentationStorage::new("dataframe", Some("float64"), false, false, None),
    )
}

pub fn tabular_mixed() -> RepresentationSpec {
    representation(
        REPRESENTATION_TABULAR_MIXED,
        TYPE_TABLE,
        Some(2),
        vec![
            sample_axis(),
            axis("column", AxisKind::Feature, None, None, false),
        ],
        RepresentationStorage::new("dataframe", None, false, false, None),
    )
}

pub fn feature_block_set() -> RepresentationSpec {
    representation(
        REPRESENTATION_FEATURE_BLOCK_SET,
        TYPE_MULTI_BLOCK,
        Some(3),
        vec![
            sample_axis(),
            axis("block", AxisKind::Feature, None, None, false),
            axis("feature", AxisKind::Feature, None, None, true),
        ],
        RepresentationStorage::new("feature_block_set", Some("float64"), false, true, None),
    )
}

pub fn series_mv(representation_id: &str) -> RepresentationSpec {
    representation(
        representation_id,
        TYPE_TIME_SERIES,
        Some(3),
        vec![
            sample_axis(),
            axis("time", AxisKind::Time, None, None, true),
            axis("variable", AxisKind::Feature, None, None, false),
        ],
        RepresentationStorage::new("ndarray", Some("float64"), false, true, None),
    )
}

pub fn genotype_variant_matrix() -> RepresentationSpec {
    representation(
        REPRESENTATION_VARIANT_MATRIX,
        TYPE_GENOTYPE_MATRIX,
        Some(2),
        vec![
            sample_axis(),
            axis("variant", AxisKind::Variant, None, None, false),
        ],
        RepresentationStorage::new("ndarray", Some("int8"), false, false, None),
    )
}

pub fn genotype_dosage_matrix() -> RepresentationSpec {
    representation(
        REPRESENTATION_DOSAGE_MATRIX,
        TYPE_GENOTYPE_MATRIX,
        Some(2),
        vec![
            sample_axis(),
            axis("variant", AxisKind::Variant, None, None, false),
        ],
        RepresentationStorage::new("ndarray", Some("float32"), false, false, None),
    )
}

pub fn rgb_image() -> RepresentationSpec {
    representation(
        REPRESENTATION_RGB_IMAGE,
        TYPE_IMAGE_RGB,
        Some(4),
        vec![
            sample_axis(),
            axis("height", AxisKind::Height, Some("px"), None, false),
            axis("width", AxisKind::Width, Some("px"), None, false),
            axis("channel", AxisKind::Channel, None, Some(3), false),
        ],
        RepresentationStorage::new("ndarray", Some("uint8"), false, false, None),
    )
}

pub fn gray_image() -> RepresentationSpec {
    representation(
        REPRESENTATION_GRAY_IMAGE,
        TYPE_GRAY_IMAGE,
        Some(3),
        vec![
            sample_axis(),
            axis("height", AxisKind::Height, Some("px"), None, false),
            axis("width", AxisKind::Width, Some("px"), None, false),
        ],
        RepresentationStorage::new("ndarray", Some("uint8"), false, false, None),
    )
}

pub fn multichannel_image() -> RepresentationSpec {
    representation(
        REPRESENTATION_MC_IMAGE,
        TYPE_MULTICHANNEL_IMAGE,
        Some(4),
        vec![
            sample_axis(),
            axis("height", AxisKind::Height, Some("px"), None, false),
            axis("width", AxisKind::Width, Some("px"), None, false),
            axis("channel", AxisKind::Channel, None, None, false),
        ],
        RepresentationStorage::new("ndarray", Some("float32"), false, false, None),
    )
}

pub fn multispectral_image() -> RepresentationSpec {
    representation(
        REPRESENTATION_MULTISPECTRAL_IMAGE,
        TYPE_MULTICHANNEL_IMAGE,
        Some(4),
        vec![
            sample_axis(),
            axis("height", AxisKind::Height, Some("px"), None, false),
            axis("width", AxisKind::Width, Some("px"), None, false),
            axis("band", AxisKind::Channel, None, None, false),
        ],
        RepresentationStorage::new("ndarray", Some("float32"), false, false, None),
    )
}

pub fn hyperspectral_cube() -> RepresentationSpec {
    representation(
        REPRESENTATION_HYPERSPECTRAL_CUBE,
        TYPE_HYPERSPECTRAL_CUBE,
        Some(4),
        vec![
            sample_axis(),
            axis("height", AxisKind::Height, Some("px"), None, false),
            axis("width", AxisKind::Width, Some("px"), None, false),
            axis("band", AxisKind::Wavelength, Some("nm"), None, false),
        ],
        RepresentationStorage::new("ndarray", Some("float32"), false, false, None),
    )
}

pub fn segmentation_mask() -> RepresentationSpec {
    representation(
        REPRESENTATION_SEGMENTATION_MASK,
        TYPE_LABEL_MASK,
        Some(3),
        vec![
            sample_axis(),
            axis("height", AxisKind::Height, Some("px"), None, false),
            axis("width", AxisKind::Width, Some("px"), None, false),
        ],
        RepresentationStorage::new("ndarray", Some("int32"), false, false, None),
    )
}

pub fn roi_mask() -> RepresentationSpec {
    representation(
        REPRESENTATION_ROI_MASK,
        TYPE_LABEL_MASK,
        Some(3),
        vec![
            sample_axis(),
            axis("height", AxisKind::Height, Some("px"), None, false),
            axis("width", AxisKind::Width, Some("px"), None, false),
        ],
        RepresentationStorage::new("ndarray", Some("bool"), false, false, None),
    )
}

pub fn sample_metadata() -> RepresentationSpec {
    representation(
        REPRESENTATION_SAMPLE_METADATA,
        TYPE_METADATA,
        Some(2),
        vec![
            sample_axis(),
            axis("field", AxisKind::Feature, None, None, false),
        ],
        RepresentationStorage::new("dataframe", None, false, false, None),
    )
}

pub fn target_numeric() -> RepresentationSpec {
    representation(
        REPRESENTATION_TARGET_NUMERIC,
        TYPE_TARGET,
        Some(1),
        vec![sample_axis()],
        RepresentationStorage::new("array", Some("float64"), false, false, None),
    )
}

pub fn target_categorical() -> RepresentationSpec {
    representation(
        REPRESENTATION_TARGET_CATEGORICAL,
        TYPE_TARGET,
        Some(1),
        vec![sample_axis()],
        RepresentationStorage::new("array", Some("string"), false, false, None),
    )
}

pub fn target_numeric_matrix() -> RepresentationSpec {
    target_matrix(REPRESENTATION_TARGET_NUMERIC_MATRIX, Some("float64"))
}

pub fn target_categorical_matrix() -> RepresentationSpec {
    target_matrix(REPRESENTATION_TARGET_CATEGORICAL_MATRIX, Some("string"))
}

pub fn mass_spectrum() -> RepresentationSpec {
    representation(
        REPRESENTATION_MASS_SPECTRUM,
        TYPE_MASS_SPEC,
        Some(2),
        vec![
            sample_axis(),
            axis("mz", AxisKind::Feature, Some("m/z"), None, true),
        ],
        RepresentationStorage::new("ragged_array", Some("float64"), false, true, None),
    )
}

pub fn text_raw() -> RepresentationSpec {
    representation(
        REPRESENTATION_TEXT_RAW,
        TYPE_TEXT,
        Some(1),
        vec![sample_axis()],
        RepresentationStorage::new("list", Some("string"), false, true, None),
    )
}

pub fn text_token_ids() -> RepresentationSpec {
    representation(
        REPRESENTATION_TEXT_TOKEN_IDS,
        TYPE_TEXT,
        Some(2),
        vec![
            sample_axis(),
            axis("token", AxisKind::Token, None, None, true),
        ],
        RepresentationStorage::new("ragged_array", Some("int32"), false, true, None),
    )
}

fn target_matrix(representation_id: &str, dtype: Option<&str>) -> RepresentationSpec {
    representation(
        representation_id,
        TYPE_TARGET,
        Some(2),
        vec![
            sample_axis(),
            axis("target", AxisKind::Target, None, None, false),
        ],
        RepresentationStorage::new("array", dtype, false, false, None),
    )
}

fn spectroscopy_signal(representation_id: &str) -> RepresentationSpec {
    representation(
        representation_id,
        TYPE_DENSE_SIGNAL,
        Some(2),
        vec![
            sample_axis(),
            axis(
                "wavenumber",
                AxisKind::Wavenumber,
                Some("cm^-1"),
                None,
                false,
            ),
        ],
        RepresentationStorage::new(
            "ndarray",
            Some("float64"),
            false,
            false,
            Some(SignalKind::Unknown),
        ),
    )
}

struct RepresentationStorage<'a> {
    container: &'a str,
    dtype: Option<&'a str>,
    sparse: bool,
    ragged: bool,
    signal_type: Option<SignalKind>,
}

impl<'a> RepresentationStorage<'a> {
    fn new(
        container: &'a str,
        dtype: Option<&'a str>,
        sparse: bool,
        ragged: bool,
        signal_type: Option<SignalKind>,
    ) -> Self {
        Self {
            container,
            dtype,
            sparse,
            ragged,
            signal_type,
        }
    }
}

fn representation(
    id: &str,
    type_id: &str,
    rank: Option<usize>,
    axes: Vec<AxisSpec>,
    storage: RepresentationStorage<'_>,
) -> RepresentationSpec {
    RepresentationSpec {
        id: rid(id),
        type_id: tid(type_id),
        rank,
        axes,
        container: storage.container.to_string(),
        dtype: storage.dtype.map(str::to_string),
        sparse: storage.sparse,
        ragged: storage.ragged,
        signal_type: storage.signal_type,
    }
}

fn sample_axis() -> AxisSpec {
    axis("sample", AxisKind::Sample, None, None, false)
}

fn axis(
    name: &str,
    kind: AxisKind,
    unit: Option<&str>,
    size: Option<usize>,
    variable: bool,
) -> AxisSpec {
    AxisSpec {
        name: name.to_string(),
        kind,
        unit: unit.map(str::to_string),
        size,
        variable,
        coordinate: None,
    }
}

fn stateless_adapter(
    id: &str,
    input_type: &str,
    input_representation: &str,
    output_type: &str,
    output_representation: &str,
    cost: u64,
    lossy: bool,
) -> AdapterSpec {
    adapter(
        id,
        (input_type, input_representation),
        (output_type, output_representation),
        cost,
        lossy,
        false,
        FitScope::Stateless,
    )
}

fn stateful_adapter(
    id: &str,
    input_type: &str,
    input_representation: &str,
    output_type: &str,
    output_representation: &str,
    cost: u64,
    lossy: bool,
) -> AdapterSpec {
    adapter(
        id,
        (input_type, input_representation),
        (output_type, output_representation),
        cost,
        lossy,
        true,
        FitScope::FoldTrain,
    )
}

fn adapter(
    id: &str,
    input: (&str, &str),
    output: (&str, &str),
    cost: u64,
    lossy: bool,
    stateful: bool,
    fit_scope: FitScope,
) -> AdapterSpec {
    AdapterSpec {
        id: id.to_string(),
        version: "1.0.0".to_string(),
        input_type: tid(input.0),
        input_representation: rid(input.1),
        output_type: tid(output.0),
        output_representation: rid(output.1),
        cost,
        lossy,
        supervised: false,
        stateful,
        deterministic: true,
        fit_scope,
        params: BTreeMap::new(),
    }
}

fn tid(value: &str) -> TypeId {
    TypeId::new(value).expect("built-in type id is valid")
}

fn rid(value: &str) -> RepresentationId {
    RepresentationId::new(value).expect("built-in representation id is valid")
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;
    use crate::adapter::AdapterRegistry;
    use crate::ids::SampleId;
    use crate::model::DatasetSchema;
    use crate::plan::DataPlanStepKind;
    use crate::planner::{plan_model_input, DataPlanRequest};

    #[test]
    fn builtin_data_models_validate_and_have_unique_keys_and_representations() {
        let specs = builtin_data_model_specs();
        assert_eq!(specs.len(), BUILTIN_DATA_MODELS.len());

        let mut keys = BTreeSet::new();
        let mut representations = BTreeSet::new();
        for spec in specs {
            assert!(keys.insert(spec.key.clone()), "duplicate key {}", spec.key);
            assert!(
                representations.insert(spec.representation.id.clone()),
                "duplicate representation {}",
                spec.representation.id
            );
            spec.representation.validate().unwrap();
            spec.source_descriptor(
                format!("source.{}", spec.key.replace('.', "_")),
                spec.key.clone(),
                "sample_id",
                SourceGranularity::PerSample,
            )
            .unwrap();
        }
    }

    #[test]
    fn pasted_standardization_representations_are_present() {
        let representations = builtin_representations()
            .into_iter()
            .map(|representation| representation.id)
            .collect::<BTreeSet<_>>();

        for expected in [
            REPRESENTATION_SIGNAL_1D,
            REPRESENTATION_SIGNAL_WITH_PROCESSINGS,
            REPRESENTATION_TABULAR_NUMERIC,
            REPRESENTATION_TABULAR_MIXED,
            REPRESENTATION_SERIES_MV,
            REPRESENTATION_VARIANT_MATRIX,
            REPRESENTATION_DOSAGE_MATRIX,
            REPRESENTATION_RGB_IMAGE,
            REPRESENTATION_GRAY_IMAGE,
            REPRESENTATION_CUBE_HWB,
            REPRESENTATION_FEATURE_BLOCK_SET,
            REPRESENTATION_SAMPLE_METADATA,
            REPRESENTATION_TARGET_NUMERIC,
            REPRESENTATION_TARGET_CATEGORICAL,
            REPRESENTATION_TARGET_NUMERIC_MATRIX,
            REPRESENTATION_TARGET_CATEGORICAL_MATRIX,
            REPRESENTATION_SEGMENTATION_MASK,
            REPRESENTATION_ROI_MASK,
            REPRESENTATION_MASS_SPECTRUM,
            REPRESENTATION_RAMAN_SIGNAL,
            REPRESENTATION_FTIR_SIGNAL,
        ] {
            assert!(
                representations.contains(&rid(expected)),
                "missing standardized representation {expected}"
            );
        }
    }

    #[test]
    fn pasted_standardization_shapes_match_expected_axes() {
        let cube = hyperspectral_cube();
        assert_eq!(cube.id, rid(REPRESENTATION_CUBE_HWB));
        assert_eq!(axis_names(&cube), vec!["sample", "height", "width", "band"]);

        let feature_blocks = feature_block_set();
        assert_eq!(feature_blocks.type_id, tid(TYPE_MULTI_BLOCK));
        assert_eq!(
            axis_names(&feature_blocks),
            vec!["sample", "block", "feature"]
        );
        assert!(feature_blocks.ragged);

        let metadata = sample_metadata();
        assert_eq!(metadata.type_id, tid(TYPE_METADATA));
        assert_eq!(axis_names(&metadata), vec!["sample", "field"]);

        for target in [target_numeric_matrix(), target_categorical_matrix()] {
            assert_eq!(target.type_id, tid(TYPE_TARGET));
            assert_eq!(axis_names(&target), vec!["sample", "target"]);
            assert_eq!(target.axes[1].kind, AxisKind::Target);
        }

        for signal in [raman_signal(), ftir_signal()] {
            assert_eq!(signal.type_id, tid(TYPE_DENSE_SIGNAL));
            assert_eq!(axis_names(&signal), vec!["sample", "wavenumber"]);
            assert_eq!(signal.axes[1].kind, AxisKind::Wavenumber);
        }

        let mass_spec = mass_spectrum();
        assert_eq!(mass_spec.type_id, tid(TYPE_MASS_SPEC));
        assert_eq!(axis_names(&mass_spec), vec!["sample", "mz"]);
        assert!(mass_spec.ragged);
    }

    #[test]
    fn builtin_adapter_registry_validates() {
        let spec = builtin_adapter_registry_spec();
        AdapterRegistry::from_spec(spec).unwrap();
    }

    #[test]
    fn common_builtin_models_can_plan_to_tabular_numeric() {
        let registry = AdapterRegistry::from_spec(builtin_adapter_registry_spec()).unwrap();
        let policy = default_builtin_planning_policy();
        let target_type = tid(TYPE_TABLE);
        let target_representation = rid(REPRESENTATION_TABULAR_NUMERIC);

        for model in [
            BuiltinDataModel::NirsSignal1d,
            BuiltinDataModel::NirsSignalWithProcessings,
            BuiltinDataModel::RamanSignal,
            BuiltinDataModel::FtirSignal,
            BuiltinDataModel::TabularNumeric,
            BuiltinDataModel::TabularMixed,
            BuiltinDataModel::FeatureBlockSet,
            BuiltinDataModel::SeriesMultivariate,
            BuiltinDataModel::ClimateSeriesMultivariate,
            BuiltinDataModel::GenotypeVariantMatrix,
            BuiltinDataModel::GenotypeDosageMatrix,
            BuiltinDataModel::RgbImage,
            BuiltinDataModel::GrayImage,
            BuiltinDataModel::MultichannelImage,
            BuiltinDataModel::MultispectralImage,
            BuiltinDataModel::HyperspectralCube,
            BuiltinDataModel::SegmentationMask,
            BuiltinDataModel::RoiMask,
            BuiltinDataModel::SampleMetadata,
            BuiltinDataModel::MassSpectrum,
            BuiltinDataModel::TextRaw,
            BuiltinDataModel::TextTokenIds,
        ] {
            let representation = model.representation();
            let path = registry.find_path(
                &representation.type_id,
                &representation.id,
                &target_type,
                &target_representation,
                &policy,
            );
            assert!(
                path.path.is_some(),
                "no tabular path for {} ({}/{})",
                model.key(),
                representation.type_id,
                representation.id
            );
        }
    }

    #[test]
    fn tabular_numeric_model_input_accepts_builtin_target() {
        let spec = tabular_numeric_model_input_spec();
        spec.validate().unwrap();
        let port = &spec.ports[0];
        assert_eq!(
            port.accepted_representations,
            vec![rid(REPRESENTATION_TABULAR_NUMERIC)]
        );
        assert_eq!(port.accepted_types, vec![tid(TYPE_TABLE)]);
    }

    #[test]
    fn common_builtin_models_plan_model_input_to_tabular_numeric() {
        let registry = AdapterRegistry::from_spec(builtin_adapter_registry_spec()).unwrap();
        let model_input = tabular_numeric_model_input_spec();

        for model in tabular_input_models() {
            let spec = model.spec();
            let source_id = format!("source.{}", spec.key.replace('.', "_"));
            let source = spec
                .source_descriptor(
                    source_id,
                    spec.key.clone(),
                    "sample_id",
                    SourceGranularity::PerSample,
                )
                .unwrap();
            let schema = DatasetSchema {
                dataset_id: format!("dataset.{}", spec.key.replace('.', "_")),
                sample_ids: vec![SampleId::new("S001").unwrap()],
                sources: vec![source],
                targets: BTreeMap::new(),
                metadata: BTreeMap::new(),
                metadata_schema: None,
                groups: Vec::new(),
                folds: Vec::new(),
            };
            let request = DataPlanRequest {
                id: format!("plan.{}", spec.key.replace('.', "_")),
                source_ids: None,
                planning_policy: default_builtin_planning_policy(),
            };

            let plan = plan_model_input(&schema, &model_input, &registry, &request).unwrap();
            plan.validate().unwrap();
            assert_eq!(
                plan.output_representation,
                rid(REPRESENTATION_TABULAR_NUMERIC)
            );
            assert!(
                plan.steps
                    .iter()
                    .any(|step| step.kind == DataPlanStepKind::Materialize),
                "{} plan did not materialize a source",
                spec.key
            );
            assert!(
                plan.steps
                    .iter()
                    .any(|step| step.kind == DataPlanStepKind::Join),
                "{} plan did not join into the model input port",
                spec.key
            );
            let has_adapt = plan
                .steps
                .iter()
                .any(|step| step.kind == DataPlanStepKind::Adapt);
            assert_eq!(
                has_adapt,
                model != BuiltinDataModel::TabularNumeric,
                "{} adapt-step expectation mismatch",
                spec.key
            );
        }
    }

    fn axis_names(representation: &RepresentationSpec) -> Vec<&str> {
        representation
            .axes
            .iter()
            .map(|axis| axis.name.as_str())
            .collect()
    }

    fn tabular_input_models() -> [BuiltinDataModel; 22] {
        [
            BuiltinDataModel::NirsSignal1d,
            BuiltinDataModel::NirsSignalWithProcessings,
            BuiltinDataModel::RamanSignal,
            BuiltinDataModel::FtirSignal,
            BuiltinDataModel::TabularNumeric,
            BuiltinDataModel::TabularMixed,
            BuiltinDataModel::FeatureBlockSet,
            BuiltinDataModel::SeriesMultivariate,
            BuiltinDataModel::ClimateSeriesMultivariate,
            BuiltinDataModel::GenotypeVariantMatrix,
            BuiltinDataModel::GenotypeDosageMatrix,
            BuiltinDataModel::RgbImage,
            BuiltinDataModel::GrayImage,
            BuiltinDataModel::MultichannelImage,
            BuiltinDataModel::MultispectralImage,
            BuiltinDataModel::HyperspectralCube,
            BuiltinDataModel::SegmentationMask,
            BuiltinDataModel::RoiMask,
            BuiltinDataModel::SampleMetadata,
            BuiltinDataModel::MassSpectrum,
            BuiltinDataModel::TextRaw,
            BuiltinDataModel::TextTokenIds,
        ]
    }
}
