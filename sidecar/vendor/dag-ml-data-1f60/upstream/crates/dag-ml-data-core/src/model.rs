use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};
use crate::ids::{GroupId, RepresentationId, SampleId, SourceId, TargetId, TypeId};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum AxisKind {
    Sample,
    Feature,
    Processing,
    Time,
    Height,
    Width,
    Channel,
    Node,
    Edge,
    Variant,
    Token,
    Target,
    Wavelength,
    Wavenumber,
    Frequency,
    Depth,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AxisSpec {
    pub name: String,
    pub kind: AxisKind,
    pub unit: Option<String>,
    pub size: Option<usize>,
    #[serde(default)]
    pub variable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinate: Option<CoordinateSpec>,
}

impl AxisSpec {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(DataError::Validation("axis name is empty".to_string()));
        }
        if self.variable && self.size.is_some() {
            return Err(DataError::Validation(format!(
                "axis `{}` cannot be both variable and sized",
                self.name
            )));
        }
        if let Some(unit) = &self.unit {
            if unit.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "axis `{}` has an empty unit",
                    self.name
                )));
            }
        }
        if let Some(coordinate) = &self.coordinate {
            coordinate.validate(&self.name, self.size, self.variable)?;
        }
        Ok(())
    }
}

/// Element dtype of an axis coordinate sequence.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoordinateDType {
    Numeric,
    Categorical,
    Datetime,
}

/// Axis coordinate values: either an explicit per-index list or a regular
/// numeric grid (`value(i) = start + i * step`, count taken from the axis size).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CoordinateValues {
    Explicit { values: Vec<serde_json::Value> },
    RegularGrid { start: f64, step: f64 },
}

/// Typed coordinate contract for an axis, so methods can machine-rely on the
/// coordinate dtype, ordering and (for numeric) regular-grid structure rather
/// than re-deriving them from untyped JSON.
///
/// `datetime` coordinates are canonical RFC 3339 UTC second-precision strings
/// (`YYYY-MM-DDThh:mm:ssZ`); richer precision / offsets are a future extension.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoordinateSpec {
    pub dtype: CoordinateDType,
    #[serde(default)]
    pub ordered: bool,
    pub values: CoordinateValues,
}

impl CoordinateSpec {
    pub fn validate(&self, axis_name: &str, size: Option<usize>, variable: bool) -> Result<()> {
        if variable {
            return Err(DataError::Validation(format!(
                "axis `{axis_name}` cannot carry coordinates while variable"
            )));
        }
        match &self.values {
            CoordinateValues::Explicit { values } => {
                if values.is_empty() {
                    return Err(DataError::Validation(format!(
                        "axis `{axis_name}` has empty explicit coordinates"
                    )));
                }
                if let Some(size) = size {
                    if values.len() != size {
                        return Err(DataError::Validation(format!(
                            "axis `{axis_name}` has {} coordinates for size {size}",
                            values.len()
                        )));
                    }
                }
                self.validate_explicit(axis_name, values)?;
            }
            CoordinateValues::RegularGrid { start, step } => {
                if self.dtype != CoordinateDType::Numeric {
                    return Err(DataError::Validation(format!(
                        "axis `{axis_name}` regular-grid coordinates require numeric dtype"
                    )));
                }
                if size.is_none() {
                    return Err(DataError::Validation(format!(
                        "axis `{axis_name}` regular-grid coordinates require a known axis size"
                    )));
                }
                if !start.is_finite() || !step.is_finite() {
                    return Err(DataError::Validation(format!(
                        "axis `{axis_name}` regular-grid start/step must be finite"
                    )));
                }
                if *step == 0.0 {
                    return Err(DataError::Validation(format!(
                        "axis `{axis_name}` regular-grid step must be non-zero"
                    )));
                }
                if !self.ordered {
                    return Err(DataError::Validation(format!(
                        "axis `{axis_name}` regular-grid coordinates are inherently ordered; set ordered=true"
                    )));
                }
            }
        }
        Ok(())
    }

    fn validate_explicit(&self, axis_name: &str, values: &[serde_json::Value]) -> Result<()> {
        match self.dtype {
            CoordinateDType::Numeric => {
                let mut numbers = Vec::with_capacity(values.len());
                for value in values {
                    let number = value
                        .as_f64()
                        .filter(|number| number.is_finite())
                        .ok_or_else(|| {
                            DataError::Validation(format!(
                                "axis `{axis_name}` numeric coordinate `{value}` is not a finite number"
                            ))
                        })?;
                    numbers.push(number);
                }
                if self.ordered {
                    require_strictly_monotonic(axis_name, &numbers, |left, right| {
                        left.partial_cmp(right)
                    })?;
                }
            }
            CoordinateDType::Categorical => {
                let mut seen = BTreeSet::new();
                for value in values {
                    let label = value.as_str().filter(|label| !label.is_empty()).ok_or_else(|| {
                        DataError::Validation(format!(
                            "axis `{axis_name}` categorical coordinate `{value}` is not a non-empty string"
                        ))
                    })?;
                    if !seen.insert(label) {
                        return Err(DataError::Validation(format!(
                            "axis `{axis_name}` categorical coordinate `{label}` is duplicated"
                        )));
                    }
                }
                // `ordered` is the declared category order; labels are not compared.
            }
            CoordinateDType::Datetime => {
                let mut stamps = Vec::with_capacity(values.len());
                for value in values {
                    let stamp = value.as_str().ok_or_else(|| {
                        DataError::Validation(format!(
                            "axis `{axis_name}` datetime coordinate `{value}` is not a string"
                        ))
                    })?;
                    if !is_rfc3339_utc_seconds(stamp) {
                        return Err(DataError::Validation(format!(
                            "axis `{axis_name}` datetime coordinate `{stamp}` is not canonical RFC 3339 UTC seconds (YYYY-MM-DDThh:mm:ssZ)"
                        )));
                    }
                    stamps.push(stamp.to_string());
                }
                if self.ordered {
                    // The canonical fixed UTC-seconds form makes lexicographic
                    // order equal to chronological order.
                    require_strictly_monotonic(axis_name, &stamps, |left, right| {
                        Some(left.cmp(right))
                    })?;
                }
            }
        }
        Ok(())
    }
}

