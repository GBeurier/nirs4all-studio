use std::{env, process::ExitCode};

#[cfg(windows)]
use std::process;

use studio_sidecar::{serve, smoke_readiness_json};

fn main() -> ExitCode {
    #[cfg(windows)]
    maybe_run_internal_windows_job_launcher();
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("studio-sidecar: {message}");
            ExitCode::from(2)
        }
    }
}

#[cfg(windows)]
fn maybe_run_internal_windows_job_launcher() {
    use std::ffi::OsStr;

    let mut arguments = env::args_os().skip(1);
    let launcher_argument = arguments.next();
    if !matches!(
        launcher_argument.as_deref(),
        Some(argument)
            if argument == OsStr::new(studio_sidecar::legacy_conversion::WINDOWS_JOB_LAUNCHER_ARGUMENT)
                || argument == OsStr::new(studio_sidecar::scientific_cpython::WINDOWS_SCIENTIFIC_JOB_LAUNCHER_ARGUMENT)
    ) {
        return;
    }
    let Some(executable) = arguments.next() else {
        eprintln!("studio-sidecar: internal converter Job launcher is missing its executable");
        process::exit(70);
    };
    match studio_sidecar::legacy_conversion::run_windows_job_launcher(&executable, arguments) {
        Ok(never) => match never {},
        Err(error) => {
            eprintln!("studio-sidecar: {error}");
            process::exit(70);
        }
    }
}

fn run() -> Result<(), String> {
    let mut host = "127.0.0.1".to_owned();
    let mut port = 0_u16;
    let mut arguments = env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--smoke-readiness" => {
                println!("{}", smoke_readiness_json());
                return Ok(());
            }
            "--host" => host = arguments.next().ok_or("--host requires a value")?,
            "--port" => {
                let value = arguments.next().ok_or("--port requires a value")?;
                port = value
                    .parse()
                    .map_err(|_| "--port must be an unsigned 16-bit integer")?;
            }
            "--help" | "-h" => {
                println!("Usage: studio-sidecar [--host 127.0.0.1|::1] [--port PORT] [--smoke-readiness]");
                return Ok(());
            }
            _ => return Err(format!("unknown argument: {argument}")),
        }
    }
    if host != "127.0.0.1" && host != "::1" {
        return Err("--host must be a loopback address (127.0.0.1 or ::1)".into());
    }
    serve(&host, port).map_err(|error| error.to_string())
}
