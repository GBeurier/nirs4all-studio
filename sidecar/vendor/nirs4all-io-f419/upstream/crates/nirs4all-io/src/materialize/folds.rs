// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Fold-file reading — the facade's filesystem entry.
//!
//! The pure parser (`parse_fold_str`) moved into `nirs4all-io-core`. This module
//! keeps only the IO side: existence check, read, and extension→format inference,
//! then delegates to the shared core parser. `Fold` is re-exported.

use std::path::Path;

use nirs4all_io_core::materialize::folds::parse_fold_str;
use nirs4all_io_core::spec::SpecError;

pub use nirs4all_io_core::materialize::folds::Fold;

fn ext_format(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("csv") => "csv",
        Some("json") => "json",
        Some("yaml") | Some("yml") => "yaml",
        Some("txt") => "txt",
        _ => "",
    }
}

/// Parse a fold file (`fmt` `"auto"` infers from the extension).
pub fn parse_fold_file(path: &Path, fmt: &str) -> Result<Vec<Fold>, SpecError> {
    if !path.exists() {
        return Err(SpecError::new(format!(
            "fold file not found: {}",
            path.display()
        )));
    }
    let fmt = if fmt.is_empty() || fmt == "auto" {
        let f = ext_format(path);
        if f.is_empty() {
            return Err(SpecError::new(format!(
                "cannot infer fold-file format from {:?}; set folds.format",
                path.extension().and_then(|e| e.to_str()).unwrap_or("")
            )));
        }
        f
    } else {
        fmt
    };
    let text = std::fs::read_to_string(path)
        .map_err(|e| SpecError::new(format!("cannot read fold file {}: {e}", path.display())))?;
    parse_fold_str(&text, fmt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &Path, name: &str, content: &str) -> std::path::PathBuf {
        let p = dir.join(name);
        std::fs::File::create(&p)
            .unwrap()
            .write_all(content.as_bytes())
            .unwrap();
        p
    }

    #[test]
    fn csv_nirs4all_train_columns() {
        // cookbook test_folds_file_case: fold_0,fold_1 with train ids per column.
        let tmp = tempfile::tempdir().unwrap();
        let p = write(tmp.path(), "folds.csv", "fold_0,fold_1\n0,2\n1,3\n,4\n,5\n");
        let folds = parse_fold_file(&p, "csv").unwrap();
        assert_eq!(folds.len(), 2);
        assert_eq!(folds[0], (vec![0, 1], vec![2, 3, 4, 5]));
        assert_eq!(folds[1], (vec![2, 3, 4, 5], vec![0, 1]));
    }

    #[test]
    fn json_train_val() {
        let tmp = tempfile::tempdir().unwrap();
        let p = write(tmp.path(), "f.json", r#"[{"train":[0,1,2,3],"val":[4,5]}]"#);
        let folds = parse_fold_file(&p, "auto").unwrap();
        assert_eq!(folds, vec![(vec![0, 1, 2, 3], vec![4, 5])]);
    }

    #[test]
    fn txt_alternating() {
        let tmp = tempfile::tempdir().unwrap();
        let p = write(tmp.path(), "f.txt", "0,1,2\n3,4\n");
        let folds = parse_fold_file(&p, "txt").unwrap();
        assert_eq!(folds, vec![(vec![0, 1, 2], vec![3, 4])]);
    }
}