/// Strictly monotonic in EITHER direction (ascending or descending); rejects
/// equal/unorderable neighbours.
fn require_strictly_monotonic<T>(
    axis_name: &str,
    values: &[T],
    compare: impl Fn(&T, &T) -> Option<std::cmp::Ordering>,
) -> Result<()> {
    if values.len() < 2 {
        return Ok(());
    }
    let first = compare(&values[1], &values[0]).ok_or_else(|| {
        DataError::Validation(format!(
            "axis `{axis_name}` ordered coordinates are not comparable"
        ))
    })?;
    if first == std::cmp::Ordering::Equal {
        return Err(DataError::Validation(format!(
            "axis `{axis_name}` ordered coordinates must be strictly monotonic"
        )));
    }
    for window in values.windows(2) {
        let ordering = compare(&window[1], &window[0]).ok_or_else(|| {
            DataError::Validation(format!(
                "axis `{axis_name}` ordered coordinates are not comparable"
            ))
        })?;
        if ordering != first {
            return Err(DataError::Validation(format!(
                "axis `{axis_name}` ordered coordinates must be strictly monotonic"
            )));
        }
    }
    Ok(())
}

/// Strict canonical RFC 3339 UTC second-precision check: `YYYY-MM-DDThh:mm:ssZ`.
fn is_rfc3339_utc_seconds(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20 {
        return false;
    }
    let digit_positions = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    if digit_positions
        .iter()
        .any(|position| !bytes[*position].is_ascii_digit())
    {
        return false;
    }
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return false;
    }
    let field = |start: usize, end: usize| value[start..end].parse::<u32>().unwrap_or(u32::MAX);
    let year = field(0, 4);
    let month = field(5, 7);
    let day = field(8, 10);
    let hour = field(11, 13);
    let minute = field(14, 16);
    let second = field(17, 19);
    if !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => unreachable!("month already validated in 1..=12"),
    };
    (1..=days_in_month).contains(&day)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum SignalKind {
    Absorbance,
    Reflectance,
    Transmittance,
    LogReflectance,
    Preprocessed,
    Unknown,
}

impl SignalKind {
    /// The snake_case wire name, for diagnostics.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Absorbance => "absorbance",
            Self::Reflectance => "reflectance",
            Self::Transmittance => "transmittance",
            Self::LogReflectance => "log_reflectance",
            Self::Preprocessed => "preprocessed",
            Self::Unknown => "unknown",
        }
    }
}

