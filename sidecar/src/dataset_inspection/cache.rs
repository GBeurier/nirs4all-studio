//! Bounded session memoization of dataset documents and inspection projections.
//! Keys include the complete request. Windows dependency identities also bind
//! bounded full file contents: rapid writes can preserve both timestamp markers.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 128;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(5 * 60);
// Avoid turning cache lookup into unbounded I/O for very large datasets. Inputs
// beyond this aggregate budget are computed normally without memoization.
const MAX_SNAPSHOT_HASH_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct FileStamp {
    path: PathBuf,
    device: u64,
    inode: u128,
    size: u64,
    modified: i128,
    changed: i128,
    content_hash: Option<[u8; 32]>,
}

fn metadata_stamp(path: &Path) -> Option<FileStamp> {
    let path = path.canonicalize().ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = fs::metadata(&path).ok()?;
        Some(FileStamp {
            path,
            device: metadata.dev(),
            inode: u128::from(metadata.ino()),
            size: metadata.len(),
            modified: i128::from(metadata.mtime()) * 1_000_000_000
                + i128::from(metadata.mtime_nsec()),
            changed: i128::from(metadata.ctime()) * 1_000_000_000
                + i128::from(metadata.ctime_nsec()),
            content_hash: None,
        })
    }
    #[cfg(windows)]
    {
        let entry = studio_windows_job::file_entry_stamp(&path).ok()?;
        let value = entry.stamp;
        (value.changed > 0).then_some(FileStamp {
            path,
            device: value.volume,
            inode: value.file_id,
            size: value.size,
            modified: i128::from(value.modified),
            changed: i128::from(value.changed),
            content_hash: None,
        })
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        // No trustworthy change marker: skip caching rather than hash matrices
        // or pretend that size/mtime alone establish input identity.
        None
    }
}

fn stamp(path: &Path, hash_budget: &mut u64) -> Option<FileStamp> {
    let before = metadata_stamp(path)?;
    #[cfg(windows)]
    {
        use std::io::Read;
        if !fs::metadata(&before.path).ok()?.is_file() {
            return Some(before);
        }
        if before.size > *hash_budget {
            return None;
        }
        let mut file = fs::File::open(&before.path)
            .ok()?
            .take(before.size.checked_add(1)?);
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 65536];
        let mut read = 0_u64;
        loop {
            let count = file.read(&mut buffer).ok()?;
            if count == 0 {
                break;
            }
            read = read.checked_add(count as u64)?;
            digest.update(&buffer[..count]);
        }
        if read != before.size || metadata_stamp(&before.path)? != before {
            return None;
        }
        *hash_budget -= read;
        let mut after = before;
        after.content_hash = Some(digest.finalize().into());
        Some(after)
    }
    #[cfg(not(windows))]
    {
        let _ = hash_budget;
        Some(before)
    }
}

fn path_key(key: &str) -> bool {
    matches!(
        key,
        "path"
            | "file"
            | "folder"
            | "config_file"
            | "index_file"
            | "folds"
            | "input"
            | "train_file"
            | "test_file"
            | "predict_file"
    ) || ["train_", "test_", "val_", "validation_"]
        .iter()
        .any(|prefix| {
            key.strip_prefix(prefix).is_some_and(|role| {
                matches!(
                    role,
                    "x" | "y" | "group" | "groups" | "metadata" | "weights"
                )
            })
        })
}

fn references(value: &Value, paths: &mut BTreeSet<PathBuf>, is_path: bool) {
    match value {
        Value::String(value) if is_path => {
            paths.insert(PathBuf::from(value));
        }
        Value::Array(values) => {
            for value in values {
                references(value, paths, is_path);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                references(value, paths, path_key(key));
            }
        }
        _ => {}
    }
}

fn snapshot(payload: &Value) -> Option<Vec<FileStamp>> {
    let mut paths = BTreeSet::new();
    references(payload, &mut paths, false);
    // Folder auto-detection has no explicit files yet. Capture bounded entry
    // identities as well: changing a config file need not change its directory.
    if !paths.is_empty() && paths.iter().all(|path| path.is_dir()) {
        let directories = paths.iter().cloned().collect::<Vec<_>>();
        for directory in directories {
            for entry in fs::read_dir(directory).ok()? {
                if paths.len() >= 4096 {
                    return None;
                }
                paths.insert(entry.ok()?.path());
            }
        }
    }
    let mut hash_budget = MAX_SNAPSHOT_HASH_BYTES;
    let mut stamps = paths
        .iter()
        .map(|path| stamp(path, &mut hash_budget))
        .collect::<Option<Vec<_>>>()?;
    stamps.sort();
    stamps.dedup();
    Some(stamps)
}

