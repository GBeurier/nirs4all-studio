// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Column selectors (ports `spec/selectors.py`).
//!
//! A selector picks columns within a tabular source. `parse` and `to_spec` are
//! on the byte-golden path (`columns[].select`); `resolve` (0-based indices, in
//! order) is exercised by materialization. `Auto` cannot be resolved — the
//! inference engine replaces it before load.

use std::collections::BTreeSet;

use serde_json::Value;

use super::enums::SpecError;
use crate::pyfmt::{py_repr, py_str_scalar};

/// One of `"numeric" | "string" | "datetime" | "bool"`.
const DTYPE_ALLOWED: [&str; 4] = ["numeric", "string", "datetime", "bool"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selector {
    Positional(Vec<i64>),
    Slice(String),
    Names(Vec<String>),
    NameRange { start: String, end: String },
    Regex(String),
    Dtype(String),
    Rest,
    Auto { candidates: Vec<String> },
}

impl Selector {
    /// The selector kind tag (`positional`/`slice`/`names`/…), as Python's `.kind`.
    pub fn kind(&self) -> &'static str {
        match self {
            Selector::Positional(_) => "positional",
            Selector::Slice(_) => "slice",
            Selector::Names(_) => "names",
            Selector::NameRange { .. } => "name_range",
            Selector::Regex(_) => "regex",
            Selector::Dtype(_) => "dtype",
            Selector::Rest => "rest",
            Selector::Auto { .. } => "auto",
        }
    }

    /// Serialize to the canonical spec form (matches Python `to_spec`).
    pub fn to_spec(&self) -> Value {
        match self {
            Selector::Positional(indices) => {
                if indices.len() == 1 {
                    Value::from(indices[0])
                } else {
                    Value::from(indices.clone())
                }
            }
            Selector::Slice(raw) => Value::from(raw.clone()),
            Selector::Names(names) => Value::from(names.clone()),
            Selector::NameRange { start, end } => {
                serde_json::json!({ "name_range": [start, end] })
            }
            Selector::Regex(pattern) => serde_json::json!({ "regex": pattern }),
            Selector::Dtype(dt) => serde_json::json!({ "dtype": dt }),
            Selector::Rest => Value::from("rest"),
            Selector::Auto { candidates } => {
                if candidates.is_empty() {
                    Value::from("auto")
                } else {
                    serde_json::json!({ "auto": { "candidates": candidates } })
                }
            }
        }
    }

    /// Parse any selector form (matches Python `parse_selector`).
    pub fn parse(value: &Value) -> Result<Selector, SpecError> {
        match value {
            Value::Bool(_) => Err(SpecError::new(format!(
                "selector cannot be a bool: {}",
                py_repr(value)
            ))),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Ok(Selector::Positional(vec![i]))
                } else {
                    Err(unparseable(value))
                }
            }
            Value::String(s) => {
                let low = s.trim().to_lowercase();
                if low == "rest" {
                    Ok(Selector::Rest)
                } else if low == "auto" {
                    Ok(Selector::Auto { candidates: vec![] })
                } else if s.contains(':') {
                    Ok(Selector::Slice(s.clone()))
                } else {
                    Ok(Selector::Names(vec![s.clone()]))
                }
            }
            Value::Array(items) => {
                if items
                    .iter()
                    .all(|v| matches!(v, Value::Number(n) if n.as_i64().is_some()))
                {
                    let ints = items.iter().map(|v| v.as_i64().unwrap()).collect();
                    Ok(Selector::Positional(ints))
                } else if items.iter().all(|v| v.is_string()) {
                    let names = items
                        .iter()
                        .map(|v| v.as_str().unwrap().to_string())
                        .collect();
                    Ok(Selector::Names(names))
                } else {
                    Err(SpecError::new(format!(
                        "list selector must be all ints or all strings: {}",
                        py_repr(value)
                    )))
                }
            }
            Value::Object(map) => Self::parse_dict(map, value),
            Value::Null => Err(unparseable(value)),
        }
    }

    fn parse_dict(
        map: &serde_json::Map<String, Value>,
        value: &Value,
    ) -> Result<Selector, SpecError> {
        if map.len() != 1 {
            return Err(SpecError::new(format!(
                "dict selector must have exactly one key: {}",
                py_repr(value)
            )));
        }
        let (key, payload) = map.iter().next().unwrap();
        let key = key.to_lowercase();
        match key.as_str() {
            "regex" => Ok(Selector::Regex(py_str_scalar(payload))),
            "dtype" => {
                let dt = py_str_scalar(payload).to_lowercase();
                if !DTYPE_ALLOWED.contains(&dt.as_str()) {
                    return Err(SpecError::new(format!(
                        "dtype selector {} must be one of {}",
                        py_repr(&Value::from(dt.clone())),
                        dtype_allowed_repr()
                    )));
                }
                Ok(Selector::Dtype(dt))
            }
            "name_range" => match payload {
                Value::Array(items) if items.len() == 2 => Ok(Selector::NameRange {
                    start: py_str_scalar(&items[0]),
                    end: py_str_scalar(&items[1]),
                }),
                _ => Err(SpecError::new(format!(
                    "name_range must be a 2-element list: {}",
                    py_repr(payload)
                ))),
            },
            "auto" => {
                let candidates = match payload {
                    Value::Object(p) => match p.get("candidates") {
                        Some(Value::Array(cs)) => cs.iter().map(py_str_scalar).collect(),
                        _ => vec![],
                    },
                    _ => vec![],
                };
                Ok(Selector::Auto { candidates })
            }
            other => Err(SpecError::new(format!(
                "unknown selector key {}; expected regex|dtype|name_range|auto",
                py_repr(&Value::from(other))
            ))),
        }
    }

    /// Resolve to 0-based column indices, in order (matches Python `resolve`).
    pub fn resolve(
        &self,
        columns: &[String],
        dtypes: &[String],
        assigned: &BTreeSet<usize>,
    ) -> Result<Vec<usize>, SpecError> {
        let n = columns.len();
        match self {
            Selector::Positional(indices) => {
                let mut out = Vec::with_capacity(indices.len());
                for &idx in indices {
                    let real = if idx >= 0 { idx } else { n as i64 + idx };
                    if real < 0 || real >= n as i64 {
                        return Err(SpecError::new(format!(
                            "column index {idx} out of range for {n} columns"
                        )));
                    }
                    out.push(real as usize);
                }
                Ok(out)
            }
            Selector::Slice(raw) => {
                let parts: Vec<&str> = raw.split(':').collect();
                if parts.len() != 2 && parts.len() != 3 {
                    return Err(SpecError::new(format!(
                        "slice {} must be 'start:stop' or 'start:stop:step'",
                        py_repr(&Value::from(raw.clone()))
                    )));
                }
                let mut bounds: Vec<Option<i64>> = Vec::with_capacity(parts.len());
                for p in &parts {
                    if p.trim().is_empty() {
                        bounds.push(None);
                    } else {
                        match p.parse::<i64>() {
                            Ok(v) => bounds.push(Some(v)),
                            Err(_) => {
                                return Err(SpecError::new(format!(
                                    "slice {} has non-integer bounds",
                                    py_repr(&Value::from(raw.clone()))
                                )))
                            }
                        }
                    }
                }
                let step = bounds.get(2).copied().flatten();
                Ok(py_slice_indices(n as i64, bounds[0], bounds[1], step))
            }
            Selector::Names(names) => {
                let mut pos = std::collections::HashMap::new();
                for (i, name) in columns.iter().enumerate() {
                    pos.entry(name.clone()).or_insert(i);
                }
                let mut out = Vec::with_capacity(names.len());
                for name in names {
                    match pos.get(name) {
                        Some(&i) => out.push(i),
                        None => {
                            return Err(SpecError::new(format!(
                                "column name {} not found; available: {}",
                                py_repr(&Value::from(name.clone())),
                                py_repr(&Value::from(columns.to_vec()))
                            )))
                        }
                    }
                }
                Ok(out)
            }
            Selector::NameRange { start, end } => {
                let lo = columns.iter().position(|c| c == start);
                let hi = columns.iter().position(|c| c == end);
                match (lo, hi) {
                    (Some(mut lo), Some(mut hi)) => {
                        if lo > hi {
                            std::mem::swap(&mut lo, &mut hi);
                        }
                        Ok((lo..=hi).collect())
                    }
                    _ => Err(SpecError::new(format!(
                        "name_range endpoints {}/{} not both present",
                        py_repr(&Value::from(start.clone())),
                        py_repr(&Value::from(end.clone()))
                    ))),
                }
            }
            Selector::Regex(pattern) => {
                let rx = regex::Regex::new(pattern)
                    .map_err(|e| SpecError::new(format!("invalid regex {pattern:?}: {e}")))?;
                Ok(columns
                    .iter()
                    .enumerate()
                    .filter(|(_, name)| rx.is_match(name))
                    .map(|(i, _)| i)
                    .collect())
            }
            Selector::Dtype(dt) => Ok(dtypes
                .iter()
                .enumerate()
                .filter(|(_, d)| *d == dt)
                .map(|(i, _)| i)
                .collect()),
            Selector::Rest => Ok((0..n).filter(|i| !assigned.contains(i)).collect()),
            Selector::Auto { .. } => Err(SpecError::new(
                "an 'auto' selector must be resolved by the inference engine before load",
            )),
        }
    }
}