/// Validate that a provider-declared `actual` signal type matches the `expected`
/// one the plan or bundle records (ADR-06). The `Unknown` policy is the caller's:
/// pass `allow_unknown = true` at train time (an untagged signal type is
/// tolerated) and `false` at predict time (a trained pipeline must carry a
/// concrete signal type, so any difference — including `Unknown` — is refused).
///
/// This is a reusable contract helper; `dag-ml-data` does not yet wire it into
/// materialize because the "expected" side is carried by `dag-ml` lineage, not by
/// the data envelope. The host bridge calls it with the two sides it owns.
pub fn require_signal_type_match(
    expected: SignalKind,
    actual: SignalKind,
    allow_unknown: bool,
) -> Result<()> {
    // `Unknown` on either side is decided by the caller's policy FIRST: at predict
    // time (`allow_unknown = false`) any `Unknown` is refused — including when both
    // sides are `Unknown` — because a trained pipeline must carry a concrete signal
    // type (ADR-06).
    if expected == SignalKind::Unknown || actual == SignalKind::Unknown {
        return if allow_unknown {
            Ok(())
        } else {
            Err(DataError::SignalTypeMismatch {
                expected: expected.as_str(),
                actual: actual.as_str(),
            })
        };
    }
    if expected == actual {
        return Ok(());
    }
    Err(DataError::SignalTypeMismatch {
        expected: expected.as_str(),
        actual: actual.as_str(),
    })
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AxisSizeContract {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exact: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<usize>,
}

impl AxisSizeContract {
    pub fn validate(&self, axis_name: &str) -> Result<()> {
        if self.exact.is_none() && self.min.is_none() && self.max.is_none() {
            return Err(DataError::Validation(format!(
                "shape contract for axis `{axis_name}` does not constrain the size"
            )));
        }
        if let (Some(min), Some(max)) = (self.min, self.max) {
            if min > max {
                return Err(DataError::Validation(format!(
                    "shape contract for axis `{axis_name}` has min {min} greater than max {max}"
                )));
            }
        }
        if let Some(exact) = self.exact {
            if let Some(min) = self.min {
                if exact < min {
                    return Err(DataError::Validation(format!(
                        "shape contract for axis `{axis_name}` exact size {exact} is below min {min}"
                    )));
                }
            }
            if let Some(max) = self.max {
                if exact > max {
                    return Err(DataError::Validation(format!(
                        "shape contract for axis `{axis_name}` exact size {exact} is above max {max}"
                    )));
                }
            }
        }
        Ok(())
    }

    fn accepts(&self, size: usize) -> bool {
        if self.exact.is_some_and(|exact| size != exact) {
            return false;
        }
        if self.min.is_some_and(|min| size < min) {
            return false;
        }
        if self.max.is_some_and(|max| size > max) {
            return false;
        }
        true
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct ShapeContract {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rank: Option<usize>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub axis_sizes: BTreeMap<String, AxisSizeContract>,
    #[serde(default)]
    pub allow_ragged: bool,
}

impl ShapeContract {
    pub fn validate(&self) -> Result<()> {
        if self.rank.is_none() && self.axis_sizes.is_empty() {
            return Err(DataError::Validation(
                "shape contract must constrain rank or at least one axis".to_string(),
            ));
        }
        for (axis_name, contract) in &self.axis_sizes {
            if axis_name.trim().is_empty() {
                return Err(DataError::Validation(
                    "shape contract contains an empty axis name".to_string(),
                ));
            }
            contract.validate(axis_name)?;
        }
        Ok(())
    }

    pub fn validate_representation(
        &self,
        source_id: &SourceId,
        representation: &RepresentationSpec,
    ) -> Result<()> {
        self.validate()?;
        if let Some(expected_rank) = self.rank {
            if representation.rank != Some(expected_rank) {
                return Err(DataError::Validation(format!(
                    "source `{source_id}` shape contract expects rank {expected_rank} but representation `{}` has {:?}",
                    representation.id, representation.rank
                )));
            }
        }
        if representation.ragged && !self.allow_ragged {
            return Err(DataError::Validation(format!(
                "source `{source_id}` shape contract does not allow ragged representation `{}`",
                representation.id
            )));
        }
        for (axis_name, contract) in &self.axis_sizes {
            let axis = representation
                .axes
                .iter()
                .find(|axis| axis.name == *axis_name)
                .ok_or_else(|| {
                    DataError::Validation(format!(
                        "source `{source_id}` shape contract references missing axis `{axis_name}`"
                    ))
                })?;
            if let Some(size) = axis.size {
                if !contract.accepts(size) {
                    return Err(DataError::Validation(format!(
                        "source `{source_id}` axis `{axis_name}` size {size} violates shape contract"
                    )));
                }
            } else if !axis.variable {
                return Err(DataError::Validation(format!(
                    "source `{source_id}` axis `{axis_name}` has no concrete size for shape contract"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RepresentationSpec {
    pub id: RepresentationId,
    pub type_id: TypeId,
    pub rank: Option<usize>,
    pub axes: Vec<AxisSpec>,
    pub container: String,
    pub dtype: Option<String>,
    #[serde(default)]
    pub sparse: bool,
    #[serde(default)]
    pub ragged: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal_type: Option<SignalKind>,
}

impl RepresentationSpec {
    pub fn validate(&self) -> Result<()> {
        if self.container.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "representation `{}` has an empty container",
                self.id
            )));
        }
        if self.rank.is_none() && !self.ragged {
            return Err(DataError::Validation(format!(
                "representation `{}` with no rank must be ragged",
                self.id
            )));
        }
        if let Some(rank) = self.rank {
            if self.axes.len() != rank {
                return Err(DataError::Validation(format!(
                    "representation `{}` has rank {} but {} axes",
                    self.id,
                    rank,
                    self.axes.len()
                )));
            }
        }
        for axis in &self.axes {
            axis.validate()?;
        }
        if self.container != "graph_batch"
            && !self.axes.iter().any(|axis| axis.kind == AxisKind::Sample)
        {
            return Err(DataError::Validation(format!(
                "representation `{}` has no sample axis",
                self.id
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceGranularity {
    PerSample,
    PerSampleRepeated,
    PerSampleSequence,
    PerSampleSet,
    PerGroup,
    PerTarget,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourceDescriptor {
    pub id: SourceId,
    pub name: String,
    pub type_id: TypeId,
    pub modality: String,
    pub native_representation: RepresentationSpec,
    pub sample_key: String,
    pub granularity: SourceGranularity,
    #[serde(default)]
    pub schema: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub tags: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape_contract: Option<ShapeContract>,
}

impl SourceDescriptor {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "source `{}` has an empty name",
                self.id
            )));
        }
        if self.sample_key.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "source `{}` has an empty sample key",
                self.id
            )));
        }
        self.native_representation.validate()?;
        if let Some(shape_contract) = &self.shape_contract {
            shape_contract.validate_representation(&self.id, &self.native_representation)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetadataValueKind {
    String,
    Number,
    Integer,
    Boolean,
    Date,
    Datetime,
    Categorical,
    Json,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MetadataFieldSpec {
    pub kind: MetadataValueKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_values: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl MetadataFieldSpec {
    pub fn validate(&self, field_name: &str) -> Result<()> {
        if self.kind == MetadataValueKind::Categorical && self.allowed_values.is_empty() {
            return Err(DataError::Validation(format!(
                "metadata field `{field_name}` is categorical but declares no allowed_values"
            )));
        }
        if let Some(unit) = &self.unit {
            if unit.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "metadata field `{field_name}` has an empty unit"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MetadataSchema {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<String, MetadataFieldSpec>,
}

impl MetadataSchema {
    pub fn validate(&self) -> Result<()> {
        if self.fields.is_empty() {
            return Err(DataError::Validation(
                "metadata schema declares no fields".to_string(),
            ));
        }
        for (field_name, field) in &self.fields {
            if field_name.trim().is_empty() {
                return Err(DataError::Validation(
                    "metadata schema contains an empty field name".to_string(),
                ));
            }
            field.validate(field_name)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupKind {
    RepetitionGroup,
    Subject,
    Batch,
    Split,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GroupSpec {
    pub id: GroupId,
    pub kind: GroupKind,
    pub column: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<SourceId>,
    #[serde(default)]
    pub strict: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl GroupSpec {
    pub fn validate(&self) -> Result<()> {
        if self.column.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "group `{}` has an empty column",
                self.id
            )));
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "group `{}` metadata contains an empty key",
                    self.id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FoldSpec {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<GroupId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_column: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl FoldSpec {
    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DataError::Validation("fold id is empty".to_string()));
        }
        if self.group_id.is_none() && self.split_column.is_none() {
            return Err(DataError::Validation(format!(
                "fold `{}` declares neither group_id nor split_column",
                self.id
            )));
        }
        if let Some(split_column) = &self.split_column {
            if split_column.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "fold `{}` has an empty split_column",
                    self.id
                )));
            }
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "fold `{}` metadata contains an empty key",
                    self.id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DatasetSchema {
    pub dataset_id: String,
    pub sample_ids: Vec<SampleId>,
    pub sources: Vec<SourceDescriptor>,
    #[serde(default)]
    pub targets: BTreeMap<TargetId, RepresentationSpec>,
    #[serde(default)]
    pub metadata: BTreeMap<String, RepresentationSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_schema: Option<MetadataSchema>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<GroupSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folds: Vec<FoldSpec>,
}

impl DatasetSchema {
    pub fn validate(&self) -> Result<()> {
        if self.dataset_id.trim().is_empty() {
            return Err(DataError::Validation(
                "dataset id must not be empty".to_string(),
            ));
        }
        if self.sample_ids.is_empty() {
            return Err(DataError::Validation(
                "dataset schema must contain at least one sample".to_string(),
            ));
        }
        let unique_samples = self.sample_ids.iter().collect::<BTreeSet<_>>();
        if unique_samples.len() != self.sample_ids.len() {
            return Err(DataError::Validation(
                "dataset schema contains duplicate sample ids".to_string(),
            ));
        }

        let mut source_ids = BTreeSet::new();
        for source in &self.sources {
            if !source_ids.insert(&source.id) {
                return Err(DataError::Validation(format!(
                    "duplicate source id `{}`",
                    source.id
                )));
            }
            source.validate()?;
        }
        for target in self.targets.values() {
            target.validate()?;
        }
        for representation in self.metadata.values() {
            representation.validate()?;
        }
        if let Some(metadata_schema) = &self.metadata_schema {
            metadata_schema.validate()?;
        }
        let mut group_ids = BTreeSet::new();
        for group in &self.groups {
            if !group_ids.insert(&group.id) {
                return Err(DataError::Validation(format!(
                    "duplicate group id `{}`",
                    group.id
                )));
            }
            if let Some(source_id) = &group.source_id {
                if !source_ids.contains(source_id) {
                    return Err(DataError::Validation(format!(
                        "group `{}` references unknown source `{source_id}`",
                        group.id
                    )));
                }
            }
            group.validate()?;
        }
        let mut fold_ids = BTreeSet::new();
        for fold in &self.folds {
            if !fold_ids.insert(&fold.id) {
                return Err(DataError::Validation(format!(
                    "duplicate fold id `{}`",
                    fold.id
                )));
            }
            if let Some(group_id) = &fold.group_id {
                if !group_ids.contains(group_id) {
                    return Err(DataError::Validation(format!(
                        "fold `{}` references unknown group `{group_id}`",
                        fold.id
                    )));
                }
            }
            fold.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct DataView {
    pub sample_ids: Option<Vec<SampleId>>,
    pub partition: Option<String>,
    pub fold_id: Option<String>,
    pub source_ids: Option<Vec<SourceId>>,
    pub columns: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub include_augmented: bool,
    #[serde(default)]
    pub include_excluded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_view: Option<crate::coordinator::CoordinatorBranchView>,
    #[serde(default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PresenceMask {
    pub sample_ids: Vec<SampleId>,
    pub source_id: SourceId,
    pub present: Vec<bool>,
}

impl PresenceMask {
    pub fn validate(&self) -> Result<()> {
        if self.sample_ids.len() != self.present.len() {
            return Err(DataError::Validation(format!(
                "presence mask for `{}` has {} sample ids but {} flags",
                self.source_id,
                self.sample_ids.len(),
                self.present.len()
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_axis() -> AxisSpec {
        AxisSpec {
            name: "sample".to_string(),
            kind: AxisKind::Sample,
            unit: None,
            size: Some(2),
            variable: false,
            coordinate: None,
        }
    }

    #[test]
    fn rejects_representation_without_sample_axis() {
        let repr = RepresentationSpec {
            id: RepresentationId::new("tabular").unwrap(),
            type_id: TypeId::new("table").unwrap(),
            rank: Some(1),
            axes: vec![AxisSpec {
                name: "feature".to_string(),
                kind: AxisKind::Feature,
                unit: None,
                size: Some(3),
                variable: false,
                coordinate: None,
            }],
            container: "dataframe".to_string(),
            dtype: Some("float32".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        };

        assert!(repr.validate().is_err());
    }

    #[test]
    fn accepts_sample_major_representation() {
        let repr = RepresentationSpec {
            id: RepresentationId::new("tabular").unwrap(),
            type_id: TypeId::new("table").unwrap(),
            rank: Some(1),
            axes: vec![sample_axis()],
            container: "dataframe".to_string(),
            dtype: Some("float32".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        };

        assert!(repr.validate().is_ok());
    }

    #[test]
    fn axis_kind_wavenumber_serializes_and_round_trips() {
        let value = AxisKind::Wavenumber;
        let json = serde_json::to_string(&value).unwrap();
        assert_eq!(json, "\"wavenumber\"");
        let decoded: AxisKind = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, value);
    }

    #[test]
    fn axis_kind_wavenumber_accepted_in_representation_axis() {
        let axes = vec![
            sample_axis(),
            AxisSpec {
                name: "wavenumber".to_string(),
                kind: AxisKind::Wavenumber,
                unit: Some("cm-1".to_string()),
                size: Some(1024),
                variable: false,
                coordinate: None,
            },
        ];
        let repr = RepresentationSpec {
            id: RepresentationId::new("ftir_spectrum").unwrap(),
            type_id: TypeId::new("dense_signal").unwrap(),
            rank: Some(2),
            axes,
            container: "ndarray".to_string(),
            dtype: Some("float64".to_string()),
            sparse: false,
            ragged: false,
            signal_type: Some(SignalKind::Absorbance),
        };
        repr.validate().unwrap();
    }

    #[test]
    fn dataset_schema_accepts_optional_nirs4all_integration_contracts() {
        let source_id = SourceId::new("nir").unwrap();
        let group_id = GroupId::new("rep.group").unwrap();
        let representation = RepresentationSpec {
            id: RepresentationId::new("nir.signal").unwrap(),
            type_id: TypeId::new("dense_signal").unwrap(),
            rank: Some(2),
            axes: vec![
                sample_axis(),
                AxisSpec {
                    name: "wavelength".to_string(),
                    kind: AxisKind::Wavelength,
                    unit: Some("nm".to_string()),
                    size: Some(3),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "ndarray".to_string(),
            dtype: Some("float32".to_string()),
            sparse: false,
            ragged: false,
            signal_type: Some(SignalKind::Reflectance),
        };
        let schema = DatasetSchema {
            dataset_id: "nirs4all-core-smoke".to_string(),
            sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
            sources: vec![SourceDescriptor {
                id: source_id.clone(),
                name: "NIR spectra".to_string(),
                type_id: TypeId::new("dense_signal").unwrap(),
                modality: "nir".to_string(),
                native_representation: representation,
                sample_key: "sample_id".to_string(),
                granularity: SourceGranularity::PerSampleRepeated,
                schema: BTreeMap::new(),
                tags: BTreeMap::new(),
                shape_contract: Some(ShapeContract {
                    rank: Some(2),
                    axis_sizes: BTreeMap::from([(
                        "wavelength".to_string(),
                        AxisSizeContract {
                            exact: Some(3),
                            min: None,
                            max: None,
                        },
                    )]),
                    allow_ragged: false,
                }),
            }],
            targets: BTreeMap::new(),
            metadata: BTreeMap::new(),
            metadata_schema: Some(MetadataSchema {
                fields: BTreeMap::from([(
                    "cultivar".to_string(),
                    MetadataFieldSpec {
                        kind: MetadataValueKind::Categorical,
                        required: true,
                        unit: None,
                        allowed_values: vec![serde_json::Value::String("a".to_string())],
                        description: None,
                    },
                )]),
            }),
            groups: vec![GroupSpec {
                id: group_id.clone(),
                kind: GroupKind::RepetitionGroup,
                column: "sample_id".to_string(),
                source_id: Some(source_id),
                strict: true,
                metadata: BTreeMap::new(),
            }],
            folds: vec![FoldSpec {
                id: "cv.repetition.safe".to_string(),
                group_id: Some(group_id),
                split_column: Some("fold_id".to_string()),
                metadata: BTreeMap::new(),
            }],
        };

        schema.validate().unwrap();
        let json = serde_json::to_value(&schema).unwrap();
        assert_eq!(
            json["sources"][0]["native_representation"]["signal_type"],
            "reflectance"
        );
        assert_eq!(json["groups"][0]["kind"], "repetition_group");
    }

    #[test]
    fn dataset_schema_refuses_shape_contract_mismatch() {
        let representation = RepresentationSpec {
            id: RepresentationId::new("nir.signal").unwrap(),
            type_id: TypeId::new("dense_signal").unwrap(),
            rank: Some(2),
            axes: vec![
                sample_axis(),
                AxisSpec {
                    name: "wavelength".to_string(),
                    kind: AxisKind::Wavelength,
                    unit: Some("nm".to_string()),
                    size: Some(3),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "ndarray".to_string(),
            dtype: Some("float32".to_string()),
            sparse: false,
            ragged: false,
            signal_type: Some(SignalKind::Absorbance),
        };
        let source = SourceDescriptor {
            id: SourceId::new("nir").unwrap(),
            name: "NIR spectra".to_string(),
            type_id: TypeId::new("dense_signal").unwrap(),
            modality: "nir".to_string(),
            native_representation: representation,
            sample_key: "sample_id".to_string(),
            granularity: SourceGranularity::PerSample,
            schema: BTreeMap::new(),
            tags: BTreeMap::new(),
            shape_contract: Some(ShapeContract {
                rank: Some(2),
                axis_sizes: BTreeMap::from([(
                    "wavelength".to_string(),
                    AxisSizeContract {
                        exact: Some(4),
                        min: None,
                        max: None,
                    },
                )]),
                allow_ragged: false,
            }),
        };

        assert!(source.validate().is_err());
    }

    #[test]
    fn dataset_schema_refuses_empty_shape_contract() {
        let representation = RepresentationSpec {
            id: RepresentationId::new("nir.signal").unwrap(),
            type_id: TypeId::new("dense_signal").unwrap(),
            rank: Some(2),
            axes: vec![
                sample_axis(),
                AxisSpec {
                    name: "wavelength".to_string(),
                    kind: AxisKind::Wavelength,
                    unit: Some("nm".to_string()),
                    size: Some(3),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "ndarray".to_string(),
            dtype: Some("float32".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        };
        let source = SourceDescriptor {
            id: SourceId::new("nir").unwrap(),
            name: "NIR spectra".to_string(),
            type_id: TypeId::new("dense_signal").unwrap(),
            modality: "nir".to_string(),
            native_representation: representation,
            sample_key: "sample_id".to_string(),
            granularity: SourceGranularity::PerSample,
            schema: BTreeMap::new(),
            tags: BTreeMap::new(),
            shape_contract: Some(ShapeContract::default()),
        };

        assert!(source.validate().is_err());
    }

    #[test]
    fn dataset_schema_refuses_unknown_fold_group() {
        let schema = DatasetSchema {
            dataset_id: "folds".to_string(),
            sample_ids: vec![SampleId::new("s1").unwrap()],
            sources: Vec::new(),
            targets: BTreeMap::new(),
            metadata: BTreeMap::new(),
            metadata_schema: None,
            groups: Vec::new(),
            folds: vec![FoldSpec {
                id: "fold.cv".to_string(),
                group_id: Some(GroupId::new("missing").unwrap()),
                split_column: None,
                metadata: BTreeMap::new(),
            }],
        };

        assert!(schema.validate().is_err());
    }

    #[test]
    fn dataset_schema_refuses_empty_fold_declaration() {
        let schema = DatasetSchema {
            dataset_id: "folds".to_string(),
            sample_ids: vec![SampleId::new("s1").unwrap()],
            sources: Vec::new(),
            targets: BTreeMap::new(),
            metadata: BTreeMap::new(),
            metadata_schema: None,
            groups: Vec::new(),
            folds: vec![FoldSpec {
                id: "fold.cv".to_string(),
                group_id: None,
                split_column: None,
                metadata: BTreeMap::new(),
            }],
        };

        let error = schema.validate().unwrap_err();
        assert!(error
            .to_string()
            .contains("neither group_id nor split_column"));
    }

    fn coord(dtype: CoordinateDType, ordered: bool, values: CoordinateValues) -> CoordinateSpec {
        CoordinateSpec {
            dtype,
            ordered,
            values,
        }
    }

    fn explicit(values: Vec<serde_json::Value>) -> CoordinateValues {
        CoordinateValues::Explicit { values }
    }

    fn nums(values: &[f64]) -> Vec<serde_json::Value> {
        values
            .iter()
            .map(|value| serde_json::Value::from(*value))
            .collect()
    }

    fn strings(values: &[&str]) -> Vec<serde_json::Value> {
        values
            .iter()
            .map(|value| serde_json::Value::from(*value))
            .collect()
    }

    #[test]
    fn numeric_ordered_coordinates_accept_ascending_or_descending() {
        let ascending = coord(
            CoordinateDType::Numeric,
            true,
            explicit(nums(&[400.0, 402.0, 404.0])),
        );
        assert!(ascending.validate("wl", Some(3), false).is_ok());
        let descending = coord(
            CoordinateDType::Numeric,
            true,
            explicit(nums(&[404.0, 402.0, 400.0])),
        );
        assert!(descending.validate("wl", Some(3), false).is_ok());
    }

    #[test]
    fn numeric_ordered_coordinates_reject_non_monotonic_and_duplicates() {
        let bumpy = coord(
            CoordinateDType::Numeric,
            true,
            explicit(nums(&[400.0, 404.0, 402.0])),
        );
        assert!(bumpy.validate("wl", Some(3), false).is_err());
        let duplicate = coord(
            CoordinateDType::Numeric,
            true,
            explicit(nums(&[400.0, 400.0])),
        );
        assert!(duplicate.validate("wl", Some(2), false).is_err());
    }

    #[test]
    fn numeric_coordinates_reject_non_finite_and_non_number() {
        let not_finite = coord(
            CoordinateDType::Numeric,
            false,
            explicit(vec![serde_json::Value::from(f64::NAN)]),
        );
        assert!(not_finite.validate("wl", Some(1), false).is_err());
        let text = coord(CoordinateDType::Numeric, false, explicit(strings(&["400"])));
        assert!(text.validate("wl", Some(1), false).is_err());
    }

    #[test]
    fn categorical_coordinates_require_unique_non_empty_strings() {
        let ok = coord(
            CoordinateDType::Categorical,
            false,
            explicit(strings(&["R", "G", "B"])),
        );
        assert!(ok.validate("channel", Some(3), false).is_ok());
        let duplicate = coord(
            CoordinateDType::Categorical,
            false,
            explicit(strings(&["R", "R"])),
        );
        assert!(duplicate.validate("channel", Some(2), false).is_err());
        let empty = coord(
            CoordinateDType::Categorical,
            false,
            explicit(strings(&[""])),
        );
        assert!(empty.validate("channel", Some(1), false).is_err());
        let numeric_label = coord(CoordinateDType::Categorical, false, explicit(nums(&[1.0])));
        assert!(numeric_label.validate("channel", Some(1), false).is_err());
        // ordered categorical keeps the declared order; labels are not compared.
        let ordered = coord(
            CoordinateDType::Categorical,
            true,
            explicit(strings(&["Z", "A"])),
        );
        assert!(ordered.validate("channel", Some(2), false).is_ok());
    }

    #[test]
    fn datetime_coordinates_require_canonical_rfc3339_utc_seconds() {
        let ok = coord(
            CoordinateDType::Datetime,
            false,
            explicit(strings(&["2026-05-29T10:00:00Z"])),
        );
        assert!(ok.validate("time", Some(1), false).is_ok());
        for bad in [
            "2026-05-29 10:00:00",
            "2026-05-29T10:00:00+02:00",
            "2026-13-29T10:00:00Z",
        ] {
            let spec = coord(CoordinateDType::Datetime, false, explicit(strings(&[bad])));
            assert!(
                spec.validate("time", Some(1), false).is_err(),
                "expected reject for {bad}"
            );
        }
        let epoch = coord(
            CoordinateDType::Datetime,
            false,
            explicit(nums(&[1.716976e9])),
        );
        assert!(epoch.validate("time", Some(1), false).is_err());
    }

    #[test]
    fn datetime_ordered_coordinates_enforce_strict_monotonic() {
        let ok = coord(
            CoordinateDType::Datetime,
            true,
            explicit(strings(&["2026-05-29T10:00:00Z", "2026-05-29T10:00:01Z"])),
        );
        assert!(ok.validate("time", Some(2), false).is_ok());
        let stalled = coord(
            CoordinateDType::Datetime,
            true,
            explicit(strings(&["2026-05-29T10:00:01Z", "2026-05-29T10:00:01Z"])),
        );
        assert!(stalled.validate("time", Some(2), false).is_err());
    }

    #[test]
    fn regular_grid_coordinates_validate_numeric_sized_nonzero_ordered() {
        let ok = coord(
            CoordinateDType::Numeric,
            true,
            CoordinateValues::RegularGrid {
                start: 400.0,
                step: 2.0,
            },
        );
        assert!(ok.validate("wl", Some(100), false).is_ok());
        let descending = coord(
            CoordinateDType::Numeric,
            true,
            CoordinateValues::RegularGrid {
                start: 400.0,
                step: -2.0,
            },
        );
        assert!(descending.validate("wl", Some(100), false).is_ok());
        let categorical = coord(
            CoordinateDType::Categorical,
            true,
            CoordinateValues::RegularGrid {
                start: 0.0,
                step: 1.0,
            },
        );
        assert!(categorical.validate("wl", Some(3), false).is_err());
        let no_size = coord(
            CoordinateDType::Numeric,
            true,
            CoordinateValues::RegularGrid {
                start: 0.0,
                step: 1.0,
            },
        );
        assert!(no_size.validate("wl", None, false).is_err());
        let zero_step = coord(
            CoordinateDType::Numeric,
            true,
            CoordinateValues::RegularGrid {
                start: 0.0,
                step: 0.0,
            },
        );
        assert!(zero_step.validate("wl", Some(3), false).is_err());
        let unordered = coord(
            CoordinateDType::Numeric,
            false,
            CoordinateValues::RegularGrid {
                start: 0.0,
                step: 1.0,
            },
        );
        assert!(unordered.validate("wl", Some(3), false).is_err());
    }

    #[test]
    fn explicit_coordinates_must_match_known_size_and_be_non_empty() {
        let wrong_len = coord(CoordinateDType::Numeric, false, explicit(nums(&[1.0, 2.0])));
        assert!(wrong_len.validate("wl", Some(3), false).is_err());
        let empty = coord(CoordinateDType::Numeric, false, explicit(Vec::new()));
        assert!(empty.validate("wl", Some(0), false).is_err());
    }

    #[test]
    fn axis_validate_integrates_coordinate_and_unit_rules() {
        let blank_unit = AxisSpec {
            name: "wl".to_string(),
            kind: AxisKind::Wavenumber,
            unit: Some("  ".to_string()),
            size: Some(2),
            variable: false,
            coordinate: None,
        };
        assert!(blank_unit.validate().is_err());

        let variable_with_coordinate = AxisSpec {
            name: "wl".to_string(),
            kind: AxisKind::Feature,
            unit: None,
            size: None,
            variable: true,
            coordinate: Some(coord(
                CoordinateDType::Numeric,
                false,
                explicit(nums(&[1.0])),
            )),
        };
        assert!(variable_with_coordinate.validate().is_err());

        let ok = AxisSpec {
            name: "wl".to_string(),
            kind: AxisKind::Wavenumber,
            unit: Some("cm-1".to_string()),
            size: Some(3),
            variable: false,
            coordinate: Some(coord(
                CoordinateDType::Numeric,
                true,
                explicit(nums(&[400.0, 402.0, 404.0])),
            )),
        };
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn coordinate_spec_round_trips_through_json() {
        let explicit_spec = coord(
            CoordinateDType::Categorical,
            true,
            explicit(strings(&["R", "G", "B"])),
        );
        let text = serde_json::to_string(&explicit_spec).unwrap();
        assert!(text.contains("\"kind\":\"explicit\""));
        assert_eq!(
            serde_json::from_str::<CoordinateSpec>(&text).unwrap(),
            explicit_spec
        );

        let grid_spec = coord(
            CoordinateDType::Numeric,
            true,
            CoordinateValues::RegularGrid {
                start: 400.0,
                step: 2.0,
            },
        );
        let text = serde_json::to_string(&grid_spec).unwrap();
        assert!(text.contains("\"kind\":\"regular_grid\""));
        assert_eq!(
            serde_json::from_str::<CoordinateSpec>(&text).unwrap(),
            grid_spec
        );
    }

    #[test]
    fn axis_spec_rejects_legacy_coordinates_field() {
        // The pre-Phase-C untyped field is removed; deny_unknown_fields makes a
        // stale `coordinates` a hard error rather than silently dropped data.
        let legacy = r#"{"name":"wl","kind":"wavelength","unit":"nm","size":2,"variable":false,"coordinates":[900,1000]}"#;
        assert!(serde_json::from_str::<AxisSpec>(legacy).is_err());

        let typed = r#"{"name":"wl","kind":"wavelength","unit":"nm","size":2,"variable":false,"coordinate":{"dtype":"numeric","ordered":true,"values":{"kind":"explicit","values":[900,1000]}}}"#;
        let axis = serde_json::from_str::<AxisSpec>(typed).unwrap();
        assert!(axis.validate().is_ok());
        assert!(axis.coordinate.is_some());
    }

    #[test]
    fn datetime_coordinates_reject_impossible_calendar_dates() {
        for bad in [
            "2026-02-31T00:00:00Z", // February never has 31 days
            "2026-04-31T00:00:00Z", // April has 30 days
            "2025-02-29T00:00:00Z", // 2025 is not a leap year
            "2026-01-01T00:00:60Z", // leap-second :60 not accepted in v1
        ] {
            let spec = coord(CoordinateDType::Datetime, false, explicit(strings(&[bad])));
            assert!(
                spec.validate("time", Some(1), false).is_err(),
                "expected reject for {bad}"
            );
        }
        // 2024 is a leap year, so Feb 29 is valid.
        let leap_day = coord(
            CoordinateDType::Datetime,
            false,
            explicit(strings(&["2024-02-29T23:59:59Z"])),
        );
        assert!(leap_day.validate("time", Some(1), false).is_ok());
    }

    #[test]
    fn signal_type_match_honours_caller_unknown_policy() {
        use SignalKind::*;
        // exact match always passes
        assert!(require_signal_type_match(Absorbance, Absorbance, false).is_ok());
        // two concrete, different types always mismatch
        let error = require_signal_type_match(Absorbance, Reflectance, true).unwrap_err();
        assert_eq!(error.code(), "signal_type_mismatch");
        assert_eq!(error.error_code(), 0x0008_0003);
        assert_eq!(error.context()["expected"], serde_json::json!("absorbance"));
        assert_eq!(error.context()["actual"], serde_json::json!("reflectance"));
        // Unknown actual: tolerated at train (allow_unknown), refused at predict
        assert!(require_signal_type_match(Absorbance, Unknown, true).is_ok());
        assert!(require_signal_type_match(Absorbance, Unknown, false).is_err());
        // Unknown expected behaves symmetrically
        assert!(require_signal_type_match(Unknown, Reflectance, true).is_ok());
        assert!(require_signal_type_match(Unknown, Reflectance, false).is_err());
        // both-Unknown: tolerated at train, refused at predict (ADR-06)
        assert!(require_signal_type_match(Unknown, Unknown, true).is_ok());
        assert!(require_signal_type_match(Unknown, Unknown, false).is_err());
    }
}
