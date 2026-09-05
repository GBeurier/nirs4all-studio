//! Shared spectral dimensions for training, catalogue and prediction.

pub const MAX_SPECTRAL_FEATURES: usize = 8_192;

// Prediction batches are bounded separately from spectral width. The byte
// budget accommodates a million finite f64 values in decimal JSON form.
pub const MAX_PREDICTION_CELLS: usize = 1_000_000;
pub const MAX_PREDICTION_BODY_BYTES: usize = 32 * 1024 * 1024;
