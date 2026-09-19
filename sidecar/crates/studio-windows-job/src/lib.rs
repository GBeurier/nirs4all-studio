//! Safe, narrow ownership wrapper for one Windows kill-on-close Job Object.
//!
//! Studio launches an internal supervisor, assigns that supervisor to the Job
//! before it can spawn Python, and keeps this guard alive until Python exits.

#![cfg(windows)]

#[allow(unsafe_code)]
mod imp {
    use std::{ffi::OsString, io, mem, os::windows::ffi::OsStringExt, path::PathBuf, ptr};

    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            SystemInformation::GetSystemWindowsDirectoryW,
            Threading::GetCurrentProcess,
        },
    };

    /// Identity and change marker for a file or directory, read from one handle.
    /// ChangeTime is distinct from creation time and cannot be hidden by merely
    /// restoring LastWriteTime after changing the contents.
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct FileChangeStamp {
        pub volume: u64,
        pub file_id: u128,
        pub size: u64,
        pub modified: i64,
        pub changed: i64,
    }

    pub fn file_change_stamp(path: &std::path::Path) -> io::Result<FileChangeStamp> {
        use std::{
            fs::OpenOptions,
            os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
        };
        use windows_sys::Win32::Storage::FileSystem::{
            FileBasicInfo, FileIdInfo, GetFileInformationByHandleEx, FILE_ATTRIBUTE_REPARSE_POINT,
            FILE_BASIC_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_ID_INFO, FILE_READ_ATTRIBUTES,
        };
        let file = OpenOptions::new()
            .access_mode(FILE_READ_ATTRIBUTES)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let mut basic = FILE_BASIC_INFO::default();
        let mut identity = FILE_ID_INFO::default();
        // SAFETY: the handle is owned by `file`, both output structures are
        // initialized and have the exact size for their information classes.
        // Windows writes synchronously and does not retain these pointers.
        let basic_ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileBasicInfo,
                ptr::from_mut(&mut basic).cast(),
                mem::size_of::<FILE_BASIC_INFO>() as u32,
            )
        };
        if basic_ok == 0 {
            return Err(io::Error::last_os_error());
        }
        if basic.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::other("runtime entry is a reparse point"));
        }
        // SAFETY: identical ownership and output-buffer contract to the call above.
        let id_ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileIdInfo,
                ptr::from_mut(&mut identity).cast(),
                mem::size_of::<FILE_ID_INFO>() as u32,
            )
        };
        if id_ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(FileChangeStamp {
            volume: identity.VolumeSerialNumber,
            file_id: u128::from_le_bytes(identity.FileId.Identifier),
            size: file.metadata()?.len(),
            modified: basic.LastWriteTime,
            changed: basic.ChangeTime,
        })
    }

    /// Return the Windows installation directory reported by the operating
    /// system, independently from caller-controlled environment variables.
    pub fn system_windows_directory() -> io::Result<PathBuf> {
        let mut buffer = vec![0_u16; 260];
        loop {
            let capacity = u32::try_from(buffer.len())
                .map_err(|_| io::Error::other("Windows directory path is too large"))?;
            // SAFETY: `buffer` owns `capacity` writable UTF-16 elements for the
            // duration of the call. The API reports either the copied length or
            // the required capacity and never retains the pointer.
            let written = unsafe { GetSystemWindowsDirectoryW(buffer.as_mut_ptr(), capacity) };
            if written == 0 {
                return Err(io::Error::last_os_error());
            }
            let written = usize::try_from(written)
                .map_err(|_| io::Error::other("Windows directory path is too large"))?;
            if written < buffer.len() {
                buffer.truncate(written);
                return Ok(PathBuf::from(OsString::from_wide(&buffer)));
            }
            buffer.resize(
                written
                    .checked_add(1)
                    .ok_or_else(|| io::Error::other("Windows directory path is too large"))?,
                0,
            );
        }
    }

    /// Owned Job Object configured to terminate all members on last-handle close.
    ///
    /// Once the current process is assigned, dropping this guard terminates that
    /// process too. The Studio launcher therefore retains it until
    /// `std::process::exit`, which lets the OS close the handle during exit.
    #[must_use]
    pub struct KillOnCloseJob(HANDLE);

    impl KillOnCloseJob {
        /// Create a Job Object and assign the current process before it spawns children.
        pub fn assign_current_process() -> Result<Self, String> {
            // SAFETY: null security/name pointers request an unnamed Job Object;
            // every returned handle is immediately wrapped for deterministic close.
            let raw = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
            if raw.is_null() {
                return Err(format!(
                    "could not create converter Job Object: {}",
                    io::Error::last_os_error()
                ));
            }
            let job = Self(raw);
            // SAFETY: this all-zero Win32 value is initialized before the one
            // documented limit flag below is set.
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: `job` and `limits` remain live for the call and the byte
            // size exactly matches JOBOBJECT_EXTENDED_LIMIT_INFORMATION.
            let configured = unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    ptr::from_ref(&limits).cast(),
                    u32::try_from(mem::size_of_val(&limits)).expect("Win32 job limits fit in u32"),
                )
            };
            if configured == 0 {
                return Err(format!(
                    "could not configure converter Job Object: {}",
                    io::Error::last_os_error()
                ));
            }
            // SAFETY: GetCurrentProcess returns the documented pseudo-handle,
            // valid for assignment during this call. No converter child exists.
            let assigned = unsafe { AssignProcessToJobObject(job.0, GetCurrentProcess()) };
            if assigned == 0 {
                return Err(format!(
                    "could not assign converter launcher to Job Object: {}",
                    io::Error::last_os_error()
                ));
            }
            Ok(job)
        }

        /// Exact Job Object limit required by the Studio containment contract.
        #[must_use]
        pub const fn limit_flags() -> u32 {
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        }
    }

    impl Drop for KillOnCloseJob {
        fn drop(&mut self) {
            // SAFETY: the constructor stores one live owned Job Object handle,
            // and Drop is its only close site.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

pub use imp::{file_change_stamp, system_windows_directory, FileChangeStamp, KillOnCloseJob};

#[cfg(test)]
mod tests {
    use super::{file_change_stamp, system_windows_directory, KillOnCloseJob};

    #[test]
    fn change_marker_detects_same_size_edit_with_restored_mtime() {
        use std::{
            fs,
            time::{Duration, SystemTime, UNIX_EPOCH},
        };
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-change-stamp-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("runtime-member.py");
        fs::write(&path, "VALUE = 1\n").unwrap();
        let before = file_change_stamp(&path).unwrap();
        assert_eq!(before, file_change_stamp(&path).unwrap());
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(&path, "VALUE = 2\n").unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let after = file_change_stamp(&path).unwrap();
        assert_eq!(before.size, after.size);
        assert_eq!(before.modified, after.modified);
        assert_eq!(before.file_id, after.file_id);
        assert_ne!(before.changed, after.changed);
        // Directory entries must carry stable identity and a genuine marker too.
        let parent = file_change_stamp(&directory).unwrap();
        assert!(parent.changed > 0);
        assert_eq!(parent, file_change_stamp(&directory).unwrap());
        fs::rename(&path, directory.join("old.py")).unwrap();
        fs::write(&path, "VALUE = 2\n").unwrap();
        assert_ne!(after.file_id, file_change_stamp(&path).unwrap().file_id);
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn containment_contract_uses_kill_on_last_handle_close_without_breakaway() {
        assert_eq!(KillOnCloseJob::limit_flags(), 0x0000_2000);
        assert_eq!(KillOnCloseJob::limit_flags() & 0x0000_1800, 0);
    }

    #[test]
    fn system_directory_comes_from_windows_and_contains_system32() {
        let root = system_windows_directory().unwrap();
        assert!(root.is_absolute());
        assert!(root.join("System32").is_dir());
    }
}
