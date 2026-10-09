//! Reuse Python-host diagnostic probes until the selected interpreter or its
//! installed packages change.
//!
//! Each probe spawns a fresh interpreter (cold `torch`/`tensorflow` imports cost
//! seconds), yet its answer only depends on which interpreter runs and what is
//! installed beside it. A probe result is therefore keyed on a cheap filesystem
//! fingerprint: the interpreter file plus the entry count and mtime of every
//! `site-packages` directory next to it. Installing, upgrading or removing a
//! distribution changes that directory, and selecting another interpreter
//! changes the path; both miss the cache. When no `site-packages` can be located
//! the probe is never cached, so a stale answer is impossible.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    time::SystemTime,
};

use serde_json::Value;

#[derive(Clone, Copy, Debug)]
pub enum ProbeKind {
    Capabilities,
    SystemInfo,
    UpdatesVersion,
    RuntimeStatus,
    SystemBuild,
    EnvCoherence,
}

const PROBE_KINDS: usize = 6;

#[derive(Debug, Eq, PartialEq)]
struct RuntimeFingerprint {
    interpreter: PathBuf,
    interpreter_len: u64,
    interpreter_modified: Option<SystemTime>,
    package_dirs: Vec<(PathBuf, usize, Option<SystemTime>)>,
}

impl RuntimeFingerprint {
    fn of(host: &Path) -> Option<Self> {
        let metadata = fs::metadata(host).ok()?;
        let package_dirs = package_dirs(host)
            .into_iter()
            .map(|dir| {
                let modified = fs::metadata(&dir).and_then(|m| m.modified()).ok();
                let entries = fs::read_dir(&dir).map_or(0, Iterator::count);
                (dir, entries, modified)
            })
            .collect::<Vec<_>>();
        if package_dirs.is_empty() {
            return None;
        }
        Some(Self {
            interpreter: host.to_path_buf(),
            interpreter_len: metadata.len(),
            interpreter_modified: metadata.modified().ok(),
            package_dirs,
        })
    }
}

