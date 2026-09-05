use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Phase {
    Compile,
    Plan,
    FitCv,
    Select,
    Refit,
    Predict,
    Explain,
}

impl Phase {
    pub fn is_training(self) -> bool {
        matches!(self, Self::FitCv | Self::Refit)
    }

    /// Stable SCREAMING_SNAKE_CASE label matching the serde representation. Used
    /// as the `phase` field in ADR-12 observability spans.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Compile => "COMPILE",
            Self::Plan => "PLAN",
            Self::FitCv => "FIT_CV",
            Self::Select => "SELECT",
            Self::Refit => "REFIT",
            Self::Predict => "PREDICT",
            Self::Explain => "EXPLAIN",
        }
    }
}