struct Entry {
    key: [u8; 32],
    dependencies: Vec<FileStamp>,
    result: Value,
    bytes: usize,
    created: Instant,
}

#[derive(Default)]
struct Cache {
    entries: VecDeque<Entry>,
    bytes: usize,
}

impl Cache {
    fn take(&mut self, key: &[u8; 32]) -> Option<Entry> {
        let position = self.entries.iter().position(|entry| &entry.key == key)?;
        let entry = self.entries.remove(position)?;
        self.bytes -= entry.bytes;
        Some(entry)
    }

    fn insert(&mut self, entry: Entry) {
        if entry.bytes > MAX_ENTRY_BYTES {
            return;
        }
        if let Some(position) = self
            .entries
            .iter()
            .position(|existing| existing.key == entry.key)
        {
            self.bytes -= self
                .entries
                .remove(position)
                .expect("entry position exists")
                .bytes;
        }
        while self.entries.len() >= MAX_ENTRIES || self.bytes + entry.bytes > MAX_BYTES {
            let Some(oldest) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= oldest.bytes;
        }
        self.bytes += entry.bytes;
        self.entries.push_back(entry);
    }
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Cache::default()))
}

fn cached_result(key: &[u8; 32], current: &[FileStamp]) -> Option<Value> {
    let entry = cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take(key)?;
    // The caller just captured the current complete input snapshot outside the
    // mutex. Comparing it also detects aliases pointing to a different file.
    if entry.created.elapsed() >= TTL || entry.dependencies.as_slice() != current {
        return None;
    }
    let result = entry.result.clone();
    cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(entry);
    Some(result)
}

/// Callers must authorize paths before lookup and retain their existing checks
/// of any canonical references returned by Python.
/// Failed computations and input changes during computation are never cached.
pub fn invoke(
    scope: u64,
    operation: &str,
    payload: &Value,
    compute: impl FnOnce() -> Result<Value, String>,
) -> Result<Value, String> {
    invoke_with_validation(scope, operation, payload, compute, || Ok(()))
}

/// Scientific callers validate their runtime only when serving a cache hit;
/// the normal execution boundary already performs that validation on misses.
pub fn invoke_with_validation(
    scope: u64,
    operation: &str,
    payload: &Value,
    compute: impl FnOnce() -> Result<Value, String>,
    validate_hit: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    let mut digest = Sha256::new();
    digest.update(scope.to_le_bytes());
    digest.update(operation.as_bytes());
    digest.update(serde_json::to_vec(payload).map_err(|error| error.to_string())?);
    let key: [u8; 32] = digest.finalize().into();
    let before = snapshot(payload);
    if let Some(ref current) = before {
        if let Some(result) = cached_result(&key, current) {
            validate_hit()?;
            return Ok(result);
        }
    }
    let result = compute()?;
    if result.get("success") == Some(&Value::Bool(false)) {
        return Ok(result);
    }
    if let Some(before) = before.filter(|before| snapshot(payload).as_ref() == Some(before)) {
        // Every dependency needs a pre-computation identity. Deep implicit
        // references discovered only afterward cannot establish that the result
        // used their current contents, so leave that response uncached.
        let Some(discovered) = snapshot(&result) else {
            return Ok(result);
        };
        if discovered
            .iter()
            .any(|dependency| before.binary_search(dependency).is_err())
        {
            return Ok(result);
        }
        let dependencies = before;
        let bytes = dependencies.iter().fold(
            serde_json::to_vec(&result)
                .map_err(|error| error.to_string())?
                .len(),
            |bytes, dependency| {
                bytes
                    .saturating_add(dependency.path.as_os_str().len())
                    .saturating_add(std::mem::size_of::<FileStamp>())
            },
        );
        cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(Entry {
                key,
                dependencies,
                result: result.clone(),
                bytes,
                created: Instant::now(),
            });
    }
    Ok(result)
}