/// Locate the `site-packages`/`dist-packages` directories of the environment
/// that owns `host` (`<prefix>/bin/python`, `<prefix>/Scripts/python.exe`, or
/// an interpreter placed at the prefix itself).
fn package_dirs(host: &Path) -> Vec<PathBuf> {
    let Some(bin) = host.parent() else {
        return Vec::new();
    };
    let mut bases = vec![bin.to_path_buf()];
    if let Some(prefix) = bin.parent() {
        bases.push(prefix.to_path_buf());
    }
    let mut found = Vec::new();
    for base in bases {
        let windows = base.join("Lib").join("site-packages");
        if windows.is_dir() {
            found.push(windows);
        }
        for lib in ["lib", "lib64"] {
            let Ok(versions) = fs::read_dir(base.join(lib)) else {
                continue;
            };
            for version in versions.flatten() {
                if !version.file_name().to_string_lossy().starts_with("python") {
                    continue;
                }
                for name in ["site-packages", "dist-packages"] {
                    let candidate = version.path().join(name);
                    if candidate.is_dir() {
                        found.push(candidate);
                    }
                }
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

#[derive(Debug)]
struct CachedProbe {
    fingerprint: RuntimeFingerprint,
    value: Value,
}

/// One slot per probe kind. A slot stays locked while its probe runs, so
/// concurrent requests for the same kind share a single interpreter spawn.
#[derive(Clone, Debug, Default)]
pub struct PythonProbeCache {
    slots: Arc<[Mutex<Option<CachedProbe>>; PROBE_KINDS]>,
}

impl PythonProbeCache {
    /// Return the cached probe for `host` or run `read` and remember its
    /// success. Failures (timeouts, malformed output) are never cached.
    pub fn get_or_probe<E>(
        &self,
        kind: ProbeKind,
        host: &Path,
        read: impl FnOnce() -> Result<Value, E>,
    ) -> Result<Value, E> {
        let Some(fingerprint) = RuntimeFingerprint::of(host) else {
            return read();
        };
        let mut slot = self.slots[kind as usize]
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(cached) = slot.as_ref().filter(|c| c.fingerprint == fingerprint) {
            return Ok(cached.value.clone());
        }
        let value = read()?;
        *slot = Some(CachedProbe {
            fingerprint,
            value: value.clone(),
        });
        drop(slot);
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    struct Environment {
        _root: tempfile::TempDir,
        python: PathBuf,
        site: PathBuf,
    }

    fn environment(name: &str) -> Environment {
        let root = tempfile::tempdir().unwrap();
        let prefix = root.path().join(name);
        let (bin, site) = if cfg!(windows) {
            (
                prefix.join("Scripts"),
                prefix.join("Lib").join("site-packages"),
            )
        } else {
            (
                prefix.join("bin"),
                prefix.join("lib/python3.11/site-packages"),
            )
        };
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&site).unwrap();
        let python = bin.join("python");
        fs::write(&python, b"interpreter").unwrap();
        Environment {
            _root: root,
            python,
            site,
        }
    }

    fn probe(
        cache: &PythonProbeCache,
        kind: ProbeKind,
        host: &Path,
        runs: &Cell<u32>,
    ) -> Result<Value, &'static str> {
        cache.get_or_probe(kind, host, || {
            runs.set(runs.get() + 1);
            Ok(json!({"run": runs.get()}))
        })
    }

    #[test]
    fn repeated_probes_reuse_the_result_per_kind() {
        let env = environment("venv");
        let cache = PythonProbeCache::default();
        let runs = Cell::new(0);
        let first = probe(&cache, ProbeKind::Capabilities, &env.python, &runs).unwrap();
        assert_eq!(
            probe(&cache, ProbeKind::Capabilities, &env.python, &runs).unwrap(),
            first
        );
        assert_eq!(runs.get(), 1);
        probe(&cache, ProbeKind::SystemInfo, &env.python, &runs).unwrap();
        assert_eq!(runs.get(), 2);
        let shared = cache.clone();
        probe(&shared, ProbeKind::Capabilities, &env.python, &runs).unwrap();
        probe(&cache, ProbeKind::SystemInfo, &env.python, &runs).unwrap();
        assert_eq!(runs.get(), 2, "clones share the same slots");
    }

    #[test]
    fn installing_or_removing_a_package_invalidates_the_probe() {
        let env = environment("venv");
        let cache = PythonProbeCache::default();
        let runs = Cell::new(0);
        probe(&cache, ProbeKind::SystemBuild, &env.python, &runs).unwrap();
        fs::create_dir(env.site.join("torch-2.0.0.dist-info")).unwrap();
        probe(&cache, ProbeKind::SystemBuild, &env.python, &runs).unwrap();
        assert_eq!(runs.get(), 2);
        probe(&cache, ProbeKind::SystemBuild, &env.python, &runs).unwrap();
        assert_eq!(runs.get(), 2);
        fs::remove_dir(env.site.join("torch-2.0.0.dist-info")).unwrap();
        probe(&cache, ProbeKind::SystemBuild, &env.python, &runs).unwrap();
        assert_eq!(runs.get(), 3);
    }

    #[test]
    fn selecting_another_environment_misses_the_cache() {
        let first = environment("venv-a");
        let second = environment("venv-b");
        let cache = PythonProbeCache::default();
        let runs = Cell::new(0);
        probe(&cache, ProbeKind::EnvCoherence, &first.python, &runs).unwrap();
        probe(&cache, ProbeKind::EnvCoherence, &second.python, &runs).unwrap();
        assert_eq!(runs.get(), 2);
        probe(&cache, ProbeKind::EnvCoherence, &first.python, &runs).unwrap();
        assert_eq!(runs.get(), 3);
    }

    #[test]
    fn replacing_the_interpreter_invalidates_the_probe() {
        let env = environment("venv");
        let cache = PythonProbeCache::default();
        let runs = Cell::new(0);
        probe(&cache, ProbeKind::UpdatesVersion, &env.python, &runs).unwrap();
        fs::write(&env.python, b"a different interpreter").unwrap();
        probe(&cache, ProbeKind::UpdatesVersion, &env.python, &runs).unwrap();
        assert_eq!(runs.get(), 2);
    }

    #[test]
    fn failures_and_unlocatable_environments_are_never_cached() {
        let env = environment("venv");
        let cache = PythonProbeCache::default();
        let attempts = Cell::new(0);
        let failing = |attempts: &Cell<u32>| {
            cache.get_or_probe(ProbeKind::RuntimeStatus, &env.python, || {
                attempts.set(attempts.get() + 1);
                Err::<Value, _>("timed_out")
            })
        };
        assert_eq!(failing(&attempts), Err("timed_out"));
        assert_eq!(failing(&attempts), Err("timed_out"));
        assert_eq!(attempts.get(), 2);

        let bare = tempfile::tempdir().unwrap();
        let python = bare.path().join("python");
        fs::write(&python, b"interpreter").unwrap();
        let runs = Cell::new(0);
        probe(&cache, ProbeKind::Capabilities, &python, &runs).unwrap();
        probe(&cache, ProbeKind::Capabilities, &python, &runs).unwrap();
        assert_eq!(runs.get(), 2);
    }
}