fn dtype_allowed_repr() -> String {
    // Python tuple repr: ('numeric', 'string', 'datetime', 'bool')
    let inner: Vec<String> = DTYPE_ALLOWED
        .iter()
        .map(|d| crate::pyfmt::py_repr_str(d))
        .collect();
    format!("({})", inner.join(", "))
}

fn unparseable(value: &Value) -> SpecError {
    let type_name = match value {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Number(n) => {
            if n.is_f64() {
                "float"
            } else {
                "int"
            }
        }
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
    };
    SpecError::new(format!(
        "cannot parse selector from {type_name}: {}",
        py_repr(value)
    ))
}

/// CPython slice semantics over `list(range(length))[start:stop:step]`.
fn py_slice_indices(
    length: i64,
    start: Option<i64>,
    stop: Option<i64>,
    step: Option<i64>,
) -> Vec<usize> {
    let step = step.unwrap_or(1);
    if step == 0 {
        return Vec::new(); // Python raises ValueError; selectors never pass step 0 in practice
    }
    let neg = step < 0;
    let clamp_start = |s: i64| -> i64 {
        let mut s = s;
        if s < 0 {
            s += length;
            if s < 0 {
                s = if neg { -1 } else { 0 };
            }
        } else if s >= length {
            s = if neg { length - 1 } else { length };
        }
        s
    };
    let clamp_stop = clamp_start;
    let start = match start {
        None => {
            if neg {
                length - 1
            } else {
                0
            }
        }
        Some(s) => clamp_start(s),
    };
    let stop = match stop {
        None => {
            if neg {
                -1
            } else {
                length
            }
        }
        Some(s) => clamp_stop(s),
    };
    let mut out = Vec::new();
    let mut i = start;
    if step > 0 {
        while i < stop {
            out.push(i as usize);
            i += step;
        }
    } else {
        while i > stop {
            out.push(i as usize);
            i += step;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cols(n: usize) -> Vec<String> {
        (0..n).map(|i| i.to_string()).collect()
    }

    #[test]
    fn parse_and_to_spec_roundtrip() {
        assert_eq!(Selector::parse(&json!(-1)).unwrap().to_spec(), json!(-1));
        assert_eq!(
            Selector::parse(&json!([0, 1])).unwrap().to_spec(),
            json!([0, 1])
        );
        assert_eq!(
            Selector::parse(&json!("2:-1")).unwrap().to_spec(),
            json!("2:-1")
        );
        assert_eq!(
            Selector::parse(&json!(["a", "b"])).unwrap().to_spec(),
            json!(["a", "b"])
        );
        assert_eq!(
            Selector::parse(&json!({"regex": "^\\d+$"}))
                .unwrap()
                .to_spec(),
            json!({"regex": "^\\d+$"})
        );
        assert_eq!(
            Selector::parse(&json!({"name_range": ["400", "2500"]}))
                .unwrap()
                .to_spec(),
            json!({"name_range": ["400", "2500"]})
        );
        assert_eq!(Selector::parse(&json!("rest")).unwrap(), Selector::Rest);
        assert_eq!(
            Selector::parse(&json!("auto")).unwrap(),
            Selector::Auto { candidates: vec![] }
        );
        // bare string -> single name
        assert_eq!(
            Selector::parse(&json!("protein")).unwrap(),
            Selector::Names(vec!["protein".into()])
        );
    }

    #[test]
    fn parse_errors() {
        assert!(Selector::parse(&json!(true)).is_err());
        assert!(Selector::parse(&json!([1, "a"])).is_err());
        assert!(Selector::parse(&json!({"a": 1, "b": 2})).is_err());
        assert!(Selector::parse(&json!({"dtype": "weird"})).is_err());
    }

    #[test]
    fn resolve_positional_and_slice() {
        let c = cols(6);
        let empty = BTreeSet::new();
        assert_eq!(
            Selector::Positional(vec![-1])
                .resolve(&c, &[], &empty)
                .unwrap(),
            vec![5]
        );
        assert_eq!(
            Selector::Slice("0:6".into())
                .resolve(&c, &[], &empty)
                .unwrap(),
            vec![0, 1, 2, 3, 4, 5]
        );
        assert_eq!(
            Selector::Slice("2:-1".into())
                .resolve(&c, &[], &empty)
                .unwrap(),
            vec![2, 3, 4]
        );
        assert_eq!(
            Selector::Slice("::2".into())
                .resolve(&c, &[], &empty)
                .unwrap(),
            vec![0, 2, 4]
        );
    }

    #[test]
    fn resolve_rest_and_names() {
        let c = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut assigned = BTreeSet::new();
        assigned.insert(0);
        assert_eq!(
            Selector::Rest.resolve(&c, &[], &assigned).unwrap(),
            vec![1, 2]
        );
        assert_eq!(
            Selector::Names(vec!["c".into(), "a".into()])
                .resolve(&c, &[], &assigned)
                .unwrap(),
            vec![2, 0]
        );
    }
}
