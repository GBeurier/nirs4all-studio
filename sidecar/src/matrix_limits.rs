//! Dimensions frozen by the native Archive V2 prediction and native training
//! contracts (`contracts/studio_archive_v2_prediction_v1.json`). The general
//! prediction, Playground and document routes are bounded by host memory only.

pub const MAX_SPECTRAL_FEATURES: usize = 8_192;

// Prediction batches are bounded separately from spectral width. The byte
// budget accommodates a million finite f64 values in decimal JSON form.
pub const MAX_PREDICTION_CELLS: usize = 1_000_000;
pub const MAX_PREDICTION_BODY_BYTES: usize = 32 * 1024 * 1024;
