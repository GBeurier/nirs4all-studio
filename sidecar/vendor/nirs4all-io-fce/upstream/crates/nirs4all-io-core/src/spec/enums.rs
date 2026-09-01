// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Closed vocabularies (ports `spec/enums.py`).
//!
//! Every enum is a string enum whose `value()` is exactly what serializes into a
//! spec. `coerce` is the forgiving, case-insensitive parser: normalize the input
//! (`strip → lower → '-'→'_'`), match a member's normalized value in definition
//! order, then consult the alias map. Unknown values raise [`SpecError`] with the
//! exact CPython-style message and the accepted-value list.

use std::fmt;

/// Raised when a `DatasetSpec` (or a fragment) is malformed. Mirrors the Python
/// `SpecError(ValueError)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecError {
    pub message: String,
}

impl SpecError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for SpecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SpecError {}

/// `value.strip().lower().replace("-", "_")` — the coerce normalization.
pub(crate) fn normalize_enum_key(s: &str) -> String {
    s.trim().to_lowercase().replace('-', "_")
}

macro_rules! str_enum {
    (
        $(#[$meta:meta])*
        $name:ident { $($variant:ident => $val:literal),+ $(,)? }
        $(aliases { $($akey:literal => $aval:literal),+ $(,)? })?
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name { $($variant),+ }

        impl $name {
            /// Canonical string value (what serializes into the spec).
            pub fn value(&self) -> &'static str {
                match self { $(Self::$variant => $val),+ }
            }

            /// All canonical values, in definition order.
            pub const VALUES: &'static [&'static str] = &[$($val),+];

            #[allow(unused_variables)]
            fn alias(key: &str) -> Option<&'static str> {
                $( $( if key == $akey { return Some($aval); } )+ )?
                None
            }

            /// Python `coerce` for a string value.
            pub fn coerce_str(value: &str, field: &str) -> Result<Self, SpecError> {
                let key = normalize_enum_key(value);
                $( if normalize_enum_key($val) == key { return Ok(Self::$variant); } )+
                if let Some(canonical) = Self::alias(&key) {
                    $( if $val == canonical { return Ok(Self::$variant); } )+
                }
                Err(Self::not_valid(field, crate::pyfmt::py_repr_str(value)))
            }

            /// Python `coerce` for a JSON value (only strings coerce).
            pub fn coerce(value: &serde_json::Value, field: &str) -> Result<Self, SpecError> {
                match value {
                    serde_json::Value::String(s) => Self::coerce_str(s, field),
                    other => Err(Self::not_valid(field, crate::pyfmt::py_repr(other))),
                }
            }

            fn not_valid(field: &str, value_repr: String) -> SpecError {
                let accepted: Vec<String> =
                    Self::VALUES.iter().map(|v| crate::pyfmt::py_repr_str(v)).collect();
                SpecError::new(format!(
                    "{field}: {value_repr} is not valid; expected one of {}",
                    accepted.join(", ")
                ))
            }
        }
    };
}

str_enum! {
    /// Role of a source or a column within a source.
    Role {
        Features => "features",
        Targets => "targets",
        Metadata => "metadata",
        Weights => "weights",
        Ignore => "ignore",
        Mixed => "mixed",
    }
    aliases { "x" => "features", "y" => "targets", "meta" => "metadata", "m" => "metadata", "weight" => "weights" }
}

str_enum! {
    SourceKind { Table => "table", Lookup => "lookup" }
}

str_enum! {
    Modality {
        Spectroscopy => "spectroscopy",
        Markers => "markers",
        Metadata => "metadata",
        Image => "image",
    }
}

str_enum! {
    Partition {
        Train => "train",
        Test => "test",
        Val => "val",
        Predict => "predict",
        Auto => "auto",
    }
    aliases { "calibration" => "train", "cal" => "train", "validation" => "val", "holdout" => "test", "inference" => "predict" }
}

str_enum! {
    TaskType {
        Auto => "auto",
        Regression => "regression",
        Binary => "binary",
        Multiclass => "multiclass",
    }
}

str_enum! {
    SampleIndexBy { Row => "row", Id => "id" }
}

