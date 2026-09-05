//! Dataset wizard IO and library projections, without a Studio numeric parser.
//!
//! The host supplies an authorized root and explicit resource budgets. Path
//! confinement is shared with the scientific resolver; it is not an OS sandbox.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use nirs4all_io::{
    core::{
        conventions::{match_items, resolve_profiles},
        infer::describe::describe_text,
        materialize::frame::Cell,
        spec::{dataset_spec::LoadingParams, normalize::normalize_to_spec_dict},
    },
    materialize::{loaders::read_table_with_limits, LoadLimits},
};
use serde_json::{json, Value};

use crate::scientific_request_resolver::ScientificRequestResolver;

mod discovery;

const MAX_ENTRIES: usize = 4096;
const MAX_SAMPLE_ROWS: usize = 1000;
const MAX_PRESENTATION_BYTES: usize = 32 * 1024 * 1024;

/// Read-only inspection scoped to one user-selected or catalogue-authorized root.
pub struct DatasetInspection {
    root: PathBuf,
    limits: LoadLimits,
}

impl DatasetInspection {
    /// # Errors
    /// Rejects missing/non-directory roots and invalid host budgets.
    pub fn new(root: &Path, limits: LoadLimits) -> Result<Self, String> {
        limits.validate().map_err(|error| error.to_string())?;
        let root = root.canonicalize().map_err(|error| error.to_string())?;
        if !root.is_dir() {
            return Err("Inspection root must be a directory".into());
        }
        Ok(Self { root, limits })
    }

