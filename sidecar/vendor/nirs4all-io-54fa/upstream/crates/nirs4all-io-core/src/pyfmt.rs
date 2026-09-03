// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! CPython / numpy faithful numeric & string formatting kernels.
//!
//! Trap #1 of the port (see `docs/dev/PORT_BLUEPRINT.md`): every score, evidence
//! string, and rounded value in the IR passes through one of these. A single
//! half-tie or last-ULP disagreement with CPython/numpy flips a golden byte.
//! Each kernel is golden-tested against recorded CPython/numpy oracle values.
//!
//! Float-domain note: the IR only emits finite values in normal range (scores in
//! `[0, 1]`, wavelengths up to ~25000), so exponent-notation regimes never occur
//! (see `canonical_json` docs).

/// CPython `round(x, ndigits)` (round-half-to-even on the true decimal value).
///
/// CPython rounds the exact decimal expansion of the `f64` half-to-even, then
/// returns the nearest `f64` to that decimal. Rust's `{:.N}` formatting is
/// likewise correctly-rounded half-to-even, so formatting to `ndigits` places
/// and parsing back reproduces CPython exactly. Never use `f64::round` (it is
/// half-away-from-zero and ignores `ndigits`). Validated by `round_matches_cpython`.
pub fn py_round(x: f64, ndigits: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    format!("{x:.ndigits$}")
        .parse::<f64>()
        .expect("formatted finite float parses")
}

/// Python `str(float)` / `repr(float)`: shortest round-trip, with a forced `.0`
/// on integral values (Rust `Display` omits it). `nan`/`inf`/`-inf` lower-case.
pub fn py_float_repr(x: f64) -> String {
    if x.is_nan() {
        return "nan".to_string();
    }
    if x.is_infinite() {
        return if x < 0.0 { "-inf" } else { "inf" }.to_string();
    }
    let s = format!("{x}");
    if s.contains(['.', 'e', 'E']) {
        s
    } else {
        format!("{s}.0")
    }
}

/// Python `f"{x:.3f}"` (fixed 3 decimals, half-even), with CPython's `nan`/`inf`
/// spelling (Rust would emit `NaN`/`inf`).
pub fn py_fmt_f3(x: f64) -> String {
    if x.is_nan() {
        return "nan".to_string();
    }
    if x.is_infinite() {
        return if x < 0.0 { "-inf" } else { "inf" }.to_string();
    }
    format!("{x:.3}")
}

/// Python `f"{x:.0%}"` = `format(x*100, ".0f") + "%"` (multiply the *unrounded*
/// value first, then fixed 0-decimal half-even).
pub fn py_pct0(x: f64) -> String {
    if x.is_nan() {
        return "nan%".to_string();
    }
    if x.is_infinite() {
        return if x < 0.0 { "-inf%" } else { "inf%" }.to_string();
    }
    format!("{:.0}%", x * 100.0)
}

