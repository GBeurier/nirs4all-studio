// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Neutral file description + axis detection (ports `infer/describe.py`).
//!
//! `describe_text` reports neutral, context-free evidence about a delimited
//! text file (delimiter/decimal/header candidates, shape, wavelength-axis
//! verdict). Pure: the facade reads bytes → UTF-8 (lossy) → `describe_text`.
//! It deliberately does NOT assign dataset roles or infer signal type.

use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::{Regex, RegexBuilder};

use crate::pyfmt::{nanmean, nanstd};

const DELIMITERS: [char; 5] = [',', ';', '\t', '|', ' '];

struct HeaderPatterns {
    nm: Vec<Regex>,
    cm1: Vec<Regex>,
    text: Vec<Regex>,
    index: Vec<Regex>,
}

static HEADER_PATTERNS: LazyLock<HeaderPatterns> = LazyLock::new(|| {
    // Python matches these with re.IGNORECASE.
    let c = |p: &str| RegexBuilder::new(p).case_insensitive(true).build().unwrap();
    HeaderPatterns {
        nm: vec![c(r"^\d{3,4}(?:\.\d+)?$"), c(r"^\d{3,4}(?:\.\d+)?nm$")],
        cm1: vec![
            c(r"^\d{4,5}(?:\.\d+)?$"),
            c(r"^\d{4,5}(?:\.\d+)?cm-1$"),
            c(r"^\d{4,5}(?:\.\d+)?wavenumber$"),
        ],
        text: vec![c(r"^[a-zA-Z]"), c(r"^feature_\d+$"), c(r"^[xX]_?\d+$")],
        index: vec![c(r"^\d{1,3}$")],
    }
});

/// Neutral structural evidence about a delimited text file.
#[derive(Debug, Clone, PartialEq)]
pub struct FileDescription {
    pub delimiter: char,
    pub decimal_separator: char,
    pub has_header: bool,
    pub header_unit: String,
    pub n_rows: usize,
    pub n_cols: usize,
    pub is_wavelength_header: bool,
    pub axis_range: Option<(f64, f64)>,
    pub confidence: IndexMap<String, f64>,
    pub column_names: Vec<String>,
}

impl Default for FileDescription {
    fn default() -> Self {
        Self {
            delimiter: ';',
            decimal_separator: '.',
            has_header: true,
            header_unit: "text".to_string(),
            n_rows: 0,
            n_cols: 0,
            is_wavelength_header: false,
            axis_range: None,
            confidence: IndexMap::new(),
            column_names: vec![],
        }
    }
}

fn is_numeric(value: &str, decimal_sep: char) -> bool {
    let value = value.trim();
    if value.is_empty() {
        return false;
    }
    let normalized = if value.to_lowercase().contains('e') {
        value.replace(decimal_sep, ".")
    } else if decimal_sep == ',' {
        value.replace(',', ".")
    } else {
        value.to_string()
    };
    normalized.parse::<f64>().is_ok()
}

/// Parse `text` into rows via the csv crate with a given delimiter; `Err` on a
/// csv error (mirrors Python's `except csv.Error`).
fn csv_rows(text: &str, delim: char) -> Result<Vec<Vec<String>>, ()> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delim as u8)
        .from_reader(text.as_bytes());
    let mut rows = Vec::new();
    for rec in rdr.records() {
        match rec {
            Ok(r) => rows.push(r.iter().map(str::to_string).collect()),
            Err(_) => return Err(()),
        }
    }
    Ok(rows)
}

