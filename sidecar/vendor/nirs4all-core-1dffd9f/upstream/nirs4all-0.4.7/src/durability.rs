#[cfg(not(windows))]
use std::fs::File;
use std::io;
use std::path::Path;

/// Flush directory metadata after an atomic publication.
///
/// Windows requires directory handles to be opened with
/// `FILE_FLAG_BACKUP_SEMANTICS`.  The handle also needs write access for
/// `FlushFileBuffers`, which is what `File::sync_all` uses.  A plain
/// `File::open(directory)` therefore fails with `ERROR_ACCESS_DENIED` even
/// when the caller may create files in that directory.
#[cfg(windows)]
pub(crate) fn sync_directory(path: &Path) -> io::Result<()> {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

    OpenOptions::new()
        .write(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?
        .sync_all()
}

#[cfg(not(windows))]
pub(crate) fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::sync_directory;

    #[test]
    fn directory_metadata_can_be_flushed_after_publication() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "nirs4all-core-directory-sync-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir(&directory).unwrap();
        let published = directory.join("published.n4a");
        std::fs::write(&published, b"archive").unwrap();

        sync_directory(&directory).unwrap();

        std::fs::remove_file(published).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