    fn file(&self, path: &Path) -> Result<PathBuf, String> {
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(path)
        };
        let path = path.canonicalize().map_err(|error| error.to_string())?;
        if !path.starts_with(&self.root) || !path.is_file() {
            return Err("Dataset input escapes its authorized root or is not a file".into());
        }
        if path.metadata().map_err(|error| error.to_string())?.len() > self.limits.max_file_bytes {
            return Err("Dataset input exceeds file byte budget".into());
        }
        Ok(path)
    }

    /// Inspect a complete typed table through IO, returning only bounded samples.
    /// Non-native formats are dispatched before reading to their library owner.
    /// # Errors
    /// Invalid paths/options, reader failures and resource limits propagate.
    pub fn inspect_file(
        &self,
        path: &Path,
        params: &Value,
        sample_rows: usize,
        adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        if sample_rows > MAX_SAMPLE_ROWS || !params.is_object() {
            return Err("Invalid inspection parameters/sample row count".into());
        }
        let path = self.file(path)?;
        let format = file_format(&path);
        if !matches!(format, "csv" | "parquet") {
            let result = adapt(
                "dataset.inspect_format",
                &json!({
                    "path":path,"params":params,"sample_rows":sample_rows
                }),
            )?;
            return Ok(json!({"format":format,"num_rows":result["num_rows"],
                "num_columns":result["num_columns"],"column_names":result["headers"],
                "headers":result["headers"],"sample_data":result["sample_data"],
                "reader":result["reader"],"sheet_names":null,"column_info":null}));
        }
        let mut detected = json!({});
        let mut confidence = json!({});
        // Neutral detector is library-owned. Read a bounded prefix, not the
        // unbounded facade describe(); compressed files stay with IO decoding.
        if format == "csv"
            && !path.to_string_lossy().ends_with(".gz")
            && !path.to_string_lossy().ends_with(".zip")
        {
            let mut bytes = Vec::new();
            fs::File::open(&path)
                .map_err(|error| error.to_string())?
                .take(65536.min(self.limits.max_file_bytes))
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            let description = describe_text(&String::from_utf8_lossy(&bytes), 50);
            confidence = json!(description.confidence);
            detected = json!({"delimiter":description.delimiter.to_string(),
                "decimal_separator":description.decimal_separator.to_string(),
                "has_header":description.has_header,"header_unit":description.header_unit});
        }
        for (key, value) in params.as_object().ok_or("Invalid table params")? {
            detected[key] = value.clone();
        }
        // Shared dataset aliases (NA/header/decimal etc.) are normalized by IO.
        let canonical = normalize_to_spec_dict(&json!({"train_x":path,"global_params":detected}));
        let effective = canonical.get("params").unwrap_or(&detected);
        let loading =
            LoadingParams::from_value(Some(effective)).map_err(|error| error.to_string())?;
        let frame = read_table_with_limits(&path, &loading, self.limits)
            .map_err(|error| error.to_string())?;
        let samples = sample_rows.min(frame.n_rows);
        let slots = frame
            .columns
            .len()
            .checked_mul(samples + 2)
            .ok_or("Presentation size overflow")?;
        if slots > MAX_PRESENTATION_BYTES / 32 {
            return Err("Table inspection exceeds presentation cardinality budget".into());
        }
        // Account for worst-case JSON escaping before cloning string cells or
        // duplicating the historical headers/column_names presentation fields.
        let mut bytes = slots * 32;
        for column in &frame.columns {
            bytes = bytes
                .checked_add(column.name.len().saturating_mul(12))
                .ok_or("Presentation size overflow")?;
            for cell in column.values.iter().take(samples) {
                if let Cell::Str(value) = cell {
                    bytes = bytes
                        .checked_add(value.len().saturating_mul(6))
                        .ok_or("Presentation size overflow")?;
                }
            }
            if bytes > MAX_PRESENTATION_BYTES {
                return Err("Table inspection exceeds presentation byte budget".into());
            }
        }
        let sample_data: Vec<Vec<String>> = (0..samples)
            .map(|row| {
                frame
                    .columns
                    .iter()
                    .map(|column| column.values[row].to_str_scalar())
                    .collect()
            })
            .collect();
        Ok(
            json!({"success":true,"format":format,"num_rows":frame.n_rows,
            "num_columns":frame.columns.len(),"column_names":frame.column_names(),
            "headers":frame.column_names(),"header_unit":frame.header_unit,
            "has_header":loading.has_header,"detected_delimiter":loading.delimiter,
            "detected_decimal":loading.decimal_separator,"parsing_options":detected,"confidence":confidence,
            "sample_data":sample_data,"sheet_names":null,"column_info":null,
            "reader":{"backend":"nirs4all-io.native","native_load_limits_applied":true,
                "load_limits":self.limits}}),
        )
    }

    fn files(&self, recursive: bool) -> Result<Vec<PathBuf>, String> {
        let mut pending = vec![self.root.clone()];
        let mut files = Vec::new();
        let mut entries = 0;
        while let Some(directory) = pending.pop() {
            for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
                entries += 1;
                if entries > MAX_ENTRIES {
                    return Err("Dataset folder exceeds directory-entry budget".into());
                }
                let entry = entry.map_err(|error| error.to_string())?;
                if entry.file_name().to_string_lossy().starts_with('.') {
                    continue;
                }
                let kind = entry.file_type().map_err(|error| error.to_string())?;
                if kind.is_dir() && recursive {
                    pending.push(entry.path());
                } else if kind.is_file() || kind.is_symlink() {
                    let path = self.file(&entry.path())?;
                    if file_format(&path) != "unknown"
                        || path.extension().is_some_and(|extension| {
                            matches!(extension.to_str(), Some("json" | "yaml" | "yml"))
                        })
                    {
                        files.push(path);
                    }
                }
            }
        }
        files.sort();
        if u64::try_from(files.len()).map_err(|_| "File count overflow")? > self.limits.max_files {
            return Err("Dataset folder exceeds file count budget".into());
        }
        let total = files.iter().try_fold(0_u64, |total, file| {
            total
                .checked_add(file.metadata().map_err(|error| error.to_string())?.len())
                .ok_or_else(|| "Dataset input byte count overflow".to_string())
        })?;
        if total > self.limits.max_total_bytes {
            return Err("Dataset folder exceeds aggregate byte budget".into());
        }
        Ok(files)
    }

    /// Detect table roles using the IO convention owner, with actual row counts.
    /// # Errors
    /// Refuses unconfined paths and excessive inputs before table reads.
    pub fn detect_files(
        &self,
        recursive: bool,
        adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let paths = self.files(recursive)?;
        let names: Vec<String> = paths
            .iter()
            .map(|path| {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        let profiles =
            resolve_profiles(&["nirs4all-classic"]).map_err(|error| error.to_string())?;
        let assignments = match_items(&names, &profiles, None, None);
        let mut files = Vec::new();
        let mut warnings = assignments.warnings.clone();
        let mut total = 0_u64;
        let mut metadata_columns = Vec::new();
        let mut fold_paths = Vec::new();
        for (path, name) in paths.iter().zip(&names) {
            let assignment = assignments
                .assignments
                .iter()
                .find(|assignment| &assignment.name == name);
            let role = assignment.map_or("unknown", |assignment| match assignment.role.value() {
                "features" => "X",
                "targets" => "Y",
                "metadata" => "metadata",
                _ => "unknown",
            });
            let size = path.metadata().map_err(|error| error.to_string())?.len();
            total = total
                .checked_add(size)
                .ok_or("Dataset input byte count overflow")?;
            if assignments.fold_files.contains(name) {
                fold_paths.push(path.clone());
                continue;
            }
            if file_format(path) == "unknown" {
                continue;
            }
            let info = match self.inspect_file(path, &json!({}), 0, adapt) {
                Ok(info) => info,
                Err(error) => {
                    warnings.push(format!("{name}: {error}"));
                    Value::Null
                }
            };
            if role == "metadata" {
                for column in info["column_names"].as_array().into_iter().flatten() {
                    if !metadata_columns.contains(column) {
                        metadata_columns.push(column.clone());
                    }
                }
            }
            files.push(json!({"path":path,"filename":name,"type":role,
                "split":assignment.map_or("unknown", |assignment| assignment.partition.map_or("train", |partition| partition.value())),
                "source":assignment.map(|assignment| assignment.source_index),
                "format":file_format(path),"size_bytes":size,"confidence":if assignment.is_some(){0.9}else{0.0},
                "num_rows":info["num_rows"],"num_columns":info["num_columns"],
                "overrides":info["parsing_options"],"reader":info["reader"],"detection_confidence":info["confidence"]}));
        }
        let standard = files
            .iter()
            .any(|file| file["type"] == "X" && file["split"] == "train");
        let parsing = files
            .iter()
            .find(|file| file["type"] == "X")
            .map_or_else(|| json!({}), |file| file["overrides"].clone());
        Ok(
            json!({"files":files,"folder_name":self.root.file_name().unwrap_or_default().to_string_lossy(),
            "total_size_bytes":total,"has_standard_structure":standard,"parsing_options":parsing,
            "confidence":{},"has_fold_file":!fold_paths.is_empty(),"fold_file_path":fold_paths.first(),
            "fold_file_paths":fold_paths,"metadata_columns":metadata_columns,"warnings":warnings}),
        )
    }

    fn config(
        &self,
        value: &Value,
        adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let mut record = value.clone();
        ScientificRequestResolver::confine_dataset_config(&mut record, &self.root)
            .map_err(|error| format!("{error:?}"))?;
        let mut config = adapt(
            "dataset.configure",
            &json!({"record":{"path":self.root,"config":record}}),
        )?;
        ScientificRequestResolver::confine_dataset_config(&mut config, &self.root)
            .map_err(|error| format!("{error:?}"))?;
        if !config.is_object() {
            return Err("Dataset adapter returned no explicit config".into());
        }
        Ok(config)
    }

    /// # Errors
    /// Propagates confinement, reader and projection errors without fallback.
    pub fn preview(
        &self,
        config: &Value,
        max_samples: usize,
        adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        if max_samples == 0 {
            return Err("max_samples must be positive".into());
        }
        let config = self.config(config, adapt)?;
        adapt(
            "dataset.preview",
            &json!({"config":config,"max_samples":max_samples,
            "max_input_bytes":self.limits.max_total_bytes}),
        )
    }

    /// # Errors
    /// Propagates confinement, reader and projection errors without fallback.
    pub fn statistics(
        &self,
        config: &Value,
        partition: &str,
        adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        if !matches!(partition, "train" | "test" | "all") {
            return Err("Invalid statistics partition".into());
        }
        let config = self.config(config, adapt)?;
        adapt(
            "dataset.stats",
            &json!({"config":config,"partition":partition,
            "max_input_bytes":self.limits.max_total_bytes}),
        )
    }
}

fn file_format(path: &Path) -> &'static str {
    let path = path.to_string_lossy().to_lowercase();
    if [".csv", ".tsv", ".txt", ".csv.gz", ".csv.zip"]
        .iter()
        .any(|suffix| path.ends_with(suffix))
    {
        "csv"
    } else if [".parquet", ".pq"]
        .iter()
        .any(|suffix| path.ends_with(suffix))
    {
        "parquet"
    } else if [".xlsx", ".xls"]
        .iter()
        .any(|suffix| path.ends_with(suffix))
    {
        "excel"
    } else if path.ends_with(".mat") {
        "mat"
    } else if [".npy", ".npz"].iter().any(|suffix| path.ends_with(suffix)) {
        "numpy"
    } else {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_python(_: &str, _: &Value) -> Result<Value, String> {
        panic!("CSV inspection must use native IO, not Python");
    }

    #[test]
    fn real_csv_beyond_portable_caps_keeps_rows_and_header_axis() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Xcal.csv");
        let mut csv = (0..300)
            .map(|i| (1000 + i).to_string())
            .collect::<Vec<_>>()
            .join(";");
        csv.push('\n');
        for row in 0..150 {
            csv.push_str(
                &(0..300)
                    .map(|column| (row * 300 + column).to_string())
                    .collect::<Vec<_>>()
                    .join(";"),
            );
            csv.push('\n');
        }
        fs::write(&path, csv).unwrap();
        let inspector = DatasetInspection::new(dir.path(), LoadLimits::default()).unwrap();
        let result = inspector
            .inspect_file(&path, &json!({"has_header":true}), 3, &no_python)
            .unwrap();
        assert_eq!(result["num_rows"], 150);
        assert_eq!(result["num_columns"], 300);
        assert_eq!(result["column_names"][0], "1000");
        assert_eq!(result["sample_data"][2][299], "899");
        assert_eq!(result["reader"]["native_load_limits_applied"], true);
    }

    #[test]
    fn native_shape_budget_and_bad_csv_propagate_without_other_reader() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Xcal.csv");
        fs::write(&path, "a;b\n1;2\n3;4\n").unwrap();
        let limits = LoadLimits {
            max_cells: 2,
            ..LoadLimits::default()
        };
        let inspector = DatasetInspection::new(dir.path(), limits).unwrap();
        assert!(inspector
            .inspect_file(&path, &json!({"has_header":true}), 1, &no_python)
            .is_err());
    }

    #[test]
    fn excel_selects_library_owner_before_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("spectra.xlsx");
        fs::write(&path, "not parsed by Rust").unwrap();
        let inspector = DatasetInspection::new(dir.path(), LoadLimits::default()).unwrap();
        let result = inspector
            .inspect_file(
                &path,
                &json!({"sheet_name":"NIR"}),
                2,
                &|operation, payload| {
                    assert_eq!(operation, "dataset.inspect_format");
                    assert_eq!(payload["params"]["sheet_name"], "NIR");
                    Ok(
                        json!({"num_rows":150,"num_columns":300,"headers":["1000"],"sample_data":[],
                "reader":{"backend":"nirs4all.loaders","native_load_limits_applied":false}}),
                    )
                },
            )
            .unwrap();
        assert_eq!(result["num_rows"], 150);
        assert_eq!(result["reader"]["native_load_limits_applied"], false);
    }

    #[test]
    fn rejects_path_escape_before_adapter_or_read() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let path = other.path().join("X.csv");
        fs::write(&path, "a\n1\n").unwrap();
        let inspector = DatasetInspection::new(root.path(), LoadLimits::default()).unwrap();
        assert!(inspector
            .inspect_file(&path, &json!({}), 1, &no_python)
            .unwrap_err()
            .contains("escapes"));
        assert!(inspector
            .preview(&json!({"train_x":path}), 10, &no_python)
            .is_err());
    }

    #[test]
    fn projections_delegate_explicit_config_and_partition_without_numeric_reimplementation() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Xcal.csv");
        fs::write(&path, "a;b\n1;2\n3;4\n").unwrap();
        let inspector = DatasetInspection::new(root.path(), LoadLimits::default()).unwrap();
        let adapt = |operation: &str, payload: &Value| {
            if operation == "dataset.configure" {
                return Ok(payload["record"]["config"].clone());
            }
            assert_eq!(payload["config"]["train_x"], json!(path));
            assert!(payload["max_input_bytes"].as_u64().unwrap() > 0);
            if operation == "dataset.preview" {
                assert_eq!(payload["max_samples"], 5);
                Ok(json!({"num_samples":2,"reader":{"backend":"nirs4all-io.native"}}))
            } else {
                assert_eq!(operation, "dataset.stats");
                assert_eq!(payload["partition"], "test");
                Ok(json!({"partition":"test","num_samples":0}))
            }
        };
        let config = json!({"train_x":path});
        assert_eq!(
            inspector.preview(&config, 5, &adapt).unwrap()["num_samples"],
            2
        );
        assert_eq!(
            inspector.statistics(&config, "test", &adapt).unwrap()["num_samples"],
            0
        );
        assert!(inspector.statistics(&config, "typo", &no_python).is_err());
    }

    #[test]
    fn feature_target_metadata_detection_uses_owner_and_exact_shapes() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("Xcal.csv"), "1000;1001\n1;2\n3;4\n").unwrap();
        fs::write(root.path().join("Ycal.csv"), "protein\n2\n4\n").unwrap();
        fs::write(root.path().join("Mcal.csv"), "subject\nalpha\nbeta\n").unwrap();
        let inspector = DatasetInspection::new(root.path(), LoadLimits::default()).unwrap();
        let result = inspector.detect_files(false, &no_python).unwrap();
        assert_eq!(result["files"].as_array().unwrap().len(), 3);
        assert!(result["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["type"] == "metadata"));
        assert_eq!(result["has_standard_structure"], true);
        for file in result["files"].as_array().unwrap() {
            // This is a detection proposal, not a claim that an ambiguous
            // three-line file's first row is scientifically an observation.
            let has_header = file["overrides"]["has_header"].as_bool().unwrap();
            assert_eq!(file["num_rows"], if has_header { 2 } else { 3 });
        }
        let corrected = inspector
            .inspect_file(
                &root.path().join("Mcal.csv"),
                &json!({"has_header":true}),
                2,
                &no_python,
            )
            .unwrap();
        assert_eq!(corrected["num_rows"], 2);
        assert_eq!(corrected["column_names"][0], "subject");
        assert_eq!(corrected["sample_data"][0][0], "alpha");
        let targets = inspector
            .inspect_file(
                &root.path().join("Ycal.csv"),
                &json!({"has_header":true}),
                2,
                &no_python,
            )
            .unwrap();
        assert_eq!(targets["num_rows"], 2);
        assert_eq!(targets["sample_data"][0][0], "2");
    }
}
