//! Metadata guards for an explicitly selected external library installation.
//!
//! The acquisition preflight verifies the installed distribution's contents.
//! Subsequent previews inspect only that distribution, rather than rehashing it
//! or scanning every dependency in the environment. Windows uses the same
//! `FILE_BASIC_INFO.ChangeTime` checks as the packaged runtime, never a watcher
//! notification alone.

use super::{
    collect_runtime_snapshot, runtime_snapshot_cache_is_trustworthy, BoundaryTiming, HostIdentity,
    RuntimePathSnapshot, RuntimeSnapshot, ScientificCpythonUnavailable,
};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub(super) struct SelectedLibraryIdentity {
    interpreter: PathBuf,
    interpreter_snapshot: RuntimePathSnapshot,
    packages: Vec<(PathBuf, RuntimeSnapshot)>,
}

impl SelectedLibraryIdentity {
    pub(super) fn capture(
        host: &HostIdentity,
        site_packages: &Path,
    ) -> Result<Self, ScientificCpythonUnavailable> {
        let package = site_packages.join("nirs4all");
        let mut roots = vec![package];
        // Distribution metadata controls bootstrap identity and lazy loading.
        // Capture all matching directories so additions/replacements are visible.
        for entry in fs::read_dir(site_packages)
            .map_err(|_| ScientificCpythonUnavailable::DistributionTampered)?
        {
            let entry = entry.map_err(|_| ScientificCpythonUnavailable::DistributionTampered)?;
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.starts_with("nirs4all-") && name.ends_with(".dist-info") {
                roots.push(entry.path());
            }
        }
        if roots.len() != 2 {
            return Err(ScientificCpythonUnavailable::DistributionTampered);
        }
        let packages = roots
            .into_iter()
            .map(|root| {
                let snapshot = collect_runtime_snapshot(&root)?;
                Ok((root, snapshot))
            })
            .collect::<Result<Vec<_>, ScientificCpythonUnavailable>>()?;
        Ok(Self {
            interpreter: host.canonical_path.clone(),
            interpreter_snapshot: file_snapshot(&host.canonical_path)?,
            packages,
        })
    }

    pub(super) fn verify(&self) -> Result<(), ScientificCpythonUnavailable> {
        let _timing = BoundaryTiming::start("selected_library_snapshot");
        if !runtime_snapshot_cache_is_trustworthy() {
            return Err(ScientificCpythonUnavailable::RuntimeContractUnavailable);
        }
        if file_snapshot(&self.interpreter)? != self.interpreter_snapshot {
            return Err(ScientificCpythonUnavailable::HostTampered);
        }
        for (root, expected) in &self.packages {
            if collect_runtime_snapshot(root)? != *expected {
                return Err(ScientificCpythonUnavailable::DistributionTampered);
            }
        }
        Ok(())
    }
}

fn file_snapshot(path: &Path) -> Result<RuntimePathSnapshot, ScientificCpythonUnavailable> {
    #[cfg(windows)]
    {
        super::windows_runtime_entry(
            path,
            path.parent()
                .ok_or(ScientificCpythonUnavailable::HostTampered)?,
            false,
        )
    }
    #[cfg(not(windows))]
    {
        // A selected venv interpreter may be a symlink. The inode and ctime of
        // its actual executable still detect replacement without discarding the
        // venv path used to launch it.
        let metadata =
            fs::metadata(path).map_err(|_| ScientificCpythonUnavailable::HostTampered)?;
        if !metadata.is_file() {
            return Err(ScientificCpythonUnavailable::HostTampered);
        }
        super::runtime_path_snapshot(path, Path::new("interpreter"), &metadata)
    }
}

#[cfg(all(test, any(unix, windows)))]
mod tests {
    use super::*;
    use std::fs::FileTimes;

    fn fixture() -> (tempfile::TempDir, HostIdentity, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let host_path = root.path().join("python");
        fs::write(&host_path, b"interpreter").unwrap();
        let site = root.path().join("site-packages");
        fs::create_dir_all(site.join("nirs4all")).unwrap();
        fs::create_dir_all(site.join("nirs4all-1.4.7.dist-info")).unwrap();
        fs::write(site.join("nirs4all/source.py"), b"original").unwrap();
        fs::write(site.join("nirs4all-1.4.7.dist-info/RECORD"), b"record").unwrap();
        (root, super::super::host_identity(&host_path).unwrap(), site)
    }

    #[test]
    fn selected_library_detects_same_size_writes_with_restored_mtime() {
        let (_root, host, site) = fixture();
        let identity = SelectedLibraryIdentity::capture(&host, &site).unwrap();
        for _ in 0..5 {
            identity.verify().unwrap();
        }
        let member = site.join("nirs4all/source.py");
        let modified = fs::metadata(&member).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        fs::write(&member, b"tampered").unwrap();
        fs::File::options()
            .write(true)
            .open(&member)
            .unwrap()
            .set_times(FileTimes::new().set_modified(modified))
            .unwrap();
        assert_eq!(
            identity.verify(),
            Err(ScientificCpythonUnavailable::DistributionTampered)
        );
    }

    #[test]
    fn selected_library_detects_additions_metadata_and_interpreter_replacement() {
        for target in ["nirs4all/new.py", "nirs4all-1.4.7.dist-info/RECORD"] {
            let (_root, host, site) = fixture();
            let identity = SelectedLibraryIdentity::capture(&host, &site).unwrap();
            fs::write(site.join(target), b"changed").unwrap();
            assert_eq!(
                identity.verify(),
                Err(ScientificCpythonUnavailable::DistributionTampered)
            );
        }
        let (_root, host, site) = fixture();
        let identity = SelectedLibraryIdentity::capture(&host, &site).unwrap();
        let replacement = host.canonical_path.with_extension("replacement");
        fs::write(&replacement, b"interpreter").unwrap();
        fs::rename(replacement, &host.canonical_path).unwrap();
        assert_eq!(
            identity.verify(),
            Err(ScientificCpythonUnavailable::HostTampered)
        );
    }
}
