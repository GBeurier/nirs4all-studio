//! Remember which scientific hosts were acquired, so warm starts stay cheap.
//!
//! Acquiring the packaged runtime hashes every RECORD member of nirs4all,
//! which took 4.5-17 s on warm Windows starts and 38 s on a cold first launch.
//! After a full verification, Rust stores the stat identity (path, size,
//! mtime, ctime, inode and device of RECORD and each member) the preflight
//! reported. A later preflight that observes the same stat identity skips the
//! member hashes; any write, replacement or update changes it and forces a
//! full verification. The exact manifest, wheel, version and callable checks
//! still run on every acquisition.
//!
//! The record is keyed by the interpreter path and digest, the selected
//! site-packages and, for the packaged runtime, its closure digest, so an app
//! update (new closure) or another runtime misses it. A miss also means a cold
//! start: acquisition then gets the longer cold budget. The file lives in the
//! user's Studio configuration directory, beside the settings that already
//! select the runtime; a process able to rewrite it can rewrite the runtime
//! itself whenever that runtime is writable by the same user.

use super::{hex_digest, HostIdentity};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const FILE_NAME: &str = "scientific-host-verification.json";
const SCHEMA: &str = "nirs4all.studio-scientific-host-verification.v1";
const MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_ENTRIES: usize = 8;

/// Identity of an acquired host, cheap to compute before its preflight.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct VerificationKey(String);

impl VerificationKey {
    pub(super) fn new(
        host: &HostIdentity,
        site_packages: Option<&Path>,
        closure: Option<&HostIdentity>,
    ) -> Self {
        Self(
            json!([
                host.canonical_path,
                hex_digest(&host.sha256),
                site_packages,
                closure.map(|closure| hex_digest(&closure.sha256)),
            ])
            .to_string(),
        )
    }
}

/// A previous successful acquisition of the same host.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct VerifiedHost {
    /// Stat identity of the fully verified packaged distribution.
    pub(super) distribution_stat_sha256: Option<String>,
}

#[derive(Debug)]
pub(super) struct VerificationCache {
    path: Option<PathBuf>,
}

impl VerificationCache {
    pub(super) fn new(config_dir: &Path) -> Self {
        Self {
            path: (!config_dir.as_os_str().is_empty()).then(|| config_dir.join(FILE_NAME)),
        }
    }

    fn entries(&self) -> Vec<Value> {
        let Some(path) = &self.path else {
            return Vec::new();
        };
        let mut encoded = Vec::new();
        let read = fs::File::open(path)
            .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut encoded));
        if read.is_err() || encoded.len() as u64 > MAX_FILE_BYTES {
            return Vec::new();
        }
        serde_json::from_slice::<Value>(&encoded)
            .ok()
            .filter(|value| value["schema"] == SCHEMA)
            .and_then(|value| value["entries"].as_array().cloned())
            .unwrap_or_default()
    }

    pub(super) fn lookup(&self, key: &VerificationKey) -> Option<VerifiedHost> {
        self.entries()
            .into_iter()
            .find(|entry| entry["key"].as_str() == Some(key.0.as_str()))
            .map(|entry| VerifiedHost {
                distribution_stat_sha256: entry["distribution_stat_sha256"]
                    .as_str()
                    .filter(|digest| super::valid_lower_sha256(digest))
                    .map(str::to_owned),
            })
    }

    /// Record a successful acquisition. A read-only configuration directory
    /// only costs the next start a full verification.
    pub(super) fn record(&self, key: &VerificationKey, distribution_stat_sha256: Option<&str>) {
        let Some(path) = &self.path else {
            return;
        };
        let mut entries = vec![json!({
            "key": key.0,
            "distribution_stat_sha256": distribution_stat_sha256,
        })];
        entries.extend(
            self.entries()
                .into_iter()
                .filter(|entry| entry["key"].as_str() != Some(key.0.as_str()))
                .take(MAX_ENTRIES - 1),
        );
        let encoded = json!({ "schema": SCHEMA, "entries": entries }).to_string();
        let staging = path.with_extension("json.tmp");
        let _ = fs::create_dir_all(path.parent().unwrap_or_else(|| Path::new("")))
            .and_then(|()| fs::write(&staging, encoded))
            .and_then(|()| fs::rename(&staging, path));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(root: &Path, name: &str, content: &[u8]) -> HostIdentity {
        let path = root.join(name);
        fs::write(&path, content).unwrap();
        super::super::host_identity(&path).unwrap()
    }

    #[test]
    fn records_hosts_by_interpreter_site_and_closure() {
        let root = tempfile::tempdir().unwrap();
        let cache = VerificationCache::new(&root.path().join("config"));
        let python = host(root.path(), "python", b"interpreter");
        let closure = host(root.path(), "closure.json", b"closure-1");
        let site = root.path().join("site-packages");
        let key = VerificationKey::new(&python, Some(&site), Some(&closure));
        assert_eq!(cache.lookup(&key), None);

        let digest = "a".repeat(64);
        cache.record(&key, Some(&digest));
        assert_eq!(
            cache.lookup(&key),
            Some(VerifiedHost {
                distribution_stat_sha256: Some(digest)
            })
        );
        // An update ships a new closure; another interpreter is another host.
        let updated = host(root.path(), "closure.json", b"closure-2");
        assert_eq!(
            cache.lookup(&VerificationKey::new(&python, Some(&site), Some(&updated))),
            None
        );
        let other = host(root.path(), "python3", b"interpreter");
        assert_eq!(
            cache.lookup(&VerificationKey::new(&other, Some(&site), Some(&closure))),
            None
        );
        // Selected environments only record that they were acquired.
        let selected = VerificationKey::new(&other, Some(&site), None);
        cache.record(&selected, None);
        assert_eq!(
            cache.lookup(&selected),
            Some(VerifiedHost {
                distribution_stat_sha256: None
            })
        );
        assert!(cache.lookup(&key).is_some());
    }

    #[test]
    fn ignores_unreadable_records_and_bounds_their_number() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config");
        fs::create_dir_all(&config).unwrap();
        let cache = VerificationCache::new(&config);
        let python = host(root.path(), "python", b"interpreter");
        let key = VerificationKey::new(&python, None, None);
        fs::write(config.join(FILE_NAME), b"{not json").unwrap();
        assert_eq!(cache.lookup(&key), None);
        fs::write(
            config.join(FILE_NAME),
            json!({"schema": SCHEMA, "entries": [{"key": key.0, "distribution_stat_sha256": "not-a-digest"}]})
                .to_string(),
        )
        .unwrap();
        assert_eq!(
            cache.lookup(&key),
            Some(VerifiedHost {
                distribution_stat_sha256: None
            })
        );
        for index in 0..20 {
            let site = root.path().join(format!("site-{index}"));
            cache.record(&VerificationKey::new(&python, Some(&site), None), None);
        }
        assert_eq!(cache.entries().len(), MAX_ENTRIES);
        assert!(VerificationCache::new(Path::new("")).lookup(&key).is_none());
    }
}