pub fn adapt(
    scope: u64,
    operation: &str,
    payload: &Value,
    compute: impl FnOnce() -> Result<Value, String>,
    validate_hit: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    if matches!(
        operation,
        "dataset.configure" | "dataset.preview" | "dataset.stats" | "dataset.inspect_format"
    ) {
        invoke_with_validation(scope, operation, payload, compute, validate_hit)
    } else {
        compute()
    }
}

/// An explicit dataset refresh requests a new inspection even if its current
/// file markers still match. Invalidate related projections and configurations.
pub fn invalidate(root: &Path) {
    // Dependencies are canonical. Windows canonicalization adds a verbatim
    // prefix, so compare both sides in the same namespace.
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut cache = cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.entries.retain(|entry| {
        !entry
            .dependencies
            .iter()
            .any(|dependency| dependency.path.starts_with(&canonical_root))
    });
    cache.bytes = cache.entries.iter().map(|entry| entry.bytes).sum();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    #[test]
    fn reuses_identical_request_and_invalidates_y_metadata_options_and_runtime() {
        let root = tempfile::tempdir().unwrap();
        let x = root.path().join("X.csv");
        let y = root.path().join("Y.csv");
        let metadata = root.path().join("M.csv");
        for path in [&x, &y, &metadata] {
            fs::write(path, "1;2\n").unwrap();
        }
        let payload =
            json!({"config":{"train_x":x,"train_y":y,"train_group":metadata},"max_samples":5});
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Ok(json!({"generation":calls.get()}))
        };
        assert_eq!(
            invoke(11, "dataset.preview", &payload, compute).unwrap(),
            json!({"generation":1})
        );
        assert_eq!(
            invoke(11, "dataset.preview", &payload, compute).unwrap(),
            json!({"generation":1})
        );
        for path in [&y, &metadata] {
            let modified = fs::metadata(path).unwrap().modified().unwrap();
            fs::write(path, "3;4\n").unwrap();
            fs::File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
            invoke(11, "dataset.preview", &payload, compute).unwrap();
        }
        assert_eq!(
            calls.get(),
            3,
            "ctime must detect same-size edits with restored mtime"
        );
        let mut changed = payload.clone();
        changed["config"]["global_params"] = json!({"has_header":false});
        invoke(11, "dataset.preview", &changed, compute).unwrap();
        invoke(12, "dataset.preview", &payload, compute).unwrap();
        assert_eq!(calls.get(), 5);
    }

    #[test]
    fn discovered_references_and_changes_during_computation_prevent_stale_reuse() {
        let root = tempfile::tempdir().unwrap();
        let x = root.path().join("X.csv");
        fs::write(&x, "1\n").unwrap();
        let payload = json!({"record":{"path":root.path(),"config":{}}});
        let first = invoke(20, "dataset.configure", &payload, || {
            Ok(json!({"train_x":x}))
        })
        .unwrap();
        fs::write(&x, "2\n").unwrap();
        let result = invoke(20, "dataset.configure", &payload, || {
            Ok(json!({"train_x":x,"changed":true}))
        })
        .unwrap();
        assert_ne!(first, result);
        let request = json!({"path":x});
        invoke(21, "native.inspect", &request, || {
            fs::write(&x, "3\n").unwrap();
            Ok(json!(1))
        })
        .unwrap();
        assert_eq!(
            invoke(21, "native.inspect", &request, || Ok(json!(2))).unwrap(),
            json!(2)
        );
    }

    #[test]
    fn does_not_cache_unknown_deep_dependencies_discovered_after_computation() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("nested");
        fs::create_dir(&nested).unwrap();
        let x = nested.join("X.csv");
        fs::write(&x, "1\n").unwrap();
        let payload = json!({"record":{"path":root.path(),"config":{}}});
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Ok(json!({"train_x":x,"generation":calls.get()}))
        };
        invoke(22, "dataset.configure", &payload, compute).unwrap();
        invoke(22, "dataset.configure", &payload, compute).unwrap();
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn refuses_failed_computations_and_obeys_memory_bound() {
        let root = tempfile::tempdir().unwrap();
        let payload = json!({"path":root.path()});
        assert!(invoke(31, "dataset.configure", &payload, || Err("failed".into())).is_err());
        assert_eq!(
            invoke(31, "dataset.configure", &payload, || Ok(json!(true))).unwrap(),
            json!(true)
        );
        let mut bounded = Cache::default();
        for value in 0..MAX_ENTRIES + 1 {
            let mut key = [0_u8; 32];
            key[..8].copy_from_slice(&(value as u64).to_le_bytes());
            bounded.insert(Entry {
                key,
                dependencies: vec![],
                result: json!(value),
                bytes: 1,
                created: Instant::now(),
            });
        }
        assert_eq!(bounded.entries.len(), MAX_ENTRIES);
        assert_eq!(bounded.bytes, MAX_ENTRIES);
    }

    #[test]
    fn validates_runtime_on_hits_without_adding_a_second_validation_to_misses() {
        let calls = Cell::new(0);
        let validations = Cell::new(0);
        let payload = json!({"config":{"name":"guard fixture"}});
        for _ in 0..2 {
            invoke_with_validation(
                32,
                "dataset.configure",
                &payload,
                || {
                    calls.set(calls.get() + 1);
                    Ok(json!({"name":"guard fixture"}))
                },
                || {
                    validations.set(validations.get() + 1);
                    Ok(())
                },
            )
            .unwrap();
        }
        assert_eq!(calls.get(), 1);
        assert_eq!(validations.get(), 1);
        assert!(invoke_with_validation(
            32,
            "dataset.configure",
            &payload,
            || panic!("An invalidated runtime must not be executed implicitly"),
            || Err("Runtime changed".into()),
        )
        .is_err());
    }

    #[test]
    fn explicit_refresh_discards_cached_inspection_for_unchanged_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("X.csv");
        fs::write(&path, "1\n").unwrap();
        let payload = json!({"config":{"train_x":path}});
        invoke(34, "dataset.preview", &payload, || Ok(json!(1))).unwrap();
        invalidate(root.path());
        assert_eq!(
            invoke(34, "dataset.preview", &payload, || Ok(json!(2))).unwrap(),
            json!(2)
        );
    }

    #[cfg(windows)]
    #[test]
    fn rapid_same_size_edits_with_restored_times_never_reuse_cached_science() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Y.csv");
        fs::write(&path, "00\n").unwrap();
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        let payload = json!({"config":{"train_y":path}});
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Ok(json!(fs::read_to_string(&path).unwrap()))
        };
        invoke(35, "dataset.preview", &payload, compute).unwrap();
        for value in 1..=80 {
            let expected = format!("{value:02}\n");
            fs::write(&path, &expected).unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
            assert_eq!(
                invoke(35, "dataset.preview", &payload, compute).unwrap(),
                json!(expected)
            );
        }
        assert_eq!(calls.get(), 81);
        assert_eq!(
            invoke(35, "dataset.preview", &payload, compute).unwrap(),
            json!("80\n")
        );
        assert_eq!(
            calls.get(),
            81,
            "unchanged contents should still be memoized"
        );
    }

    #[cfg(windows)]
    #[test]
    fn unbounded_input_hashes_bypass_cache_instead_of_trusting_timestamps() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large-X.csv");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_SNAPSHOT_HASH_BYTES + 1)
            .unwrap();
        let payload = json!({"config":{"train_x":path}});
        assert!(snapshot(&payload).is_none());
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Ok(json!(calls.get()))
        };
        assert_eq!(
            invoke(36, "dataset.preview", &payload, compute).unwrap(),
            json!(1)
        );
        assert_eq!(
            invoke(36, "dataset.preview", &payload, compute).unwrap(),
            json!(2)
        );
    }

    #[cfg(unix)]
    #[test]
    fn retargeting_a_symlink_cannot_reuse_the_previous_resolved_input() {
        let root = tempfile::tempdir().unwrap();
        let a = root.path().join("A.csv");
        let b = root.path().join("B.csv");
        let alias = root.path().join("input.csv");
        fs::write(&a, "1\n").unwrap();
        fs::write(&b, "2\n").unwrap();
        std::os::unix::fs::symlink(&a, &alias).unwrap();
        let payload = json!({"path":alias});
        assert_eq!(
            invoke(33, "native.inspect", &payload, || Ok(json!(1))).unwrap(),
            json!(1)
        );
        fs::remove_file(&alias).unwrap();
        std::os::unix::fs::symlink(&b, &alias).unwrap();
        assert_eq!(
            invoke(33, "native.inspect", &payload, || Ok(json!(2))).unwrap(),
            json!(2)
        );
    }
}
