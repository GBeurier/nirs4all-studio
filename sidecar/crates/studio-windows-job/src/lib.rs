//! Safe, narrow ownership wrapper for one Windows kill-on-close Job Object.
//!
//! Studio launches an internal supervisor, assigns that supervisor to the Job
//! before it can spawn Python, and keeps this guard alive until Python exits.

#![cfg(windows)]

#[allow(unsafe_code)]
mod imp {
    use std::{io, mem, ptr};

    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::GetCurrentProcess,
        },
    };

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

pub use imp::KillOnCloseJob;

#[cfg(test)]
mod tests {
    use super::KillOnCloseJob;

    #[test]
    fn containment_contract_uses_kill_on_last_handle_close_without_breakaway() {
        assert_eq!(KillOnCloseJob::limit_flags(), 0x0000_2000);
        assert_eq!(KillOnCloseJob::limit_flags() & 0x0000_1800, 0);
    }
}