str_enum! {
    MergeMode {
        ConcatSamples => "concat_samples",
        ConcatFeatures => "concat_features",
        ByKey => "by_key",
        None => "none",
    }
}

str_enum! {
    Cardinality {
        OneToOne => "1:1",
        ManyToOne => "m:1",
        OneToMany => "1:m",
    }
}

str_enum! {
    Coverage {
        Complete => "complete",
        Warn => "warn",
        Drop => "drop",
        Error => "error",
    }
}

str_enum! {
    HeaderUnit {
        Nm => "nm",
        Cm1 => "cm-1",
        None => "none",
        Text => "text",
        Index => "index",
    }
    aliases { "wavenumber" => "cm-1", "nanometer" => "nm", "nanometers" => "nm", "cm1" => "cm-1", "cm_1" => "cm-1" }
}

str_enum! {
    SignalType {
        Auto => "auto",
        Absorbance => "absorbance",
        Reflectance => "reflectance",
        ReflectancePct => "reflectance%",
        Transmittance => "transmittance",
        TransmittancePct => "transmittance%",
        Log1R => "log(1/R)",
        KubelkaMunk => "kubelka-munk",
    }
}

str_enum! {
    NaPolicy {
        Auto => "auto",
        Abort => "abort",
        RemoveSample => "remove_sample",
        RemoveFeature => "remove_feature",
        Replace => "replace",
        Ignore => "ignore",
    }
}

str_enum! {
    FillMethod {
        Value => "value",
        Mean => "mean",
        Median => "median",
        ForwardFill => "forward_fill",
        BackwardFill => "backward_fill",
    }
}

str_enum! {
    CategoricalMode {
        Auto => "auto",
        Preserve => "preserve",
        None => "none",
    }
}

str_enum! {
    PartitionBy {
        Files => "files",
        Column => "column",
        Index => "index",
        IndexFile => "index_file",
    }
}

str_enum! {
    UnknownPolicy {
        Train => "train",
        Test => "test",
        Drop => "drop",
        Error => "error",
    }
}

str_enum! {
    FoldFormat {
        Auto => "auto",
        Csv => "csv",
        Json => "json",
        Yaml => "yaml",
        Txt => "txt",
    }
}

str_enum! {
    AggregateMethod {
        Mean => "mean",
        Median => "median",
        Vote => "vote",
        RobustMean => "robust_mean",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_values_and_coerce() {
        assert_eq!(Role::Features.value(), "features");
        assert_eq!(Role::coerce_str("X", "role").unwrap(), Role::Features);
        assert_eq!(Role::coerce_str("Y", "role").unwrap(), Role::Targets);
        assert_eq!(Role::coerce_str("M", "role").unwrap(), Role::Metadata);
        assert_eq!(
            Cardinality::coerce_str("1:1", "c").unwrap(),
            Cardinality::OneToOne
        );
        assert_eq!(
            HeaderUnit::coerce_str("CM-1", "u").unwrap(),
            HeaderUnit::Cm1
        );
        assert_eq!(HeaderUnit::coerce_str("cm1", "u").unwrap(), HeaderUnit::Cm1);
        assert_eq!(
            HeaderUnit::coerce_str("wavenumber", "u").unwrap(),
            HeaderUnit::Cm1
        );
        assert_eq!(
            SignalType::coerce_str("LOG(1/r)", "s").unwrap(),
            SignalType::Log1R
        );
        assert_eq!(SignalType::Log1R.value(), "log(1/R)");
        assert_eq!(
            Partition::coerce_str(" Calibration ", "p").unwrap(),
            Partition::Train
        );
    }

    #[test]
    fn coerce_error_message_matches_python() {
        let err = Role::coerce_str("bogus", "source[d].role").unwrap_err();
        assert_eq!(
            err.message,
            "source[d].role: 'bogus' is not valid; expected one of \
             'features', 'targets', 'metadata', 'weights', 'ignore', 'mixed'"
        );
        // non-string value uses py_repr
        let err = TaskType::coerce(&json!(5), "task_type").unwrap_err();
        assert_eq!(
            err.message,
            "task_type: 5 is not valid; expected one of 'auto', 'regression', 'binary', 'multiclass'"
        );
    }
}