fn score_delimiter(lines: &[String], delim: char) -> f64 {
    let joined = lines.join("\n");
    let Ok(rows) = csv_rows(&joined, delim) else {
        return 0.0;
    };
    let counts: Vec<usize> = rows
        .iter()
        .filter(|r| !r.is_empty())
        .map(|r| r.len())
        .collect();
    if counts.is_empty() {
        return 0.0;
    }
    // Counter.most_common(1): max frequency, first-inserted count on tie.
    let mut tally: IndexMap<usize, usize> = IndexMap::new();
    for &c in &counts {
        *tally.entry(c).or_insert(0) += 1;
    }
    let (most_common_count, freq) =
        tally.iter().fold(
            (0usize, 0usize),
            |acc, (&count, &f)| if f > acc.1 { (count, f) } else { acc },
        );
    if most_common_count == 1 {
        return 0.1;
    }
    let consistency = freq as f64 / counts.len() as f64;
    consistency * 5.0 + (most_common_count as f64 / 10.0).min(5.0)
}

fn detect_delimiter(lines: &[String]) -> (char, f64) {
    let mut best = ';';
    let mut score = 0.0;
    for &delim in &DELIMITERS {
        let s = score_delimiter(lines, delim);
        if s > score {
            best = delim;
            score = s;
        }
    }
    (best, (score / 10.0).min(1.0))
}

fn detect_decimal(rows: &[Vec<String>]) -> (char, f64) {
    let (mut dot_count, mut dot_valid, mut comma_count, mut comma_valid) = (0i64, 0i64, 0i64, 0i64);
    for row in rows.iter().skip(1) {
        for cell in row {
            let cell = cell.trim();
            if cell.contains('.') && !cell.contains(',') {
                dot_count += 1;
                dot_valid += is_numeric(cell, '.') as i64;
            } else if cell.contains(',') && !cell.contains('.') {
                comma_count += 1;
                comma_valid += is_numeric(&cell.replace(',', "."), '.') as i64;
            }
        }
    }
    if dot_valid >= comma_valid {
        let conf = ((dot_valid + 1) as f64 / (dot_count.max(1) + comma_count + 1) as f64).min(1.0);
        ('.', conf)
    } else {
        let conf =
            ((comma_valid + 1) as f64 / (comma_count.max(1) + dot_count + 1) as f64).min(1.0);
        (',', conf)
    }
}

fn detect_header(rows: &[Vec<String>], decimal_sep: char) -> (bool, f64) {
    if rows.len() < 2 {
        return (true, 0.5);
    }
    let first = &rows[0];
    let upper = rows.len().min(10);
    let data_rows = &rows[1..upper];
    let first_ratio = if first.is_empty() {
        0.0
    } else {
        first.iter().filter(|c| is_numeric(c, decimal_sep)).count() as f64 / first.len() as f64
    };
    let ratios: Vec<f64> = data_rows
        .iter()
        .filter(|r| !r.is_empty())
        .map(|r| r.iter().filter(|c| is_numeric(c, decimal_sep)).count() as f64 / r.len() as f64)
        .collect();
    if ratios.is_empty() {
        return (true, 0.5);
    }
    let avg = nanmean(&ratios).unwrap();
    if first_ratio < avg - 0.3 {
        return (true, ((avg - first_ratio) * 2.0).min(1.0));
    }
    if first_ratio > 0.9 && first.len() >= 10 {
        let (is_wl, conf) = detect_wavelength_header(first, data_rows, decimal_sep);
        if is_wl {
            return (true, conf);
        }
    }
    if (first_ratio - avg).abs() < 0.1 {
        return (false, 0.7);
    }
    (true, 0.5)
}

