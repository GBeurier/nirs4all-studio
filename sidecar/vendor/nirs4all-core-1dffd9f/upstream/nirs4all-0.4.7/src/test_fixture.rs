//! Deterministic raw training cohort for native qualification tests.
use serde_json::{json, Value};

pub fn dense_training_record() -> Value {
    let x = (0..12)
        .map(|row| {
            (0..7)
                .map(|col| {
                    (((row + 1) * (col + 1)) as f64 * 0.13).sin()
                        + row as f64 * 0.11
                        + col as f64 * 0.2
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let y = x
        .iter()
        .enumerate()
        .map(|(i, row)| 2.0 * row[0] - row[2] + i as f64 * 0.13)
        .collect::<Vec<_>>();
    let ids = (0..12).map(|i| format!("s{i}")).collect::<Vec<_>>();
    json!({"schema":"nirs4all.dataset.v1", "schema_version":1, "origin_ids":ids, "fold_ids":vec![Value::Null;12],
        "dataset":{"schema":"nirs4all.multimodal-dataset", "schema_version":1, "name":"native-qualification", "sample_ids":ids,
            "sources":[{"name":"spectra", "sample_ids":ids, "representation_id":"signal_1d", "axes":["sample","wavelength"],
                "feature_names":null, "axis_units":{}, "axis_coordinates":{}, "array":{"dtype":"float64", "shape":[12,7], "values":x}}],
            "y":{"dtype":"float64", "shape":[12], "values":y}, "groups":null,
            "partitions":{"dtype":"<U5", "shape":[12], "values":vec!["train";12]}}})
}
