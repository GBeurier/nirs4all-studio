// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Resolver: normalize a path/glob/file-list into a stable, ordered `InputSet`
//! (ports `resolve/resolver.py`).
//!
//! Every item carries a stable identity (absolute path), a content hash (so
//! plans/fingerprints are reproducible), an extension hint, and a sidecar group
//! (companion files like ENVI `.hdr`). Directory and glob expansions are
//! deterministically ordered (by lowercased absolute path). Foundational —
//! retrofitting identity later would break fingerprints.

use std::collections::{BTreeMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// Known sidecar relationships: primary-extension → companion extensions.
fn sidecar_companions() -> &'static [(&'static str, &'static [&'static str])] {
    &[
        (".img", &[".hdr"]),
        (".sli", &[".hdr"]),
        (".dat", &[".hdr"]),
        (".bil", &[".hdr"]),
        (".bsq", &[".hdr"]),
        (".bip", &[".hdr"]),
    ]
}

const GLOB_CHARS: [char; 3] = ['*', '?', '['];

#[derive(Debug, Clone)]
pub struct InputItem {
    /// Display reference (basename or relative path).
    pub ref_: String,
    /// `"file"` | `"array"` | `"record_set"` | `"spectrodataset"`.
    pub kind: String,
    /// Stable id: absolute path | `array:<name>` | `object:<id>`.
    pub identity: String,
    pub content_hash: Option<String>,
    pub extension: Option<String>,
    pub sidecars: Vec<String>,
    pub hints: Map<String, Value>,
}

#[derive(Debug, Clone, Default)]
pub struct InputSet {
    pub items: Vec<InputItem>,
    pub origin: Map<String, Value>,
}

impl InputSet {
    /// Display refs in order (Python `InputSet.names`).
    pub fn names(&self) -> Vec<String> {
        self.items.iter().map(|i| i.ref_.clone()).collect()
    }
    /// File items only.
    pub fn files(&self) -> Vec<&InputItem> {
        self.items.iter().filter(|i| i.kind == "file").collect()
    }
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Compound-extension-aware suffix (lowercased): `.csv.gz`/`.csv.zip`/`.tar.*`
/// or the final `.suffix`.
fn compound_extension(name: &str) -> String {
    let low = name.to_lowercase();
    for compound in [".csv.gz", ".csv.zip", ".tar.gz", ".tar.bz2", ".tar.xz"] {
        if low.ends_with(compound) {
            return compound.to_string();
        }
    }
    match name.rfind('.') {
        Some(idx) => name[idx..].to_lowercase(),
        None => String::new(),
    }
}

fn is_glob(text: &str) -> bool {
    text.chars().any(|c| GLOB_CHARS.contains(&c))
}

fn canonical_string(path: &Path) -> String {
    let raw = std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned();
    strip_windows_verbatim_prefix(&raw)
}

fn strip_windows_verbatim_prefix(text: &str) -> String {
    const VERBATIM: &str = "\\\\?\\";
    const VERBATIM_UNC: &str = "\\\\?\\UNC\\";

    if let Some(rest) = text.strip_prefix(VERBATIM_UNC) {
        return format!("\\\\{rest}");
    }
    if let Some(rest) = text.strip_prefix(VERBATIM) {
        let bytes = rest.as_bytes();
        if bytes.len() >= 3 && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/') {
            return rest.to_string();
        }
    }
    text.to_string()
}

/// Python `Path.stem`: filename minus the final suffix.
fn path_stem(name: &str) -> String {
    match name.rfind('.') {
        Some(idx) if idx > 0 => name[..idx].to_string(),
        _ => name.to_string(),
    }
}

/// Map each primary file (abspath) to its companion sidecar abspaths.
fn group_sidecars(paths: &[PathBuf]) -> BTreeMap<String, Vec<String>> {
    let mut by_stem: BTreeMap<(String, String), Vec<PathBuf>> = BTreeMap::new();
    for p in paths {
        let parent = p
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        by_stem.entry((parent, stem)).or_default().push(p.clone());
    }
    let mut sidecars: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for group in by_stem.values() {
        let exts: IndexMap<String, &PathBuf> = group
            .iter()
            .map(|p| {
                let ext = p
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                    .unwrap_or_default();
                (ext, p)
            })
            .collect();
        for (ext, companions) in sidecar_companions() {
            let Some(primary) = exts.get(*ext) else {
                continue;
            };
            let attached: Vec<String> = companions
                .iter()
                .filter_map(|c| exts.get(*c).map(|p| canonical_string(p)))
                .collect();
            if !attached.is_empty() {
                sidecars.insert(canonical_string(primary), attached);
            }
        }
    }
    sidecars
}

fn file_item(
    path: &Path,
    sidecar_map: &BTreeMap<String, Vec<String>>,
    base: Option<&Path>,
) -> InputItem {
    let abspath = canonical_string(path);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ref_ = match base {
        Some(base) => relpath(&abspath, base),
        None => name.clone(),
    };
    let mut hints = Map::new();
    hints.insert("basename".into(), Value::from(name.clone()));
    hints.insert("stem".into(), Value::from(path_stem(&name)));
    InputItem {
        ref_,
        kind: "file".into(),
        identity: abspath.clone(),
        content_hash: sha256_file(path).ok(),
        extension: Some(compound_extension(&name)),
        sidecars: sidecar_map.get(&abspath).cloned().unwrap_or_default(),
        hints,
    }
}

