#![no_main]

use std::fs;

use libfuzzer_sys::fuzz_target;

const MAX_INPUT_BYTES: usize = 2 * 1024 * 1024;

fuzz_target!(|bytes: &[u8]| {
    if bytes.len() > MAX_INPUT_BYTES {
        return;
    }

    let Ok(workspace) = tempfile::tempdir() else {
        return;
    };
    if fs::write(workspace.path().join("store.sqlite"), bytes).is_err() {
        return;
    }

    // Use the sidecar's canonical immutable/read-only Store v5 preflight. The
    // target deliberately contains no SQLite or WorkspaceStore validation.
    let _ = studio_sidecar::workspace_store::preflight_run_detail_projection(workspace.path());
});
