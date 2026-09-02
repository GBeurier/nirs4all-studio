use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::{DagMlError, Result};

fn validate_identifier(value: &str) -> Result<()> {
    if value.is_empty() {
        return Err(DagMlError::InvalidIdentifier {
            value: value.to_string(),
            reason: "identifier is empty",
        });
    }
    if value.len() > 128 {
        return Err(DagMlError::InvalidIdentifier {
            value: value.to_string(),
            reason: "identifier is longer than 128 bytes",
        });
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
    {
        return Err(DagMlError::InvalidIdentifier {
            value: value.to_string(),
            reason: "identifier contains unsupported characters",
        });
    }
    Ok(())
}

macro_rules! define_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self> {
                let value = value.into();
                validate_identifier(&value)?;
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = DagMlError;

            fn try_from(value: String) -> Result<Self> {
                Self::new(value)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

define_id!(NodeId);
define_id!(ObservationId);
define_id!(SampleId);
define_id!(FoldId);
define_id!(TargetId);
define_id!(GroupId);
define_id!(ControllerId);
define_id!(VariantId);
define_id!(RunId);
define_id!(BundleId);
define_id!(ArtifactId);
define_id!(LineageId);
define_id!(BranchId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pipeline_style_node_ids() {
        assert!(NodeId::new("model:rf.v1").is_ok());
    }

    #[test]
    fn rejects_ambiguous_ids() {
        assert!(NodeId::new("model/rf").is_err());
        assert!(SampleId::new("").is_err());
    }
}
