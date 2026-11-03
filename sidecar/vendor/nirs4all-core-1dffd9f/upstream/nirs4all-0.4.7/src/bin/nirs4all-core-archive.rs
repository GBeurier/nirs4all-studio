//! Command-line transport over the same dispatcher shipped in host bindings.
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, ExitStatus};

const WORKER_ROOT: &str = "NIRS4ALL_CORE_ARCHIVE_WORKER_ROOT";
const ROOT_PREFIX: &str = "nirs4all-core-archive-";

fn execute() -> ExitCode {
    match nirs4all::archive_command::execute_archive_command(std::env::args_os().skip(1)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Core archive refusal: {error}");
            ExitCode::FAILURE
        }
    }
}

fn is_link_or_reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    false
}

fn validate_worker_root(root: &Path) -> io::Result<()> {
    let metadata = std::fs::symlink_metadata(root)?;
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if !metadata.is_dir()
        || is_link_or_reparse(&metadata)
        || !name.starts_with(ROOT_PREFIX)
        || !root.is_absolute()
        || ["TMPDIR", "TMP", "TEMP"]
            .iter()
            .any(|key| std::env::var_os(key).as_deref() != Some(root.as_os_str()))
        || std::fs::canonicalize(tempfile::env::temp_dir())? != std::fs::canonicalize(root)?
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid private CLI worker directory",
        ));
    }
    Ok(())
}

// The child has exited. Only this parent's fresh private tree is visited.
// Symlinks/reparse points are never followed when clearing READONLY.
#[cfg(windows)]
fn clear_owned_readonly(path: &Path) -> io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    let metadata = std::fs::symlink_metadata(path)?;
    if is_link_or_reparse(&metadata) {
        return Ok(());
    }
    if metadata.is_dir() {
        for entry in std::fs::read_dir(path)? {
            clear_owned_readonly(&entry?.path())?;
        }
    } else if metadata.is_file() {
        const FILE_READ_ATTRIBUTES: u32 = 0x80;
        const FILE_WRITE_ATTRIBUTES: u32 = 0x100;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        let file = std::fs::OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let metadata = file.metadata()?;
        if metadata.is_file() && !is_link_or_reparse(&metadata) && metadata.permissions().readonly()
        {
            let mut permissions = metadata.permissions();
            // This Windows-only function clears READONLY on a checked private
            // file handle; Unix permission bits cannot be affected here.
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            file.set_permissions(permissions)?;
        }
    }
    Ok(())
}

fn supervise(mut worker: Command) -> io::Result<ExitStatus> {
    let directory = tempfile::Builder::new().prefix(ROOT_PREFIX).tempdir()?;
    let root = std::fs::canonicalize(directory.path())?;
    worker.env(WORKER_ROOT, &root);
    for key in ["TMPDIR", "TMP", "TEMP"] {
        worker.env(key, &root);
    }
    let result = worker.status();
    // No Methods handle is ever opened in this parent process.
    #[cfg(windows)]
    clear_owned_readonly(directory.path())?;
    directory.close()?;
    result
}

fn status_code(status: ExitStatus) -> ExitCode {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return ExitCode::from((128 + signal) as u8);
        }
    }
    ExitCode::from(
        status
            .code()
            .and_then(|code| u8::try_from(code).ok())
            .unwrap_or(1),
    )
}

fn main() -> ExitCode {
    if let Some(root) = std::env::var_os(WORKER_ROOT) {
        if let Err(error) = validate_worker_root(&PathBuf::from(root)) {
            eprintln!("Core archive transport refusal: {error}");
            return ExitCode::FAILURE;
        }
        return execute();
    }
    let result = std::env::current_exe().and_then(|executable| {
        let mut worker = Command::new(executable);
        worker.args(std::env::args_os().skip(1));
        // status() inherits stdin/stdout/stderr; cwd and argv remain unchanged.
        supervise(worker)
    });
    match result {
        Ok(status) => status_code(status),
        Err(error) => {
            eprintln!("Core archive transport refusal: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const MODE: &str = "NIRS4ALL_CORE_ARCHIVE_LIFECYCLE_TEST_MODE";
    const REPORT: &str = "NIRS4ALL_CORE_ARCHIVE_LIFECYCLE_TEST_REPORT";

    // A subprocess-only witness emulates the static directory surviving exit.
    // It does not claim to load a real Methods library or qualify predictions.
    #[test]
    fn worker_fixture() {
        let Some(mode) = std::env::var_os(MODE) else {
            return;
        };
        let root = PathBuf::from(std::env::var_os(WORKER_ROOT).unwrap());
        validate_worker_root(&root).unwrap();
        let snapshot = tempfile::Builder::new()
            .prefix("nirs4all-core-libn4m-")
            .tempdir_in(&root)
            .unwrap()
            .keep();
        let library = snapshot.join("methods.fixture");
        std::fs::write(&library, b"readonly snapshot witness").unwrap();
        let mut permissions = std::fs::metadata(&library).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&library, permissions).unwrap();
        std::fs::write(
            PathBuf::from(std::env::var_os(REPORT).unwrap()),
            root.to_string_lossy().as_bytes(),
        )
        .unwrap();
        std::process::exit(mode.to_string_lossy().parse().unwrap());
    }

    fn lifecycle(exit: i32) {
        let report = tempfile::tempdir().unwrap();
        let report_path = report.path().join("root.txt");
        let mut worker = Command::new(std::env::current_exe().unwrap());
        worker
            .args(["--exact", "tests::worker_fixture", "--nocapture"])
            .env(MODE, exit.to_string())
            .env(REPORT, &report_path);
        let status = supervise(worker).unwrap();
        assert_eq!(status.code(), Some(exit));
        let root = PathBuf::from(std::fs::read_to_string(report_path).unwrap());
        assert!(
            !root.exists(),
            "private snapshot tree remains after child exit"
        );
    }

    #[test]
    fn success_closes_owned_snapshot_tree() {
        lifecycle(0);
    }
    #[test]
    fn refusal_closes_owned_snapshot_tree_and_preserves_exit() {
        lifecycle(1);
    }

    #[cfg(windows)]
    #[test]
    fn windows_cleanup_does_not_change_symlink_target_readonly() {
        use std::os::windows::fs::symlink_file;
        let owned = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("outside.fixture");
        std::fs::write(&target, b"outside").unwrap();
        symlink_file(&target, owned.path().join("link.fixture")).unwrap();
        let mut permissions = std::fs::metadata(&target).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&target, permissions).unwrap();
        clear_owned_readonly(owned.path()).unwrap();
        assert!(std::fs::metadata(&target).unwrap().permissions().readonly());
        owned.close().unwrap();
        let mut permissions = std::fs::metadata(&target).unwrap().permissions();
        // Windows-only private fixture cleanup; no Unix permission bits exist.
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(&target, permissions).unwrap();
    }
}