/// Python `repr(str)`: single-quoted unless the string contains `'` and no `"`,
/// with `\\`, the quote, and `\n`/`\r`/`\t` / control chars escaped. Faithful for
/// printable text (the spec/field domain); used in `SpecError`/warning messages.
pub fn py_repr_str(s: &str) -> String {
    let quote = if s.contains('\'') && !s.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::with_capacity(s.len() + 2);
    out.push(quote);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c if (c as u32) < 0x20 || (c as u32) == 0x7f => {
                out.push_str(&format!("\\x{:02x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// Python `str(value)` for a scalar/container: `str(int)`/`str(float)` (forced
/// `.0`), the string itself, `True`/`False`/`None`; containers fall back to
/// `repr` (Python `str(list)` == `repr(list)`).
pub fn py_str_scalar(value: &serde_json::Value) -> String {
    use serde_json::Value;
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "None".to_string(),
        Value::Bool(b) => if *b { "True" } else { "False" }.to_string(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else {
                py_float_repr(n.as_f64().expect("json number is f64"))
            }
        }
        Value::Array(_) | Value::Object(_) => py_repr(value),
    }
}

/// Python `repr(value)` for a JSON value: `None`/`True`/`False`, `repr(str)`,
/// `str(int)`/`str(float)`, and recursive list/dict reprs (single-quoted keys).
pub fn py_repr(value: &serde_json::Value) -> String {
    use serde_json::Value;
    match value {
        Value::Null => "None".to_string(),
        Value::Bool(b) => if *b { "True" } else { "False" }.to_string(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else {
                py_float_repr(n.as_f64().expect("json number is f64"))
            }
        }
        Value::String(s) => py_repr_str(s),
        Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(py_repr).collect();
            format!("[{}]", inner.join(", "))
        }
        Value::Object(map) => {
            let inner: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("{}: {}", py_repr_str(k), py_repr(v)))
                .collect();
            format!("{{{}}}", inner.join(", "))
        }
    }
}

/// Python `int(value)` coercion for a JSON value: ints as-is, floats truncated
/// toward zero, integer strings parsed, `True`/`False` → `1`/`0`. Returns `None`
/// for values Python `int()` would reject (non-integer strings, null, containers).
pub fn py_int(value: &serde_json::Value) -> Option<i64> {
    use serde_json::Value;
    match value {
        Value::Bool(b) => Some(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(i)
            } else if let Some(u) = n.as_u64() {
                i64::try_from(u).ok()
            } else {
                n.as_f64().map(|f| f.trunc() as i64)
            }
        }
        Value::String(s) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// Python `bool(value)` truthiness for a JSON value: `false`/`0`/`0.0`/`""`/
/// `[]`/`{}`/`null` are falsy; everything else (incl. non-empty strings like
/// `"false"`) is truthy.
pub fn py_truthy(value: &serde_json::Value) -> bool {
    use serde_json::Value;
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// numpy `nanmin` over the finite values (NaN skipped). Returns `None` if all NaN.
pub fn nanmin(xs: &[f64]) -> Option<f64> {
    xs.iter().copied().filter(|v| !v.is_nan()).reduce(f64::min)
}

/// numpy `nanmax` over the finite values (NaN skipped). Returns `None` if all NaN.
pub fn nanmax(xs: &[f64]) -> Option<f64> {
    xs.iter().copied().filter(|v| !v.is_nan()).reduce(f64::max)
}

/// numpy `nanmean` over the finite values (NaN skipped). Returns `None` if all NaN.
///
/// Uses a straight accumulation. This is bit-identical to numpy for the
/// deterministic contract corpus; numpy's block-128 pairwise summation only
/// diverges in the last ULP on very wide (>128-element) arrays, where the result
/// is consumed solely through `py_fmt_f3` (3 decimals) — a hardening item tracked
/// for when a wide-array golden is added.
pub fn nanmean(xs: &[f64]) -> Option<f64> {
    let mut sum = 0.0;
    let mut count = 0usize;
    for &v in xs {
        if !v.is_nan() {
            sum += v;
            count += 1;
        }
    }
    if count == 0 {
        None
    } else {
        Some(sum / count as f64)
    }
}

/// numpy `nanstd` (population std, `ddof=0`) over the finite values. `None` if all NaN.
pub fn nanstd(xs: &[f64]) -> Option<f64> {
    let mean = nanmean(xs)?;
    let mut sq = 0.0;
    let mut count = 0usize;
    for &v in xs {
        if !v.is_nan() {
            let d = v - mean;
            sq += d * d;
            count += 1;
        }
    }
    Some((sq / count as f64).sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_cpython() {
        // Oracle: CPython round(x, n) for tie/edge values (see pyfmt port notes).
        let r3 = |x: f64| py_round(x, 3);
        let r2 = |x: f64| py_round(x, 2);
        assert_eq!(r3(2.675), 2.675);
        assert_eq!(r3(0.0625), 0.062); // half-even down
        assert_eq!(r3(0.0635), 0.064); // half-even up
        assert_eq!(r3(1.005), 1.005);
        assert_eq!(r2(1.005), 1.0); // 1.005 is < 1.005 in f64
        assert_eq!(r3(0.1234), 0.123);
        assert_eq!(r3(0.1235), 0.123); // f64(0.1235) < 0.1235
        assert_eq!(r3(0.1245), 0.124);
        assert_eq!(r3(0.8565), 0.857);
        assert_eq!(r3(0.857142857), 0.857);
        assert_eq!(r3(100.0 / 3.0), 33.333);
        assert_eq!(r3(2.0 / 3.0), 0.667);
        assert_eq!(r2(0.8565), 0.86);
        assert_eq!(r2(2.0 / 3.0), 0.67);
        assert_eq!(r3(0.0), 0.0);
        assert_eq!(r3(-3.5), -3.5);
    }

    #[test]
    fn float_repr_matches_python_str() {
        assert_eq!(py_float_repr(1.0), "1.0");
        assert_eq!(py_float_repr(0.0), "0.0");
        assert_eq!(py_float_repr(-0.0), "-0.0");
        assert_eq!(py_float_repr(100.0), "100.0");
        assert_eq!(py_float_repr(2500.0), "2500.0");
        assert_eq!(py_float_repr(0.1), "0.1");
        assert_eq!(py_float_repr(1.67), "1.67");
        assert_eq!(py_float_repr(0.857), "0.857");
        assert_eq!(py_float_repr(2.0), "2.0");
        assert_eq!(py_float_repr(1.5), "1.5");
    }

    #[test]
    fn fmt_f3_and_pct0_match_python() {
        assert_eq!(py_fmt_f3(0.4), "0.400");
        assert_eq!(py_fmt_f3(1.3), "1.300");
        assert_eq!(py_fmt_f3(0.85), "0.850");
        assert_eq!(py_fmt_f3(0.857142857), "0.857");
        assert_eq!(py_fmt_f3(1.0), "1.000");
        assert_eq!(py_fmt_f3(0.999999), "1.000");
        assert_eq!(py_pct0(1.0), "100%");
        assert_eq!(py_pct0(1.3), "130%");
        assert_eq!(py_pct0(0.857142857), "86%");
        assert_eq!(py_pct0(0.0), "0%");
        assert_eq!(py_pct0(0.5), "50%");
    }

    #[test]
    fn stats_match_numpy_on_corpus_block() {
        // 72-element block: 36 x 0.40, 36 x 1.30 (the contract corpus feature block).
        let mut block = vec![0.40_f64; 36];
        block.extend(vec![1.30_f64; 36]);
        assert_eq!(nanmin(&block), Some(0.4));
        assert_eq!(nanmax(&block), Some(1.3));
        // numpy reports mean = 0.8500000000000001; :.3f -> "0.850" either way.
        assert_eq!(py_fmt_f3(nanmean(&block).unwrap()), "0.850");
        assert_eq!(py_fmt_f3(nanstd(&block).unwrap()), "0.450");
    }

    #[test]
    fn nan_handling() {
        assert_eq!(nanmin(&[f64::NAN, 1.0, f64::NAN, 0.5]), Some(0.5));
        assert_eq!(nanmean(&[f64::NAN]), None);
        assert_eq!(py_fmt_f3(f64::NAN), "nan");
        assert_eq!(py_pct0(f64::NAN), "nan%");
    }

    #[test]
    fn py_int_matches_cpython_int() {
        use serde_json::json;
        assert_eq!(py_int(&json!(2)), Some(2));
        assert_eq!(py_int(&json!(2.7)), Some(2)); // trunc toward zero
        assert_eq!(py_int(&json!(-2.7)), Some(-2));
        assert_eq!(py_int(&json!("2")), Some(2));
        assert_eq!(py_int(&json!(true)), Some(1));
        assert_eq!(py_int(&json!(false)), Some(0));
        assert_eq!(py_int(&json!("2.5")), None); // int("2.5") raises
        assert_eq!(py_int(&json!(null)), None);
        assert_eq!(py_int(&json!([1])), None);
    }
}
