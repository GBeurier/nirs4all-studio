// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Fixed-size raw dataset transport. Identity alignment belongs to IO.
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub type DatasetResult<T> = Result<T, String>;
fn fail<T>(label: &str) -> DatasetResult<T> {
    Err(label.to_owned())
}
fn closed(value: &Value, required: &[&str], optional: &[&str]) -> DatasetResult<()> {
    let object = value.as_object().ok_or("Expected object")?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return fail("Invalid dataset fields");
    }
    Ok(())
}
fn strings(value: &Value, unique: bool) -> DatasetResult<Vec<String>> {
    let mut seen = BTreeSet::new();
    value
        .as_array()
        .ok_or("Expected identity array")?
        .iter()
        .map(|v| {
            let s = v
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .ok_or("Nonempty string identities required")?;
            if unique && !seen.insert(s.to_owned()) {
                return fail("Duplicate identities");
            }
            Ok(s.to_owned())
        })
        .collect()
}
fn dimensions(value: &Value) -> DatasetResult<Vec<usize>> {
    let shape = value.as_array().ok_or("Shape array required")?;
    if shape.is_empty() || shape.len() > 8 {
        return fail("Invalid tensor rank");
    }
    let result: Vec<usize> = shape
        .iter()
        .map(|x| {
            x.as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .ok_or_else(|| "Shape must contain nonnegative integers".to_owned())
        })
        .collect::<Result<_, _>>()?;
    let count = result
        .iter()
        .try_fold(1usize, |a, b| a.checked_mul(*b))
        .ok_or("Shape budget exceeded")?;
    if count > 16_777_216 {
        return fail("Shape budget exceeded");
    }
    Ok(result)
}
fn cell(value: &Value, dtype: &str) -> DatasetResult<()> {
    let valid = match dtype {
        "object" => value.is_null() || value.is_boolean() || value.is_string() || value.is_number(),
        "bool" => value.is_boolean(),
        "float64" => value.as_f64().is_some_and(f64::is_finite),
        "float32" => value
            .as_f64()
            .is_some_and(|x| x.is_finite() && (x as f32).is_finite()),
        "int64" => value.as_i64().is_some(),
        "uint64" => value.as_u64().is_some(),
        "int32" => value.as_i64().is_some_and(|x| i32::try_from(x).is_ok()),
        "uint32" => value.as_u64().is_some_and(|x| u32::try_from(x).is_ok()),
        "int16" => value.as_i64().is_some_and(|x| i16::try_from(x).is_ok()),
        "uint16" => value.as_u64().is_some_and(|x| u16::try_from(x).is_ok()),
        "int8" => value.as_i64().is_some_and(|x| i8::try_from(x).is_ok()),
        "uint8" => value.as_u64().is_some_and(|x| u8::try_from(x).is_ok()),
        _ if dtype.starts_with("<U") => dtype[2..]
            .parse::<usize>()
            .ok()
            .zip(value.as_str())
            .is_some_and(|(n, s)| s.chars().count() <= n),
        _ => false,
    };
    if (dtype.contains("int") || dtype == "object")
        && (value
            .as_i64()
            .is_some_and(|x| x.unsigned_abs() > 9_007_199_254_740_991)
            || value.as_u64().is_some_and(|x| x > 9_007_199_254_740_991))
    {
        return fail("Integer precision exceeds portable JSON range");
    }
    if dtype == "object"
        && value
            .as_f64()
            .is_some_and(|x| x.fract() == 0.0 && x.abs() > 9_007_199_254_740_991.0)
    {
        return fail("Object numeric integers must be exactly representable in JavaScript");
    }
    if !valid {
        return fail("Array scalar incompatible with dtype (finite fixed-size transport required)");
    }
    Ok(())
}
fn nested(value: &Value, shape: &[usize], dtype: &str) -> DatasetResult<()> {
    if shape.is_empty() {
        return cell(value, dtype);
    }
    let rows = value
        .as_array()
        .ok_or("Rectangular nested values required")?;
    if rows.len() != shape[0] {
        return fail("Array shape differs from values");
    }
    for row in rows {
        nested(row, &shape[1..], dtype)?;
    }
    Ok(())
}
fn array(value: &Value) -> DatasetResult<Vec<usize>> {
    closed(value, &["dtype", "shape", "values"], &[])?;
    let shape = dimensions(&value["shape"])?;
    let dtype = value["dtype"].as_str().ok_or("Dtype string required")?;
    // Check dtype even for an empty array.
    let probe = if dtype == "object" {
        Value::Null
    } else if dtype == "bool" {
        json!(false)
    } else if dtype.starts_with("<U") {
        json!("")
    } else {
        json!(0)
    };
    cell(&probe, dtype)?;
    nested(&value["values"], &shape, dtype)?;
    Ok(shape)
}
fn round_storage(array: &mut Value) {
    fn round(value: &mut Value) {
        if let Some(rows) = value.as_array_mut() {
            for row in rows {
                round(row);
            }
        } else {
            *value = json!(value.as_f64().unwrap() as f32 as f64);
        }
    }
    if array["dtype"] == "float32" {
        round(&mut array["values"]);
    }
}
fn axes(
    representation: &str,
) -> DatasetResult<(&'static [&'static str], &'static str, &'static str)> {
    Ok(match representation {
        "signal_1d" => (&["sample", "wavelength"], "dense_signal", "nirs"),
        "tabular_numeric" => (&["sample", "feature"], "table", "tabular"),
        "tabular_mixed" => (&["sample", "column"], "table", "tabular"),
        "sample_metadata" => (&["sample", "field"], "metadata", "metadata"),
        "gray_image" => (&["sample", "height", "width"], "gray_image", "image"),
        "rgb_image" => (
            &["sample", "height", "width", "channel"],
            "image_rgb",
            "image",
        ),
        "mc_image" => (
            &["sample", "height", "width", "channel"],
            "multichannel_image",
            "image",
        ),
        "multispectral_image" => (
            &["sample", "height", "width", "band"],
            "multichannel_image",
            "image",
        ),
        "series_mv" => (
            &["sample", "time", "variable"],
            "time_series",
            "time_series",
        ),
        _ => return fail("Unsupported fixed-size representation"),
    })
}
fn placeholder(shape: &[usize], dtype: &str) -> Value {
    if shape.is_empty() {
        return if dtype == "object" {
            Value::Null
        } else if dtype == "bool" {
            json!(false)
        } else if dtype.starts_with("<U") {
            json!("")
        } else {
            json!(0)
        };
    }
    Value::Array(
        (0..shape[0])
            .map(|_| placeholder(&shape[1..], dtype))
            .collect(),
    )
}