/// Relative path of `abspath` under `base` (files-under-base case → basename or
/// nested relative path, forward-slash separated).
fn relpath(abspath: &str, base: &Path) -> String {
    let base_abs = canonical_string(base);
    Path::new(abspath)
        .strip_prefix(&base_abs)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| {
            Path::new(abspath)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        })
}

fn sort_by_lower_abspath(paths: &mut [PathBuf]) {
    paths.sort_by_key(|p| canonical_string(p).to_lowercase());
}

fn resolve_dir(path: &Path, recursive: bool) -> InputSet {
    let pattern = if recursive { "**/*" } else { "*" };
    let glob_pat = format!("{}/{}", path.to_string_lossy(), pattern);
    let mut files: Vec<PathBuf> = glob::glob(&glob_pat)
        .map(|paths| {
            paths
                .filter_map(Result::ok)
                .filter(|p| p.is_file())
                .collect()
        })
        .unwrap_or_default();
    sort_by_lower_abspath(&mut files);
    let sidecar_map = group_sidecars(&files);
    let attached: HashSet<String> = sidecar_map.values().flatten().cloned().collect();
    let items: Vec<InputItem> = files
        .iter()
        .filter(|p| !attached.contains(&canonical_string(p)))
        .map(|p| file_item(p, &sidecar_map, Some(path)))
        .collect();
    let mut origin = Map::new();
    origin.insert("kind".into(), Value::from("directory"));
    origin.insert("ref".into(), Value::from(canonical_string(path)));
    origin.insert("recursive".into(), Value::from(recursive));
    InputSet { items, origin }
}

fn resolve_paths(paths: &[String], recursive: bool) -> InputSet {
    let mut expanded: Vec<PathBuf> = Vec::new();
    for raw in paths {
        if is_glob(raw) {
            if let Ok(globbed) = glob::glob(raw) {
                expanded.extend(globbed.filter_map(Result::ok));
            }
        } else {
            expanded.push(PathBuf::from(raw));
        }
    }
    let mut files: Vec<PathBuf> = expanded.into_iter().filter(|p| p.is_file()).collect();
    sort_by_lower_abspath(&mut files);
    let sidecar_map = group_sidecars(&files);
    let attached: HashSet<String> = sidecar_map.values().flatten().cloned().collect();
    let items: Vec<InputItem> = files
        .iter()
        .filter(|p| !attached.contains(&canonical_string(p)))
        .map(|p| file_item(p, &sidecar_map, None))
        .collect();
    let missing: Vec<Value> = paths
        .iter()
        .filter(|raw| !is_glob(raw) && !Path::new(raw).exists())
        .map(|raw| Value::from(raw.clone()))
        .collect();
    let mut origin = Map::new();
    origin.insert("kind".into(), Value::from("files"));
    origin.insert(
        "ref".into(),
        Value::Array(paths.iter().map(|p| Value::from(p.clone())).collect()),
    );
    if !missing.is_empty() {
        origin.insert("missing".into(), Value::Array(missing));
    }
    let _ = recursive;
    InputSet { items, origin }
}

/// Resolve a single path (directory / glob / file) into an `InputSet`.
pub fn resolve_path(input: &str, recursive: bool) -> InputSet {
    let path = Path::new(input);
    if path.is_dir() {
        resolve_dir(path, recursive)
    } else {
        resolve_paths(&[input.to_string()], recursive)
    }
}

/// Resolve a list of paths/globs into an `InputSet`.
pub fn resolve_list(paths: &[String], recursive: bool) -> InputSet {
    resolve_paths(paths, recursive)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &Path, name: &str, content: &str) {
        let mut f = std::fs::File::create(dir.join(name)).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn resolve_directory_sorted_basenames() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "Ycal.csv", "y\n1\n");
        write(tmp.path(), "Xcal.csv", "1000\n0.4\n");
        let iset = resolve_path(&tmp.path().to_string_lossy(), false);
        assert_eq!(iset.names(), vec!["Xcal.csv", "Ycal.csv"]); // lower-abspath order
        assert_eq!(iset.origin["kind"], "directory");
        assert!(iset.items[0].content_hash.is_some());
        assert_eq!(iset.items[0].extension.as_deref(), Some(".csv"));
    }

    #[test]
    fn resolve_file_list_basenames_and_missing() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "X.csv", "1000\n0.4\n");
        let present = tmp.path().join("X.csv").to_string_lossy().into_owned();
        let iset = resolve_list(&[present, "nope.csv".into()], false);
        assert_eq!(iset.names(), vec!["X.csv"]);
        assert_eq!(iset.origin["kind"], "files");
        assert_eq!(iset.origin["missing"], serde_json::json!(["nope.csv"]));
    }

    #[test]
    fn canonical_string_strips_windows_verbatim_prefixes() {
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\C:\tmp\n4io_smoke\X.csv"),
            r"C:\tmp\n4io_smoke\X.csv"
        );
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\UNC\server\share\X.csv"),
            r"\\server\share\X.csv"
        );
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\not-a-drive-root"),
            r"\\?\not-a-drive-root"
        );
    }
}
