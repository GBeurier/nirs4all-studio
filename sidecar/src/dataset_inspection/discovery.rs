//! Bounded folder discovery; table roles and decoding stay with IO.

use std::collections::BTreeSet;

use super::{json, DatasetInspection, Value};

impl DatasetInspection {
    /// Find dataset folders after admitting the complete input inventory.
    /// A discovered dataset owns its subtree, matching the historical wizard.
    /// # Errors
    /// Enumeration/path/aggregate-byte limits fail before table inspection.
    pub fn scan_folder(
        &self,
        adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let files = self.files(true)?;
        let mut directories: Vec<_> = files
            .iter()
            .filter_map(|path| path.parent().map(std::path::Path::to_path_buf))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        directories.sort_by_key(|path| (path.components().count(), path.clone()));
        let mut datasets = Vec::new();
        let mut accepted = Vec::new();
        let mut warnings = Vec::new();
        let mut scanned = 0;
        for directory in directories {
            if accepted.iter().any(|root| directory.starts_with(root)) {
                continue;
            }
            scanned += 1;
            let inspector = Self::new(&directory, self.limits)?;
            let mut detected = match inspector.detect_files(false, adapt) {
                Ok(detected) => detected,
                Err(error) => {
                    warnings.push(format!("{}: {error}", directory.display()));
                    continue;
                }
            };
            if detected["has_standard_structure"] != true {
                continue;
            }
            let relative = directory
                .strip_prefix(&self.root)
                .map_err(|error| error.to_string())?;
            let mut groups: Vec<_> = relative
                .parent()
                .into_iter()
                .flat_map(std::path::Path::components)
                .map(|component| component.as_os_str().to_string_lossy().into_owned())
                .collect();
            if groups.is_empty() && directory != self.root {
                groups.push(
                    self.root
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                );
            }
            detected["folder_path"] = json!(directory);
            detected["groups"] = json!(groups);
            accepted.push(directory);
            datasets.push(detected);
        }
        Ok(
            json!({"success":true,"root_path":self.root,"datasets":datasets,
            "total_scanned_folders":scanned,"warnings":warnings}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nirs4all_io::materialize::LoadLimits;
    use std::fs;

    #[test]
    fn recursive_scan_keeps_dataset_groups_and_stops_under_detected_dataset() {
        let root = tempfile::tempdir().unwrap();
        for directory in ["group/dataset", "group/dataset/nested", "other"] {
            let folder = root.path().join(directory);
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join("Xcal_NIR.csv"), "1000;1001\n1;2\n3;4\n").unwrap();
            fs::write(folder.join("Xcal_MIR.csv"), "2000;2001\n5;6\n7;8\n").unwrap();
            fs::write(folder.join("Mcal.csv"), "subject\nalpha\nbeta\n").unwrap();
            fs::write(folder.join("folds.csv"), "train;val\n0;1\n").unwrap();
        }
        let inspector = DatasetInspection::new(root.path(), LoadLimits::default()).unwrap();
        let result = inspector
            .scan_folder(&|_, _| panic!("native CSV owner only"))
            .unwrap();
        let datasets = result["datasets"].as_array().unwrap();
        assert_eq!(datasets.len(), 2);
        let dataset = datasets
            .iter()
            .find(|value| value["folder_name"] == "dataset")
            .unwrap();
        assert_eq!(dataset["groups"], json!(["group"]));
        assert_eq!(dataset["has_fold_file"], true);
        assert_eq!(
            dataset["files"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|file| file["type"] == "X")
                .count(),
            2
        );
        assert!(dataset["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["type"] == "metadata"));
    }

    #[test]
    fn aggregate_folder_budget_precedes_all_reader_calls() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("Xcal.csv"), "a\n1\n2\n").unwrap();
        let inspector = DatasetInspection::new(
            root.path(),
            LoadLimits {
                max_total_bytes: 1,
                ..LoadLimits::default()
            },
        )
        .unwrap();
        assert!(inspector
            .scan_folder(&|_, _| panic!("no reader before admission"))
            .unwrap_err()
            .contains("aggregate"));
    }
}
