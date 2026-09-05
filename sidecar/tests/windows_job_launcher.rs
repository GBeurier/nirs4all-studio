#![cfg(windows)]

use std::{
    fs,
    process::{Command, ExitStatus},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use studio_sidecar::legacy_conversion::WINDOWS_JOB_LAUNCHER_ARGUMENT;
use studio_sidecar::scientific_cpython::WINDOWS_SCIENTIFIC_JOB_LAUNCHER_ARGUMENT;

fn temporary_directory(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "studio-sidecar-windows-job-{name}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

fn wait_bounded(command: &mut Command) -> ExitStatus {
    let mut child = command.spawn().unwrap();
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if started.elapsed() >= Duration::from_secs(10) {
            let _ = child.kill();
            panic!("internal Windows Job launcher exceeded its test deadline");
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn internal_job_launcher_preserves_converter_exit_code() {
    let status = wait_bounded(Command::new(env!("CARGO_BIN_EXE_studio-sidecar")).args([
        WINDOWS_JOB_LAUNCHER_ARGUMENT,
        "cmd.exe",
        "/D",
        "/C",
        "exit /B 20",
    ]));
    assert_eq!(status.code(), Some(20));
}

#[test]
fn kill_on_close_contains_descendant_that_outlives_converter_root() {
    let root = temporary_directory("descendant");
    let sentinel = root.join("escaped.txt");
    let descendant = root.join("descendant.cmd");
    let converter = root.join("converter.cmd");
    fs::write(
        &descendant,
        format!(
            "@ping -n 3 127.0.0.1 >NUL\r\n@echo escaped>\"{}\"\r\n",
            sentinel.display()
        ),
    )
    .unwrap();
    fs::write(
        &converter,
        format!(
            "@start \"\" /B cmd.exe /D /C call \"{}\"\r\n@exit /B 0\r\n",
            descendant.display()
        ),
    )
    .unwrap();

    let status = wait_bounded(
        Command::new(env!("CARGO_BIN_EXE_studio-sidecar"))
            .args([WINDOWS_JOB_LAUNCHER_ARGUMENT, "cmd.exe", "/D", "/C", "call"])
            .arg(&converter),
    );
    assert!(status.success());
    thread::sleep(Duration::from_secs(4));
    assert!(
        !sentinel.exists(),
        "a converter descendant escaped the kill-on-close Job Object"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn terminating_scientific_launcher_contains_running_worker_and_descendants() {
    let root = temporary_directory("terminated-scientific-tree");
    let sentinel = root.join("escaped-after-termination.txt");
    let descendant = root.join("delayed-descendant.cmd");
    let converter = root.join("long-converter.cmd");
    fs::write(
        &descendant,
        format!(
            "@ping -n 3 127.0.0.1 >NUL\r\n@echo escaped>\"{}\"\r\n",
            sentinel.display()
        ),
    )
    .unwrap();
    fs::write(
        &converter,
        format!(
            "@start \"\" /B cmd.exe /D /C call \"{}\"\r\n@ping -n 30 127.0.0.1 >NUL\r\n",
            descendant.display()
        ),
    )
    .unwrap();
    let mut launcher = Command::new(env!("CARGO_BIN_EXE_studio-sidecar"))
        .args([
            WINDOWS_SCIENTIFIC_JOB_LAUNCHER_ARGUMENT,
            "cmd.exe",
            "/D",
            "/C",
            "call",
        ])
        .arg(&converter)
        .spawn()
        .unwrap();
    thread::sleep(Duration::from_millis(300));

    launcher.kill().unwrap();
    let started = Instant::now();
    while launcher.try_wait().unwrap().is_none() {
        assert!(started.elapsed() < Duration::from_secs(5));
        thread::sleep(Duration::from_millis(20));
    }
    thread::sleep(Duration::from_secs(4));
    assert!(
        !sentinel.exists(),
        "terminating the scientific launcher did not contain its Job Object descendants"
    );
    fs::remove_dir_all(root).unwrap();
}
