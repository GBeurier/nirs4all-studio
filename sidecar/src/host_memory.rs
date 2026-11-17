//! The only bound on how much data Studio buffers for one operation: the
//! memory this computer can spare when the operation runs.
//!
//! Studio imposes no content-size or entry-count ceiling of its own. Where it
//! must protect itself from an untrusted or runaway producer (a request body,
//! the output of a Python worker, a file it reads into memory), it refuses only
//! a payload larger than [`allowance`]: a quarter of the memory available now.
//! The quarter leaves room for the copies one payload takes while it is read,
//! parsed and re-encoded, and for the rest of the desktop.

/// Share of the available memory one buffered payload may occupy.
const PAYLOAD_SHARE: u64 = 4;

/// Bytes one buffered payload may occupy now.
///
/// When the operating system does not report its memory, Studio does not
/// invent a number: nothing but the allocator bounds the payload.
#[must_use]
pub fn allowance() -> usize {
    available_bytes().map_or(usize::MAX, |bytes| {
        usize::try_from(bytes / PAYLOAD_SHARE).unwrap_or(usize::MAX)
    })
}

/// [`allowance`] as a file or stream length.
#[must_use]
pub fn allowance_u64() -> u64 {
    u64::try_from(allowance()).unwrap_or(u64::MAX)
}

/// Explains a refusal by [`allowance`]: what happened and what the user can do.
#[must_use]
pub fn exceeded(subject: &str) -> String {
    exceeded_with(subject, allowance())
}

fn exceeded_with(subject: &str, allowance: usize) -> String {
    let megabytes = allowance / (1024 * 1024);
    format!(
        "{subject} needs more memory than this computer can spare right now \
         (Studio can use about {megabytes} MB for it). Close other applications \
         to free memory, or work on a smaller selection, then try again."
    )
}

/// Reads `reader` to its end unless it holds more than `limit` bytes, in which
/// case nothing is parsed and `None` is returned. Callers pass [`allowance_u64`].
///
/// # Errors
///
/// Propagates read failures.
pub fn read_within(reader: impl std::io::Read, limit: u64) -> std::io::Result<Option<Vec<u8>>> {
    use std::io::Read as _;
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    Ok((u64::try_from(bytes.len()).unwrap_or(u64::MAX) <= limit).then_some(bytes))
}

/// Physical memory the operating system reports as available now.
#[must_use]
pub fn available_bytes() -> Option<u64> {
    platform::available_bytes()
}

#[cfg(target_os = "linux")]
mod platform {
    use std::fs;

    pub fn available_bytes() -> Option<u64> {
        let meminfo = fs::read_to_string("/proc/meminfo").ok()?;
        let available = parse_meminfo_available(&meminfo)?;
        // A container's memory controller can grant less than the machine has.
        Some(cgroup_headroom().map_or(available, |headroom| available.min(headroom)))
    }

    pub(super) fn parse_meminfo_available(meminfo: &str) -> Option<u64> {
        meminfo.lines().find_map(|line| {
            let kibibytes = line.strip_prefix("MemAvailable:")?.trim();
            kibibytes
                .strip_suffix("kB")
                .unwrap_or(kibibytes)
                .trim()
                .parse::<u64>()
                .ok()?
                .checked_mul(1024)
        })
    }

    /// Memory the cgroup v2 controller still grants this process, if limited.
    fn cgroup_headroom() -> Option<u64> {
        let limit = fs::read_to_string("/sys/fs/cgroup/memory.max").ok()?;
        let limit = limit.trim().parse::<u64>().ok()?;
        let current = fs::read_to_string("/sys/fs/cgroup/memory.current")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(0);
        Some(limit.saturating_sub(current))
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{process::Command, sync::OnceLock};

    /// macOS reclaims inactive and compressed pages on demand, so its free page
    /// count understates what an allocation can obtain. Use the installed
    /// physical memory, read once.
    pub fn available_bytes() -> Option<u64> {
        static PHYSICAL: OnceLock<Option<u64>> = OnceLock::new();
        *PHYSICAL.get_or_init(|| {
            let output = Command::new("/usr/sbin/sysctl")
                .args(["-n", "hw.memsize"])
                .output()
                .ok()
                .filter(|output| output.status.success())?;
            String::from_utf8(output.stdout).ok()?.trim().parse().ok()
        })
    }
}

#[cfg(windows)]
mod platform {
    pub fn available_bytes() -> Option<u64> {
        studio_windows_job::available_physical_memory().ok()
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
mod platform {
    pub const fn available_bytes() -> Option<u64> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_allowance_is_a_share_of_the_memory_available_now() {
        let available = available_bytes().expect("the test platforms report their memory");
        assert!(available > 0);
        let allowance = allowance_u64();
        // Memory moves between the two reads; the share is what matters.
        assert!(allowance <= available / PAYLOAD_SHARE * 2);
        assert!(allowance >= available / PAYLOAD_SHARE / 2);
        // Far above every ceiling Studio used to impose (at most 512 MiB).
        assert!(allowance > 32 * 1024 * 1024);
    }

    #[test]
    fn a_refusal_says_what_happened_and_what_to_do() {
        let message = exceeded_with("The Playground result", 3 * 1024 * 1024 * 1024);
        assert!(message.starts_with("The Playground result needs more memory"));
        assert!(message.contains("about 3072 MB"));
        assert!(message.contains("Close other applications"));
    }

    #[test]
    fn a_reader_beyond_the_limit_is_refused_without_a_prefix() {
        assert_eq!(
            read_within(&b"12345"[..], 5).unwrap(),
            Some(b"12345".to_vec())
        );
        assert_eq!(read_within(&b"123456"[..], 5).unwrap(), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn meminfo_available_is_read_in_bytes() {
        let meminfo =
            "MemTotal:       65000000 kB\nMemFree:  1000 kB\nMemAvailable:   62914560 kB\n";
        assert_eq!(
            platform::parse_meminfo_available(meminfo),
            Some(62_914_560 * 1024)
        );
        assert_eq!(platform::parse_meminfo_available("MemTotal: 1 kB\n"), None);
    }
}