/// Numeric monotonic spectral axis (heuristic C). Rejects CV > 0.5.
pub fn detect_wavelength_header(
    first_row: &[String],
    _data_rows: &[Vec<String>],
    decimal_sep: char,
) -> (bool, f64) {
    let values: Result<Vec<f64>, _> = first_row
        .iter()
        .map(|c| c.trim().replace(decimal_sep, ".").parse::<f64>())
        .collect();
    let Ok(values) = values else {
        return (false, 0.0);
    };
    if values.len() < 10 {
        return (false, 0.0);
    }
    let diffs: Vec<f64> = values.windows(2).map(|w| w[1] - w[0]).collect();
    let all_pos = diffs.iter().all(|&d| d > 0.0);
    let all_neg = diffs.iter().all(|&d| d < 0.0);
    if !(all_pos || all_neg) {
        return (false, 0.0);
    }
    let lo = values.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let is_nm = (200.0..=2600.0).contains(&lo) && (350.0..=2600.0).contains(&hi);
    let is_cm1 = (400.0..=15000.0).contains(&lo) && (1000.0..=15000.0).contains(&hi);
    if !(is_nm || is_cm1) {
        return (false, 0.0);
    }
    let abs_diffs: Vec<f64> = diffs.iter().map(|d| d.abs()).collect();
    let mean = nanmean(&abs_diffs).unwrap();
    let cv = if mean > 0.0 {
        nanstd(&abs_diffs).unwrap() / mean
    } else {
        1.0
    };
    if cv > 0.5 {
        return (false, 0.0);
    }
    (true, 0.85)
}

/// Detect the header unit (`nm`/`cm-1`/`text`/`index`) with a confidence.
pub fn detect_header_unit(header_row: &[String]) -> (String, f64) {
    let units = ["nm", "cm-1", "text", "index"];
    let patterns = &*HEADER_PATTERNS;
    let pats_for = |u: &str| -> &[Regex] {
        match u {
            "nm" => &patterns.nm,
            "cm-1" => &patterns.cm1,
            "text" => &patterns.text,
            _ => &patterns.index,
        }
    };
    let mut scores: IndexMap<&str, i64> = units.iter().map(|u| (*u, 0)).collect();
    for cell in header_row {
        let cell = cell.trim();
        if cell.is_empty() {
            continue;
        }
        for unit in units {
            if pats_for(unit).iter().any(|p| p.is_match(cell)) {
                *scores.get_mut(unit).unwrap() += 1;
                break;
            }
        }
    }
    let total: i64 = scores.values().sum();
    if total == 0 {
        return ("text".to_string(), 0.5);
    }
    let best = scores
        .iter()
        .fold(
            ("nm", -1i64),
            |acc, (&u, &s)| if s > acc.1 { (u, s) } else { acc },
        )
        .0;
    if best == "nm" || best == "cm-1" {
        let vals: Result<Vec<f64>, _> = header_row
            .iter()
            .filter(|c| !c.trim().is_empty())
            .map(|c| c.trim().parse::<f64>())
            .collect();
        if let Ok(vals) = vals {
            if !vals.is_empty() {
                let lo = vals.iter().copied().fold(f64::INFINITY, f64::min);
                let hi = vals.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                if (350.0..=2500.0).contains(&lo) && hi <= 2500.0 {
                    return ("nm".to_string(), 0.8);
                }
                if (400.0..=12500.0).contains(&lo) && hi <= 12500.0 && lo > 2500.0 {
                    return ("cm-1".to_string(), 0.8);
                }
            }
        }
    }
    (best.to_string(), scores[best] as f64 / total as f64)
}