fn normalize_ragged(source: &mut Value, ids: &[String], strict: bool) -> DatasetResult<()> {
    closed(
        source,
        &[
            "source_kind",
            "name",
            "sample_ids",
            "representation_id",
            "axes",
            "array",
            "offsets",
            "time_coordinates",
            "channel_names",
            "time_unit",
            "presence_mask",
        ],
        &[],
    )?;
    if source["representation_id"] != "series_mv"
        || source["axes"] != json!(["sample", "time", "variable"])
    {
        return fail("Invalid ragged representation or axes");
    }
    let source_ids = strings(&source["sample_ids"], true)?;
    if source_ids.iter().any(|id| !ids.contains(id)) || (strict && source_ids.len() != ids.len()) {
        return fail("Ragged source identity alignment mismatch");
    }
    let shape = array(&source["array"])?;
    if shape.len() != 2
        || shape[1] == 0
        || source["array"]["dtype"] == "object"
        || source["array"]["dtype"].as_str().unwrap().starts_with("<U")
    {
        return fail("Ragged packed values require numeric matrix channels");
    }
    round_storage(&mut source["array"]);
    if array(&source["offsets"])? != vec![source_ids.len() + 1]
        || source["offsets"]["dtype"] != "int64"
    {
        return fail("Ragged offsets must be an int64 sample boundary vector");
    }
    let offsets: Vec<usize> = source["offsets"]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| {
            value
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| "Invalid ragged offset".to_owned())
        })
        .collect::<Result<_, _>>()?;
    if offsets.first() != Some(&0)
        || offsets.last() != Some(&shape[0])
        || offsets.windows(2).any(|pair| pair[1] < pair[0])
    {
        return fail("Ragged offsets must start at zero, increase and end at packed length");
    }
    if array(&source["presence_mask"])? != vec![source_ids.len()]
        || source["presence_mask"]["dtype"] != "bool"
    {
        return fail("Invalid ragged presence mask");
    }
    let presence = source["presence_mask"]["values"].as_array().unwrap();
    if presence
        .iter()
        .enumerate()
        .any(|(index, present)| present == true && offsets[index] == offsets[index + 1])
    {
        return fail("Present ragged samples require at least one packed point");
    }
    if !source["channel_names"].is_null()
        && strings(&source["channel_names"], true)?.len() != shape[1]
    {
        return fail("Ragged channel names mismatch");
    }
    if !source["time_unit"].is_null()
        && source["time_unit"]
            .as_str()
            .is_none_or(|unit| unit.trim().is_empty())
    {
        return fail("Invalid ragged time unit");
    }
    let times = if source["time_coordinates"].is_null() {
        None
    } else {
        if array(&source["time_coordinates"])? != vec![shape[0]]
            || source["time_coordinates"]["dtype"] == "object"
            || source["time_coordinates"]["dtype"] == "bool"
            || source["time_coordinates"]["dtype"]
                .as_str()
                .unwrap()
                .starts_with("<U")
        {
            return fail("Ragged time coordinates must match packed length");
        }
        round_storage(&mut source["time_coordinates"]);
        let times: Vec<f64> = source["time_coordinates"]["values"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| {
                value
                    .as_f64()
                    .ok_or_else(|| "Numeric ragged times required".to_owned())
            })
            .collect::<Result<_, _>>()?;
        if offsets.windows(2).any(|pair| {
            times[pair[0]..pair[1]]
                .windows(2)
                .any(|times| times[1] <= times[0])
        }) {
            return fail("Ragged times must strictly increase within each sample");
        }
        round_storage(&mut source["time_coordinates"]);
        Some(
            source["time_coordinates"]["values"]
                .as_array()
                .unwrap()
                .clone(),
        )
    };
    let rows = source["array"]["values"].as_array().unwrap();
    let mask = source["presence_mask"]["values"].as_array().unwrap();
    let mut packed = Vec::new();
    let mut aligned_offsets = vec![0usize];
    let mut aligned_times = Vec::new();
    let mut present = Vec::new();
    for id in ids {
        if let Some(index) = source_ids.iter().position(|source_id| source_id == id) {
            packed.extend_from_slice(&rows[offsets[index]..offsets[index + 1]]);
            if let Some(times) = &times {
                aligned_times.extend_from_slice(&times[offsets[index]..offsets[index + 1]]);
            }
            present.push(mask[index].clone());
        } else {
            present.push(json!(false));
        }
        aligned_offsets.push(packed.len());
    }
    source["array"]["shape"][0] = json!(packed.len());
    source["array"]["values"] = json!(packed);
    source["offsets"]["shape"] = json!([ids.len() + 1]);
    source["offsets"]["values"] = json!(aligned_offsets);
    if times.is_some() {
        source["time_coordinates"]["shape"] = json!([aligned_times.len()]);
        source["time_coordinates"]["values"] = json!(aligned_times);
    }
    source["sample_ids"] = json!(ids);
    source["presence_mask"] = json!({"dtype":"bool", "shape":[ids.len()], "values":present});
    Ok(())
}

fn normalize_masked_targets(
    values: &mut Value,
    mask: &Value,
    shape: &[usize],
    dtype: &str,
) -> DatasetResult<()> {
    if shape.is_empty() {
        if mask == &json!(false) {
            if !values.is_null()
                && !values.is_boolean()
                && !values.as_f64().is_some_and(f64::is_finite)
            {
                return fail("Masked target storage requires null or finite numeric values");
            }
            *values = if dtype == "bool" {
                json!(false)
            } else if dtype.starts_with("float") {
                json!(0.0)
            } else {
                json!(0)
            };
        } else {
            cell(values, dtype)?;
        }
        return Ok(());
    }
    let rows = values
        .as_array_mut()
        .ok_or("Rectangular target values required")?;
    let masks = mask.as_array().ok_or("Rectangular target mask required")?;
    if rows.len() != shape[0] || masks.len() != shape[0] {
        return fail("Target shape differs from values/mask");
    }
    for (row, observed) in rows.iter_mut().zip(masks) {
        normalize_masked_targets(row, observed, &shape[1..], dtype)?;
    }
    Ok(())
}

