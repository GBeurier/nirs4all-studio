//! The package catalogue embedded in this build (`recommended-config.json`).

use serde_json::Value;

/// The nirs4all releases Studio accepts: the `range` specifier of the
/// catalogue's required `nirs4all` package. This is the only place the sidecar
/// reads it from; no Rust constant or embedded script repeats a version.
pub fn nirs4all_range() -> Option<String> {
    let catalogue: Value =
        serde_json::from_str(include_str!("../../recommended-config.json")).ok()?;
    catalogue["required"]
        .as_array()?
        .iter()
        .find(|package| package["name"] == "nirs4all")?["range"]
        .as_str()
        .map(str::to_owned)
}