/// Describe delimited text (neutral structural evidence). `sample_lines` caps
/// the lines inspected (Python default 50).
pub fn describe_text(text: &str, sample_lines: usize) -> FileDescription {
    let lines: Vec<String> = text
        .split('\n')
        .take(sample_lines)
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let mut desc = FileDescription::default();
    if lines.is_empty() {
        return desc;
    }
    let (delim, dconf) = detect_delimiter(&lines);
    desc.delimiter = delim;
    let joined = lines.join("\n");
    let rows: Vec<Vec<String>> = match csv_rows(&joined, delim) {
        Ok(rs) => rs
            .into_iter()
            .filter(|r| r.iter().any(|c| !c.trim().is_empty()))
            .collect(),
        Err(_) => return desc,
    };
    if rows.is_empty() {
        return desc;
    }
    desc.n_cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    desc.n_rows = rows.len();
    let (decimal, decconf) = detect_decimal(&rows);
    desc.decimal_separator = decimal;
    let (has_header, hconf) = detect_header(&rows, decimal);
    desc.has_header = has_header;
    if has_header {
        desc.column_names = rows[0].iter().map(|c| c.trim().to_string()).collect();
        let upper = rows.len().min(6);
        let (is_wl, _) = if rows[0].len() >= 10 {
            detect_wavelength_header(&rows[0], &rows[1..upper], decimal)
        } else {
            (false, 0.0)
        };
        desc.is_wavelength_header = is_wl;
        let (header_unit, uconf) = detect_header_unit(&rows[0]);
        desc.header_unit = header_unit;
        if is_wl {
            let vals: Result<Vec<f64>, _> = rows[0]
                .iter()
                .map(|c| c.trim().replace(decimal, ".").parse::<f64>())
                .collect();
            if let Ok(vals) = vals {
                let lo = vals.iter().copied().fold(f64::INFINITY, f64::min);
                let hi = vals.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                desc.axis_range = Some((lo, hi));
            }
        }
        desc.confidence.insert("header_unit".to_string(), uconf);
    }
    desc.confidence.insert("delimiter".to_string(), dconf);
    desc.confidence
        .insert("decimal_separator".to_string(), decconf);
    desc.confidence.insert("has_header".to_string(), hconf);
    desc
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn describe_combined_no_header_boundary() {
        // data.csv: 12 wl headers + protein -> describe verdict has_header=false.
        let mut text =
            String::from("1000;1005;1010;1015;1020;1025;1030;1035;1040;1045;1050;1055;protein\n");
        for y in ["12.5", "8.3", "15.1", "9.7", "11.2", "13.8"] {
            text.push_str("0.40;0.40;0.40;0.40;0.40;0.40;1.30;1.30;1.30;1.30;1.30;1.30;");
            text.push_str(y);
            text.push('\n');
        }
        let d = describe_text(&text, 50);
        assert_eq!(d.delimiter, ';');
        assert!(!d.has_header);
        assert_eq!(d.header_unit, "text");
        assert!(!d.is_wavelength_header);
        assert_eq!(d.n_cols, 13);
        assert!(approx(d.confidence["delimiter"], 0.63));
        assert!(approx(d.confidence["has_header"], 0.7));
        assert!(!d.confidence.contains_key("header_unit"));
    }

    #[test]
    fn describe_pure_spectra_header() {
        let mut text =
            String::from("1000;1005;1010;1015;1020;1025;1030;1035;1040;1045;1050;1055\n");
        for _ in 0..6 {
            text.push_str("0.40;0.40;0.40;0.40;0.40;0.40;1.30;1.30;1.30;1.30;1.30;1.30\n");
        }
        let d = describe_text(&text, 50);
        assert!(d.has_header);
        assert_eq!(d.header_unit, "nm");
        assert!(d.is_wavelength_header);
        assert_eq!(d.axis_range, Some((1000.0, 1055.0)));
        assert!(approx(d.confidence["header_unit"], 0.8));
        assert!(approx(d.confidence["delimiter"], 0.62));
        assert!(approx(d.confidence["has_header"], 0.85));
    }

    #[test]
    fn describe_single_column_comma_default() {
        let d = describe_text("y\n12.5\n8.3\n15.1\n9.7\n11.2\n13.8\n", 50);
        assert_eq!(d.delimiter, ',');
        assert!(d.has_header);
        assert_eq!(d.n_cols, 1);
        assert!(approx(d.confidence["delimiter"], 0.01));
        assert!(approx(d.confidence["has_header"], 1.0));
    }

    #[test]
    fn header_unit_case_insensitive() {
        // Python uses re.IGNORECASE: uppercase unit suffixes still detect nm/cm-1.
        let nm: Vec<String> = (0..12).map(|i| format!("{}NM", 1000 + i * 5)).collect();
        let (u, _) = detect_header_unit(&nm);
        assert_eq!(u, "nm");
    }
}