/// Validate and align a common raw dataset. No parsing, splitting or fitting.
pub fn normalize_dataset(value: &Value) -> DatasetResult<Value> {
    closed(
        value,
        &[
            "schema",
            "schema_version",
            "dataset",
            "origin_ids",
            "fold_ids",
        ],
        &[],
    )?;
    let v2 =
        value["schema"] == "nirs4all.dataset.v2" && value["schema_version"].as_u64() == Some(2);
    if !v2
        && (value["schema"] != "nirs4all.dataset.v1" || value["schema_version"].as_u64() != Some(1))
    {
        return fail("Unsupported public dataset schema");
    }
    let mut out = value.clone();
    let raw = &mut out["dataset"];
    closed(
        raw,
        &[
            "schema",
            "schema_version",
            "name",
            "sample_ids",
            "sources",
            "y",
            "groups",
            "partitions",
        ],
        &[
            "target_names",
            "target_mask",
            "task_type",
            "source_alignment",
            "independent_unit_ids",
            "repetition_ids",
        ],
    )?;
    if raw["schema"] != "nirs4all.multimodal-dataset"
        || raw["schema_version"].as_u64() != Some(1)
        || raw["name"].as_str().is_none_or(|s| s.trim().is_empty())
    {
        return fail("Unsupported multimodal dataset schema/name");
    }
    let ids = strings(&raw["sample_ids"], true)?;
    let strict = match raw.get("source_alignment") {
        None => true,
        Some(Value::String(value)) if value == "strict" => true,
        Some(Value::String(value)) if value == "left" => false,
        _ => return fail("source_alignment must be strict or left"),
    };
    raw["source_alignment"] = json!(if strict { "strict" } else { "left" });
    let sources = raw["sources"]
        .as_array_mut()
        .ok_or("Sources array required")?;
    if sources.is_empty() {
        return fail("Named sources required");
    }
    let mut names = BTreeSet::new();
    for source in sources {
        if source["source_kind"] == "ragged_series" {
            if !v2 {
                return fail("Ragged sources require public dataset v2");
            }
            let name = source["name"]
                .as_str()
                .filter(|name| !name.trim().is_empty())
                .ok_or("Ragged source name required")?;
            if !names.insert(name.to_owned()) {
                return fail("Duplicate source names");
            }
            normalize_ragged(source, &ids, strict)?;
            continue;
        }
        closed(
            source,
            &[
                "name",
                "sample_ids",
                "representation_id",
                "axes",
                "feature_names",
                "axis_units",
                "axis_coordinates",
                "array",
            ],
            &["presence_mask"],
        )?;
        let name = source["name"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or("Source name required")?;
        if !names.insert(name.to_owned()) {
            return fail("Duplicate source names");
        }
        let shape = array(&source["array"])?;
        round_storage(&mut source["array"]);
        let repr = source["representation_id"]
            .as_str()
            .ok_or("Representation required")?;
        let (semantic_axes, _, _) = axes(repr)?;
        if strings(&source["axes"], true)? != semantic_axes {
            return fail("Semantic axes differ from representation");
        }
        if shape.len() != semantic_axes.len()
            || shape[1..].contains(&0)
            || (repr == "rgb_image" && shape.last() != Some(&3))
        {
            return fail("Source rank/shape differs from representation");
        }
        let dtype = source["array"]["dtype"]
            .as_str()
            .ok_or("Dtype required")?
            .to_owned();
        if !["tabular_mixed", "sample_metadata"].contains(&repr)
            && (dtype == "object" || dtype.starts_with("<U"))
        {
            return fail("Numeric representation requires numeric dtype");
        }
        let source_ids = strings(&source["sample_ids"], true)?;
        if source_ids.len() != shape[0]
            || source_ids.iter().any(|s| !ids.contains(s))
            || (strict && source_ids.len() != ids.len())
        {
            return fail("Source identity alignment mismatch");
        }
        if !source["feature_names"].is_null()
            && (shape.len() != 2 || strings(&source["feature_names"], true)?.len() != shape[1])
        {
            return fail("Feature names mismatch");
        }
        for (axis, unit) in source["axis_units"]
            .as_object()
            .ok_or("Axis units object required")?
        {
            if axis == "sample"
                || !semantic_axes.contains(&axis.as_str())
                || (!unit.is_null() && unit.as_str().is_none_or(|s| s.trim().is_empty()))
            {
                return fail("Invalid axis unit");
            }
        }
        source["axis_units"]
            .as_object_mut()
            .unwrap()
            .retain(|_, value| !value.is_null());
        for (axis, coordinates) in source["axis_coordinates"]
            .as_object()
            .ok_or("Coordinates object required")?
        {
            let index = semantic_axes
                .iter()
                .position(|x| *x == axis)
                .filter(|i| *i > 0)
                .ok_or("Invalid coordinate axis")?;
            let coords = coordinates.as_array().ok_or("Coordinates array required")?;
            if coords.iter().any(Value::is_string) && coords.iter().any(|value| !value.is_string())
            {
                return fail("Coordinates cannot mix numeric and string labels");
            }

            if coords.iter().any(|value| {
                value.as_f64().is_some_and(|number| {
                    number.fract() == 0.0 && number.abs() > 9_007_199_254_740_991.0
                })
            }) {
                return fail("Axis coordinates must be exactly representable in JavaScript");
            }
            if coords.len() != shape[index]
                || coords
                    .iter()
                    .any(|v| !(v.is_string() || v.as_f64().is_some_and(f64::is_finite)))
                || coords
                    .iter()
                    .enumerate()
                    .any(|(i, v)| coords[..i].contains(v))
            {
                return fail("Coordinate values/length mismatch");
            }
            if axis == "time" || axis == "wavelength" {
                let numbers: Vec<f64> = coords
                    .iter()
                    .map(|x| {
                        x.as_f64()
                            .ok_or_else(|| "Time/wavelength coordinates must be numeric".to_owned())
                    })
                    .collect::<Result<_, _>>()?;
                let increasing = numbers.windows(2).all(|w| w[1] > w[0]);
                if !increasing && (axis == "time" || !numbers.windows(2).all(|w| w[1] < w[0])) {
                    return fail("Coordinates must be strictly monotonic");
                }
            }
        }
        let mask = match source.get("presence_mask") {
            Some(v) => {
                if array(v)? != vec![source_ids.len()] || v["dtype"] != "bool" {
                    return fail("Invalid source presence mask");
                }
                v["values"].as_array().unwrap().clone()
            }
            None => vec![json!(true); source_ids.len()],
        };
        let rows = source["array"]["values"].as_array().unwrap();
        let mut aligned = Vec::new();
        let mut present = Vec::new();
        for id in &ids {
            if let Some(index) = source_ids.iter().position(|s| s == id) {
                aligned.push(rows[index].clone());
                present.push(mask[index].clone());
            } else {
                aligned.push(placeholder(&shape[1..], &dtype));
                present.push(json!(false));
            }
        }
        source["array"]["shape"][0] = json!(ids.len());
        source["array"]["values"] = json!(aligned);
        source["sample_ids"] = json!(ids);
        source["presence_mask"] = json!({"dtype":"bool","shape":[ids.len()],"values":present});
    }
    if array(&raw["partitions"])? != vec![ids.len()] {
        return fail("Partition shape mismatch");
    }
    let partitions = strings(&raw["partitions"]["values"], false)?;
    if partitions
        .iter()
        .any(|p| !["train", "test", "predict"].contains(&p.as_str()))
    {
        return fail("Invalid partition");
    }
    if !raw["groups"].is_null() && array(&raw["groups"])? != vec![ids.len()] {
        return fail("Group shape mismatch");
    }
    if !raw["groups"].is_null() {
        round_storage(&mut raw["groups"]);
    }
    if !raw["y"].is_null() {
        if v2 && raw.get("target_mask").is_some_and(|mask| !mask.is_null()) {
            let shape = dimensions(&raw["y"]["shape"])?;
            if array(&raw["target_mask"])? != shape || raw["target_mask"]["dtype"] != "bool" {
                return fail("Target mask mismatch");
            }
            let dtype = raw["y"]["dtype"]
                .as_str()
                .ok_or("Target dtype required")?
                .to_owned();
            let mask = raw["target_mask"]["values"].clone();
            normalize_masked_targets(&mut raw["y"]["values"], &mask, &shape, &dtype)?;
        }
        let shape = array(&raw["y"])?;
        round_storage(&mut raw["y"]);
        if shape[0] != ids.len() || shape.len() > 2 || (shape.len() == 2 && shape[1] == 0) {
            return fail("Target shape mismatch");
        }
        if raw.get("target_mask").is_none_or(Value::is_null) {
            raw["target_mask"] = json!({"dtype":"bool","shape":shape,"values":mask_true(&shape)});
        } else if array(&raw["target_mask"])? != shape || raw["target_mask"]["dtype"] != "bool" {
            return fail("Target mask mismatch");
        }
    } else if raw.get("target_mask").is_some_and(|v| !v.is_null()) {
        return fail("Absent targets require absent mask");
    }
    if raw.get("target_names").is_none_or(Value::is_null) {
        let width = raw["y"]["shape"]
            .as_array()
            .filter(|s| s.len() == 2)
            .and_then(|s| s[1].as_u64())
            .unwrap_or(1);
        raw["target_names"] = json!(if raw["y"].is_null() {
            vec![]
        } else if width == 1 {
            vec!["y".to_owned()]
        } else {
            (0..width).map(|i| format!("y{i}")).collect()
        });
    }
    let targets = strings(&raw["target_names"], true)?;
    if !raw["y"].is_null() {
        let shape = dimensions(&raw["y"]["shape"])?;
        if targets.len() != *shape.get(1).unwrap_or(&1) {
            return fail("Target names mismatch");
        }
    }
    if raw.get("task_type").is_none() {
        raw["task_type"] = Value::Null;
    }
    if !raw["task_type"].is_null()
        && raw["task_type"] != "regression"
        && raw["task_type"] != "classification"
    {
        return fail("Unsupported task_type");
    }
    if raw.get("target_mask").is_none() {
        raw["target_mask"] = Value::Null;
    }
    if raw.get("repetition_ids").is_some() && raw.get("independent_unit_ids").is_none() {
        return fail("repetition_ids require independent_unit_ids");
    }
    for labels in ["independent_unit_ids", "repetition_ids"] {
        if let Some(v) = raw.get(labels) {
            if strings(v, false)?.len() != ids.len() {
                return fail("Experimental unit label shape mismatch");
            }
        }
    }
    let origins = strings(&out["origin_ids"], false)?;
    let folds = out["fold_ids"]
        .as_array()
        .ok_or("fold_ids array required")?;
    if origins.len() != ids.len()
        || folds.len() != ids.len()
        || folds
            .iter()
            .any(|f| !f.is_null() && f.as_str().is_none_or(|s| s.trim().is_empty()))
    {
        return fail("Origin/fold alignment mismatch");
    }
    let mut membership = BTreeMap::new();
    for i in 0..ids.len() {
        if partitions[i] != "train" && !folds[i].is_null() {
            return fail("Only training samples can declare folds");
        }
        let state = (partitions[i].clone(), folds[i].clone());
        if membership
            .insert(origins[i].clone(), state.clone())
            .is_some_and(|old| old != state)
        {
            return fail("An origin cannot cross partitions or folds");
        }
    }
    for label in ["groups", "independent_unit_ids"] {
        let values = if label == "groups" {
            out["dataset"][label]["values"].as_array()
        } else {
            out["dataset"][label].as_array()
        };
        if let Some(values) = values {
            let mut units = BTreeMap::new();
            for (i, unit) in values.iter().enumerate() {
                let state = (partitions[i].clone(), folds[i].clone());
                if units
                    .insert(unit.to_string(), state.clone())
                    .is_some_and(|old| old != state)
                {
                    return fail("A group/independent unit cannot cross partitions or folds");
                }
            }
        }
    }
    if let Some(units) = out["dataset"]["independent_unit_ids"].as_array() {
        let repetitions = out["dataset"]["repetition_ids"].as_array();
        let mut seen = BTreeSet::new();
        for (i, unit) in units.iter().enumerate() {
            let rep = repetitions.map(|r| r[i].clone()).unwrap_or(Value::Null);
            if !seen.insert((unit.to_string(), rep.to_string())) {
                return fail("Repeated units need distinct repetition_ids");
            }
        }
    }
    Ok(out)
}
fn mask_true(shape: &[usize]) -> Value {
    if shape.is_empty() {
        json!(true)
    } else {
        Value::Array((0..shape[0]).map(|_| mask_true(&shape[1..])).collect())
    }
}

/// Project U07 raw sources and exact cohort-independent encoder contracts.
pub fn u07_sources(value: &Value) -> DatasetResult<Value> {
    let normalized = normalize_dataset(value)?;
    let raw = &normalized["dataset"];
    let sources = raw["sources"].as_array().unwrap();
    let order = ["nir", "image", "series", "metadata"];
    let reprs = ["signal_1d", "rgb_image", "series_mv", "tabular_mixed"];
    if sources.len() != 4
        || raw["source_alignment"] != "strict"
        || sources
            .iter()
            .any(|source| source["source_kind"] == "ragged_series")
    {
        return fail("U07 requires four ordered strictly aligned sources");
    }
    let mut schemas = serde_json::Map::new();
    let mut blocks = serde_json::Map::new();
    for (i, source) in sources.iter().enumerate() {
        if source["name"] != order[i]
            || source["representation_id"] != reprs[i]
            || source["presence_mask"]["values"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v != true)
        {
            return fail("U07 source name, representation or missing input mismatch");
        }
        if source["source_kind"] == "ragged_series" {
            return fail("Matrix projection requires an explicit Methods ragged encoder");
        }
        let shape = dimensions(&source["array"]["shape"])?;
        let dtype = source["array"]["dtype"].as_str().unwrap();
        if i < 3 && !["float32", "float64"].contains(&dtype) {
            return fail("U07 tensors need float32/float64");
        }
        if i == 3
            && (shape[1..] != [2]
                || source["feature_names"]
                    .as_array()
                    .is_none_or(|n| n.len() != 2))
        {
            return fail("U07 metadata needs named numeric and category columns");
        }
        let (axis_names, type_id, modality) = axes(reprs[i])?;
        let mut contract_shape = json!(shape);
        contract_shape[0] = Value::Null;
        let native_axes: Vec<Value> = axis_names.iter().enumerate().map(|(j,axis)| json!({"name":axis,"kind":match *axis {"column"|"field"|"variable"=>"feature","band"=>"channel",s=>s},"unit":source["axis_units"][*axis],"size":if j == 0 {Value::Null} else {json!(shape[j])},"variable":false})).collect();
        let descriptor = json!({"source_id":order[i],"representation_id":reprs[i],"type_id":type_id,"modality":modality,"axes":axis_names,"shape":contract_shape,"dtype":dtype,"feature_names":source["feature_names"],"axis_units":source["axis_units"],"axis_coordinates":source["axis_coordinates"],"native_representation":{"id":reprs[i],"type_id":type_id,"rank":shape.len(),"axes":native_axes,"container":"ndarray","dtype":if dtype=="object"||dtype.starts_with("<U") {Value::Null} else {json!(dtype)},"sparse":false,"ragged":false}});
        let schema = canonical_source_schema(
            &json!({"representation_id":reprs[i],"input_shape":shape[1..],"dtype":dtype,"identity":serde_json::to_string(&descriptor).map_err(|e| e.to_string())?}),
        )?;
        let mut entry = json!({"sample_ids":raw["sample_ids"],"descriptor":schema,"shape":shape});
        if i == 3 {
            for row in source["array"]["values"].as_array().unwrap() {
                if metadata_number(&row[0]).is_err() || !row[1].is_string() {
                    return fail("U07 metadata requires finite numeric and string category cells");
                }
            }
            entry["rows"] = source["array"]["values"].clone();
        } else {
            let mut data = Vec::new();
            flatten(&source["array"]["values"], &mut data);
            entry["data"] = json!(data);
        }
        schemas.insert(order[i].to_owned(), schema);
        blocks.insert(order[i].to_owned(), entry);
    }
    Ok(json!({"sample_ids":raw["sample_ids"],"source_schemas":schemas,"sources":blocks}))
}
fn flatten(value: &Value, out: &mut Vec<Value>) {
    if let Some(rows) = value.as_array() {
        for row in rows {
            flatten(row, out);
        }
    } else {
        out.push(value.clone());
    }
}

/// Owner raw-content contract: tagged JSON tree with binary64 numeric tokens.
pub fn canonical_content_tree(value: &Value) -> DatasetResult<Value> {
    Ok(match value {
        Value::Null => json!(["null"]),
        Value::Bool(value) => json!(["bool", value]),
        Value::String(value) => json!(["string", value]),
        Value::Number(value) => {
            let number = value
                .as_f64()
                .filter(|x| x.is_finite())
                .ok_or("Content numbers must be finite")?;
            json!([
                "number",
                format!(
                    "{:016x}",
                    if number == 0.0 { 0.0_f64 } else { number }.to_bits()
                )
            ])
        }
        Value::Array(values) => json!([
            "array",
            values
                .iter()
                .map(canonical_content_tree)
                .collect::<DatasetResult<Vec<_>>>()?
        ]),
        Value::Object(values) => {
            let mut keys: Vec<_> = values.keys().collect();
            keys.sort();
            json!([
                "object",
                keys.into_iter()
                    .map(|key| Ok(json!([key, canonical_content_tree(&values[key])?])))
                    .collect::<DatasetResult<Vec<Value>>>()?
            ])
        }
    })
}

pub fn canonical_content_bytes(value: &Value) -> DatasetResult<Vec<u8>> {
    serde_json::to_vec(&canonical_content_tree(value)?).map_err(|error| error.to_string())
}

fn metadata_number(value: &Value) -> DatasetResult<f64> {
    let number = if let Some(text) = value.as_str() {
        let text = text.trim_matches(|c: char| {
            matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{000b}' | '\u{000c}')
        });
        static DECIMAL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        if !DECIMAL
            .get_or_init(|| {
                regex::Regex::new(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
                    .expect("constant decimal grammar")
            })
            .is_match(text)
        {
            return fail("Metadata numeric column requires finite decimal numbers");
        }
        text.parse::<f64>()
            .map_err(|_| "Metadata numeric column requires finite decimal numbers".to_owned())?
    } else {
        value
            .as_f64()
            .ok_or("Metadata numeric column requires finite decimal numbers")?
    };
    if !number.is_finite() {
        return fail("Metadata numeric column requires finite decimal numbers");
    }
    Ok(number)
}

pub fn dataset_content_bytes(value: &Value) -> DatasetResult<Vec<u8>> {
    let mut normalized = normalize_dataset(value)?;
    let raw = &mut normalized["dataset"];
    let u07 = raw["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| source["name"].as_str().unwrap())
        .collect::<Vec<_>>()
        == vec!["nir", "image", "series", "metadata"];
    for source in raw["sources"].as_array_mut().unwrap() {
        if source["representation_id"] == "tabular_mixed" {
            source["array"]["dtype"] = json!("object");
            if u07 {
                for row in source["array"]["values"].as_array_mut().unwrap() {
                    row[0] = json!(metadata_number(&row[0])?);
                }
            }
        }
    }
    for field in ["partitions", "groups", "y"] {
        let mut cells = Vec::new();
        flatten(&raw[field]["values"], &mut cells);
        if (raw[field]["dtype"] == "object" && cells.iter().all(Value::is_string))
            || raw[field]["dtype"]
                .as_str()
                .is_some_and(|dtype| dtype.starts_with("<U"))
        {
            raw[field]["dtype"] = json!("string");
        }
    }
    canonical_content_bytes(&normalized)
}

pub fn canonical_source_schema(schema: &Value) -> DatasetResult<Value> {
    let mut value = schema.clone();
    let mut descriptor: Value = serde_json::from_str(
        value["identity"]
            .as_str()
            .ok_or("Invalid source schema identity")?,
    )
    .map_err(|error| error.to_string())?;
    descriptor["axis_units"]
        .as_object_mut()
        .ok_or("Source axis units required")?
        .retain(|_, value| !value.is_null());
    if value["representation_id"] == "tabular_mixed" {
        value["dtype"] = json!("object");
        descriptor["dtype"] = json!("object");
    }
    value["identity"] =
        json!(serde_json::to_string(&descriptor).map_err(|error| error.to_string())?);
    Ok(value)
}

pub fn compatible_source_schemas(current: &Value, saved: &Value) -> DatasetResult<Value> {
    let current = current
        .as_object()
        .ok_or("Source schemas object required")?;
    let saved_map = saved.as_object().ok_or("Source schemas object required")?;
    if current.len() != saved_map.len() {
        return fail("Source schema names differ");
    }
    for (name, schema) in current {
        let other = saved_map.get(name).ok_or("Source schema names differ")?;
        let mut a = canonical_source_schema(schema)?;
        let mut b = canonical_source_schema(other)?;
        for value in [&mut a, &mut b] {
            value["identity"] = serde_json::from_str(value["identity"].as_str().unwrap())
                .map_err(|error| error.to_string())?;
        }
        if canonical_content_bytes(&a)? != canonical_content_bytes(&b)? {
            return fail(&format!(
                "Source {name} schema differs (shape, dtype, axes, units, coordinates or columns)"
            ));
        }
    }
    Ok(saved.clone())
}

fn runtime_group_ids(raw: &Value) -> DatasetResult<Option<Vec<String>>> {
    if raw["groups"].is_null() {
        return Ok(None);
    }
    strings(&raw["groups"]["values"], false)
        .map(Some)
        .map_err(|_| "Multimodal replay group IDs must be nonempty strings".into())
}

/// Target-free raw cohort and identity records, independent of a trained graph.
/// DAG owns validation/fingerprints of the emitted coordinator relations.
/// This replay profile requires declared group IDs to be nonempty strings,
/// matching native identity contracts without host-specific numeric formatting.
/// Generic IO datasets may still contain numeric group labels.
pub fn multimodal_runtime_input(value: &Value) -> DatasetResult<Value> {
    use sha2::{Digest, Sha256};
    let normalized = normalize_dataset(value)?;
    let raw = &normalized["dataset"];
    if !raw["y"].is_null()
        || raw["partitions"]["values"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p != "predict")
    {
        return fail("Raw replay requires a target-free prediction cohort");
    }
    if raw
        .get("target_names")
        .and_then(Value::as_array)
        .is_some_and(|names| !names.is_empty() && names != &vec![json!("y")])
    {
        return fail("U07 replay requires absent target names or ['y']");
    }
    let group_ids = runtime_group_ids(raw)?;
    let mut output = u07_sources(&normalized)?;
    let records: Vec<Value> = raw["sample_ids"].as_array().unwrap().iter().enumerate().map(|(i, id)| {
        let mut metadata = serde_json::Map::new();
        metadata.insert("input_origin_id".into(), normalized["origin_ids"][i].clone());
        for key in ["independent_unit_ids", "repetition_ids"] {
            if let Some(values) = raw.get(key).and_then(Value::as_array) {
                metadata.insert(if key == "independent_unit_ids" { "independent_unit_id" } else { "repetition_id" }.into(), values[i].clone());
            }
        }
        json!({"unit_level":"observation", "unit_id":null, "observation_id":id,"sample_id":id,
            "source_id":null,"rep_id":raw.get("repetition_ids").and_then(Value::as_array).map(|v|v[i].clone()),
            "target_id":"y","group_id":group_ids.as_ref().map(|values|values[i].clone()),
            "origin_sample_id":null,"derived_unit_id":null,"component_observation_ids":[],
            "sample_influence_weight":null,"quality_flag":null,"is_augmented":false,"metadata":metadata})
    }).collect();
    output["source_ids"] = json!(["src0", "src1", "src2", "src3"]);
    output["coordinator_relations"] = json!({"records":records});
    output["data_content_fingerprint"] = json!(format!(
        "{:x}",
        Sha256::digest(dataset_content_bytes(&normalized)?)
    ));
    Ok(output)
}

/// Cohort-independent raw input contract for fitted predictor compatibility.
pub fn public_source_schema(value: &Value, source_id: &str) -> DatasetResult<Value> {
    let normalized = normalize_dataset(value)?;
    let source = normalized["dataset"]["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == source_id)
        .ok_or("Unknown selected source")?;
    if source["source_kind"] == "ragged_series" {
        return Ok(
            json!({"name":source_id, "source_kind":"ragged_series", "representation_id":source["representation_id"],
            "axes":source["axes"], "shape":[null,null,source["array"]["shape"][1]], "dtype":source["array"]["dtype"],
            "channel_names":source["channel_names"], "time_unit":source["time_unit"], "time_dtype":source["time_coordinates"]["dtype"]}),
        );
    }
    let mut shape = source["array"]["shape"].clone();
    shape[0] = Value::Null;
    // An omitted unit and an explicit null both mean unknown. Meaningful units
    // (nm, cm-1, ...) remain part of the compatibility contract.
    let units: serde_json::Map<String, Value> = source["axis_units"]
        .as_object()
        .unwrap()
        .iter()
        .filter(|(_, unit)| !unit.is_null())
        .map(|(axis, unit)| (axis.clone(), unit.clone()))
        .collect();
    Ok(
        json!({"name":source_id,"representation_id":source["representation_id"],"axes":source["axes"],"shape":shape,"dtype":source["array"]["dtype"],"feature_names":source["feature_names"],"axis_units":units,"axis_coordinates":source["axis_coordinates"]}),
    )
}

/// Adapt an explicitly selected matrix to IO's existing f32 package IR.
/// Historical one-target regression projection; wider matrix targets use the
/// explicit matrix API so an existing caller never silently changes task type.
pub fn dense_dataset_package(
    value: &Value,
    source_id: &str,
) -> DatasetResult<crate::materialize::DatasetPackage> {
    let normalized = normalize_dataset(value)?;
    let raw = &normalized["dataset"];
    if raw["task_type"] == "classification"
        || (!raw["y"].is_null() && dimensions(&raw["y"]["shape"])?.len() != 1)
    {
        return fail("Dense regression requires one numeric target");
    }
    matrix_dataset_package(value, source_id)
}

/// Complete matrix-source projection with ordered numeric target columns.
/// The existing IO matrix storage is float32; class IDs which would change
/// under that storage are refused before producing a package.
pub fn matrix_dataset_package(
    value: &Value,
    source_id: &str,
) -> DatasetResult<crate::materialize::DatasetPackage> {
    matrix_dataset_package_impl(value, source_id, false)
}

/// Explicit masked projection. Consumers must bind the returned observation
/// mask to native fit/refit/scoring; zero storage at false cells is not truth.
/// Int64 classification matrices retain independent named target columns;
/// consumers must select the corresponding column and mask for each classifier.
pub fn masked_matrix_dataset_package(
    value: &Value,
    source_id: &str,
) -> DatasetResult<(crate::materialize::DatasetPackage, Value)> {
    let mut normalized = normalize_dataset(value)?;
    if !normalized["dataset"]["y"].is_null() {
        let raw = &mut normalized["dataset"];
        let shape = dimensions(&raw["y"]["shape"])?;
        let dtype = raw["y"]["dtype"]
            .as_str()
            .ok_or("Target dtype required")?
            .to_owned();
        let mask = raw["target_mask"]["values"].clone();
        normalize_masked_targets(&mut raw["y"]["values"], &mask, &shape, &dtype)?;
    }
    let mut projection = json!({"sample_ids": normalized["dataset"]["sample_ids"],
        "target_names":normalized["dataset"]["target_names"], "target_mask":normalized["dataset"]["target_mask"]});
    use sha2::{Digest, Sha256};
    projection["mask_content_fingerprint"] = json!(format!(
        "{:x}",
        Sha256::digest(canonical_content_bytes(&projection)?)
    ));
    Ok((
        matrix_dataset_package_impl(&normalized, source_id, true)?,
        projection,
    ))
}

fn matrix_dataset_package_impl(
    value: &Value,
    source_id: &str,
    allow_masked: bool,
) -> DatasetResult<crate::materialize::DatasetPackage> {
    use crate::materialize::{
        AssembledDataset, Cell, Column, DatasetPackage, FoldProvenance, Frame, IdentityProvenance,
        Matrix, PartitionBlock,
    };
    use indexmap::IndexMap;
    let normalized = normalize_dataset(value)?;
    let raw = &normalized["dataset"];
    let source = raw["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == source_id)
        .ok_or("Unknown selected source")?;
    let shape = dimensions(&source["array"]["shape"])?;
    if source["source_kind"] == "ragged_series"
        || shape.len() != 2
        || source["array"]["dtype"] == "object"
        || source["array"]["dtype"].as_str().unwrap().starts_with("<U")
        || source["presence_mask"]["values"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x != true)
    {
        return fail("Dense workflow requires a complete numeric rank-2 source");
    }
    let samples = strings(&raw["sample_ids"], true)?;
    let origins = strings(&normalized["origin_ids"], false)?;
    let partitions = strings(&raw["partitions"]["values"], false)?;
    let group_key = if !raw["groups"].is_null() {
        "group_id"
    } else if raw.get("independent_unit_ids").is_some() {
        "independent_unit_id"
    } else {
        "origin_id"
    };
    let mut assembled = AssembledDataset {
        name: raw["name"].as_str().unwrap().to_owned(),
        task_type: raw["task_type"].as_str().unwrap_or("regression").to_owned(),
        signal_type: "unknown".to_owned(),
        n_sources: 1,
        blocks: IndexMap::new(),
        folds: vec![],
        fold_provenance: vec![],
        repetition: None,
        identity: IdentityProvenance {
            source_ids: vec![source_id.to_owned()],
            sample_id: Some("sample_id".to_owned()),
            observation_id: Some("sample_id".to_owned()),
            group_id: Some(group_key.to_owned()),
            repetition_id: None,
        },
        aggregate: None,
        warnings: vec![],
        audits: vec![
            json!({"source":normalized["schema"],"selected_source":source_id,"numeric_storage":"float32","input_sample_ids":raw["sample_ids"],"raw_source_schema":public_source_schema(&normalized,source_id)?,"target_mask":raw["target_mask"],"target_names":raw["target_names"]}),
        ],
    };
    let y_shape = if raw["y"].is_null() {
        None
    } else {
        Some(dimensions(&raw["y"]["shape"])?)
    };
    fn complete_mask(value: &Value) -> bool {
        value.as_bool().unwrap_or_else(|| {
            value
                .as_array()
                .is_some_and(|rows| rows.iter().all(complete_mask))
        })
    }
    if !allow_masked && !raw["y"].is_null() && !complete_mask(&raw["target_mask"]["values"]) {
        return fail("Matrix projection requires observed targets");
    }
    let target_width = y_shape
        .as_ref()
        .map_or(0, |shape| *shape.get(1).unwrap_or(&1));
    if raw["task_type"] == "classification" {
        if y_shape
            .as_ref()
            .is_some_and(|shape| shape.len() != 1 && !allow_masked)
            || (!raw["y"].is_null() && raw["y"]["dtype"] != "int64")
        {
            return fail("Matrix classification requires one int64 target vector");
        }
        fn labels_exact(value: &Value) -> bool {
            match value {
                Value::Array(values) => values.iter().all(labels_exact),
                _ => value
                    .as_i64()
                    .is_some_and(|label| (label as f32) as f64 == label as f64),
            }
        }
        if !raw["y"].is_null() && !labels_exact(&raw["y"]["values"]) {
            return fail("Classification label exceeds exact float32 IO matrix storage");
        }
    }
    let f32_value = |v: &Value| -> DatasetResult<f32> {
        let x = v.as_f64().ok_or("Finite numeric value required")?;
        let y = x as f32;
        if !y.is_finite() {
            return fail("Value exceeds float32 IO matrix storage");
        }
        Ok(y)
    };
    let headers = source["feature_names"]
        .as_array()
        .map(|v| v.iter().map(|x| x.as_str().unwrap().to_owned()).collect())
        .or_else(|| {
            source["axis_coordinates"]["wavelength"]
                .as_array()
                .map(|v| {
                    v.iter()
                        .map(|x| {
                            x.as_str()
                                .map(str::to_owned)
                                .unwrap_or_else(|| x.to_string())
                        })
                        .collect()
                })
        })
        .unwrap_or_else(|| (0..shape[1]).map(|i| format!("x{i}")).collect::<Vec<_>>());
    for partition in ["train", "test", "predict"] {
        let positions: Vec<usize> = (0..samples.len())
            .filter(|i| partitions[*i] == partition)
            .collect();
        if positions.is_empty() {
            continue;
        }
        let x = positions
            .iter()
            .flat_map(|i| source["array"]["values"][*i].as_array().unwrap())
            .map(f32_value)
            .collect::<Result<Vec<_>, _>>()?;
        let y = if y_shape.is_some() {
            Some(Matrix {
                data: positions
                    .iter()
                    .flat_map(|i| {
                        if y_shape.as_ref().unwrap().len() == 1 {
                            vec![&raw["y"]["values"][*i]]
                        } else {
                            raw["y"]["values"][*i].as_array().unwrap().iter().collect()
                        }
                    })
                    .map(f32_value)
                    .collect::<Result<_, _>>()?,
                n_rows: positions.len(),
                n_cols: target_width,
            })
        } else {
            None
        };
        let mut columns = vec![
            Column::from_cells(
                "sample_id",
                positions
                    .iter()
                    .map(|i| Cell::Str(samples[*i].clone()))
                    .collect(),
            ),
            Column::from_cells(
                "origin_id",
                positions
                    .iter()
                    .map(|i| Cell::Str(origins[*i].clone()))
                    .collect(),
            ),
        ];
        for key in ["groups", "independent_unit_ids"] {
            let values = if key == "groups" {
                raw[key]["values"].as_array()
            } else {
                raw[key].as_array()
            };
            if let Some(v) = values {
                columns.push(Column::from_cells(
                    if key == "groups" {
                        "group_id"
                    } else {
                        "independent_unit_id"
                    },
                    positions
                        .iter()
                        .map(|i| {
                            Cell::Str(
                                v[*i]
                                    .as_str()
                                    .map(str::to_owned)
                                    .unwrap_or_else(|| v[*i].to_string()),
                            )
                        })
                        .collect(),
                ));
            }
        }
        let metadata = Frame::from_columns(columns, "text");
        assembled.blocks.insert(
            partition.to_owned(),
            PartitionBlock {
                n_samples: positions.len(),
                source_ids: vec![source_id.to_owned()],
                x: vec![Matrix {
                    data: x,
                    n_rows: positions.len(),
                    n_cols: shape[1],
                }],
                feature_headers: vec![headers.clone()],
                header_units: vec![source["axis_units"]["wavelength"]
                    .as_str()
                    .unwrap_or("text")
                    .to_owned()],
                signal_types: vec![None],
                processings: vec![vec![]],
                y,
                y_headers: strings(&raw["target_names"], true)?,
                metadata: Some(metadata),
                ..Default::default()
            },
        );
    }
    let train: Vec<usize> = (0..samples.len())
        .filter(|i| partitions[*i] == "train")
        .collect();
    let folds = &normalized["fold_ids"];
    let labels: BTreeSet<String> = train
        .iter()
        .filter_map(|i| folds[*i].as_str().map(str::to_owned))
        .collect();
    if !labels.is_empty() && train.iter().any(|i| folds[*i].is_null()) {
        return fail("Every training row must declare a fold when CV folds are supplied");
    }
    for label in labels {
        let validation: Vec<usize> = train
            .iter()
            .copied()
            .filter(|i| folds[*i] == label)
            .collect();
        let fitting: Vec<usize> = train
            .iter()
            .copied()
            .filter(|i| folds[*i] != label)
            .collect();
        assembled.folds.push((
            train
                .iter()
                .enumerate()
                .filter(|(_, i)| fitting.contains(i))
                .map(|(i, _)| i as i64)
                .collect(),
            train
                .iter()
                .enumerate()
                .filter(|(_, i)| validation.contains(i))
                .map(|(i, _)| i as i64)
                .collect(),
        ));
        assembled.fold_provenance.push(FoldProvenance {
            train_observation_ids: fitting.iter().map(|i| samples[*i].clone()).collect(),
            validation_observation_ids: validation.iter().map(|i| samples[*i].clone()).collect(),
        });
    }
    Ok(DatasetPackage::from_assembled(&assembled))
}

/// Assemble native Methods source projections by identity, never by row order.
/// `presence_encoded` is an explicit producer declaration: missing source rows
/// are refused unless the native recipe encoded their presence. IO adds no
/// values or learned state. The caller must persist and replay this policy.
pub fn projected_matrix_dataset(
    value: &Value,
    projections: &[Value],
) -> DatasetResult<(Value, Value)> {
    use sha2::{Digest, Sha256};
    let mut normalized = normalize_dataset(value)?;
    let raw = &normalized["dataset"];
    let ids = strings(&raw["sample_ids"], true)?;
    let sources = raw["sources"].as_array().unwrap();
    if sources.len() != projections.len() {
        return fail("Projection inventory must match the ordered native source inventory");
    }
    let mut rows = vec![Vec::<Value>::new(); ids.len()];
    let mut features = Vec::new();
    let mut contracts = Vec::new();
    for (source, projection) in sources.iter().zip(projections) {
        closed(
            projection,
            &[
                "source_id",
                "sample_ids",
                "array",
                "feature_names",
                "presence_encoded",
            ],
            &[],
        )?;
        let name = source["name"].as_str().unwrap();
        if projection["source_id"] != name {
            return fail(
                "Projection source order or identity differs from native source inventory",
            );
        }
        let encoded = projection["presence_encoded"]
            .as_bool()
            .ok_or("Projection presence_encoded must be boolean")?;
        if !encoded
            && source["presence_mask"]["values"]
                .as_array()
                .unwrap()
                .iter()
                .any(|present| present != &json!(true))
        {
            return fail("Missing source rows require explicit native presence encoding");
        }
        let projection_ids = strings(&projection["sample_ids"], true)?;
        let shape = array(&projection["array"])?;
        if shape.len() != 2
            || shape[1] == 0
            || shape[0] != ids.len()
            || projection_ids.len() != ids.len()
            || projection_ids.iter().any(|id| !ids.contains(id))
            || !["float32", "float64"].contains(&projection["array"]["dtype"].as_str().unwrap())
        {
            return fail("Native projection requires a complete finite float matrix with exact sample identities");
        }
        let columns = strings(&projection["feature_names"], true)?;
        if columns.len() != shape[1] {
            return fail("Projection feature names differ from matrix width");
        }
        let width = features
            .len()
            .checked_add(columns.len())
            .ok_or("Projected matrix budget exceeded")?;
        if width > 16_777_216
            || ids
                .len()
                .checked_mul(width)
                .is_none_or(|size| size > 16_777_216)
        {
            return fail("Projected matrix budget exceeded");
        }
        features.extend(columns.iter().map(|column| format!("{name}:{column}")));
        let mut projected = projection["array"].clone();
        round_storage(&mut projected);
        for (position, id) in ids.iter().enumerate() {
            let index = projection_ids
                .iter()
                .position(|candidate| candidate == id)
                .unwrap();
            rows[position].extend_from_slice(projected["values"][index].as_array().unwrap());
        }
        contracts.push(json!({"source_id": name, "source_schema": public_source_schema(&normalized,name)?,
            "input_presence_mask": source["presence_mask"], "presence_encoded": encoded,
            "feature_names": columns, "projection_content_fingerprint":format!("{:x}",Sha256::digest(canonical_content_bytes(projection)?))}));
    }
    if features.iter().collect::<BTreeSet<_>>().len() != features.len()
        || ids
            .len()
            .checked_mul(features.len())
            .is_none_or(|size| size > 16_777_216)
    {
        return fail("Projected feature inventory repeats names or exceeds matrix budget");
    }
    let provenance = json!({"schema":"nirs4all.native-source-projections.v1", "sample_ids":ids, "source_projections":contracts,
        "input_content_fingerprint":format!("{:x}",Sha256::digest(dataset_content_bytes(&normalized)?))});
    normalized["schema"] = json!("nirs4all.dataset.v2");
    normalized["schema_version"] = json!(2);
    normalized["dataset"]["source_alignment"] = json!("strict");
    normalized["dataset"]["sources"] = json!([{"name":"native_features","sample_ids":ids,"representation_id":"tabular_numeric",
        "axes":["sample","feature"], "feature_names":features, "axis_units":{}, "axis_coordinates":{},
        "array":{"dtype":"float64","shape":[ids.len(),features.len()],"values":rows},
        "presence_mask":{"dtype":"bool","shape":[ids.len()],"values":vec![true;ids.len()]}}]);
    Ok((normalize_dataset(&normalized)?, provenance))
}
