use std::{env, process::ExitCode};

use studio_sidecar::{serve, smoke_readiness_json};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("studio-sidecar: {message}");
            ExitCode::from(2)
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
