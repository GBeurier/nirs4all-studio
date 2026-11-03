//! Publish a verified staged directory without replacing an existing target.

use std::fs;
use std::path::Path;

/// Reserve the destination exclusively, then publish only the verified stage.
///
/// POSIX replaces our own empty reservation with one atomic rename. Windows
/// moves the prepared members and publishes the experiment index last, so a
/// reader cannot open an incomplete experiment as a valid one.
pub fn publish_directory_noreplace(source: &Path, target: &Path) -> Result<(), String> {
    if !fs::symlink_metadata(source)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_dir()
    {
        return Err("publication source must be a regular directory".into());
    }
    #[cfg(not(windows))]
    let publish = |source: &Path, target: &Path| fs::rename(source, target);
    #[cfg(windows)]
    let publish = publish_members;
    publish_reserved_directory(source, target, publish)
}

fn publish_reserved_directory(
    source: &Path,
    target: &Path,
    publish: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    fs::create_dir(target)
        .map_err(|error| format!("cannot reserve publication {}: {error}", target.display()))?;
    let published = publish(source, target);
    if let Err(error) = published {
        // Another writer may have populated the reservation since create_dir.
        // Remove only an empty reservation; never recursively delete its files.
        let _ = fs::remove_dir(target);
        return Err(format!("directory publication failed: {error}"));
    }
    Ok(())
}

#[cfg(windows)]
fn publish_members(source: &Path, target: &Path) -> std::io::Result<()> {
    let mut entries = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| (entry.file_name() == "experiment.json", entry.file_name()));
    let mut moved = Vec::new();
    for entry in entries {
        let origin = entry.path();
        let destination = target.join(entry.file_name());
        if let Err(error) = fs::rename(&origin, &destination) {
            // Restore only members moved by this invocation. A competing
            // writer's entries remain untouched when the reservation fails.
            for (origin, destination) in moved.iter().rev() {
                let _ = fs::rename(destination, origin);
            }
            return Err(error);
        }
        moved.push((origin, destination));
    }
    // The complete verified index is already published. An empty-stage cleanup
    // failure must not turn this success into an error with published outputs.
    let _ = fs::remove_dir(source);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{publish_directory_noreplace, publish_reserved_directory};
    use std::fs;

    #[test]
    fn exclusive_reservation_preserves_existing_empty_destination() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("stage");
        let target = root.path().join("existing");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("experiment.json"), b"verified").unwrap();
        fs::create_dir(&target).unwrap();
        assert!(publish_directory_noreplace(&source, &target).is_err());
        assert!(target.is_dir());
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
        assert_eq!(
            fs::read(source.join("experiment.json")).unwrap(),
            b"verified"
        );
    }

    #[test]
    fn verified_directory_becomes_visible_at_a_new_destination() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("stage");
        let target = root.path().join("new");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("experiment.json"), b"verified").unwrap();
        fs::write(source.join("model.n4a"), b"model").unwrap();
        publish_directory_noreplace(&source, &target).unwrap();
        assert!(!source.exists());
        assert_eq!(
            fs::read(target.join("experiment.json")).unwrap(),
            b"verified"
        );
        assert_eq!(fs::read(target.join("model.n4a")).unwrap(), b"model");
    }

    #[test]
    fn failed_publish_preserves_files_added_to_the_reservation() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("stage");
        let target = root.path().join("reservation");
        fs::create_dir(&source).unwrap();
        // Populate the reservation between the actual exclusive reserve and
        // its failed publication. Exercise the publisher's own cleanup path.
        assert!(publish_reserved_directory(&source, &target, |_, reserved| {
            fs::write(reserved.join("other-writer"), b"foreign")?;
            Err(std::io::Error::other("raced publication"))
        })
        .is_err());
        assert_eq!(fs::read(target.join("other-writer")).unwrap(), b"foreign");
        assert!(source.is_dir());
    }
}
