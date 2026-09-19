//! Two reusable interactive workers. Training keeps its dedicated job process.
use super::{
    request_limits, scientific_worker_command_with_script, terminate_worker,
    validate_worker_response, verify_identity, verify_packaged_runtime_identity,
    CpythonScientificJobExecutor, HostIdentity, PackagedRuntimeIdentity,
    ScientificCpythonUnavailable, ScratchDirectory, EXECUTION_SCRIPT,
    MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES,
};
use serde_json::Value;
use std::{
    io::BufReader,
    process::{Child, ChildStdin},
    sync::mpsc::{self, Receiver},
};
use std::{
    io::{Read, Write},
    path::Path,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;

/// Filesystem notifications invalidate the installation validation, not user
/// requests. Unsupported watchers retain exhaustive request-time validation.
pub(super) struct RuntimeChanges {
    generation: Arc<AtomicUsize>,
    healthy: Arc<AtomicBool>,
    validated: Mutex<Option<usize>>,
    _watcher: Mutex<notify::RecommendedWatcher>,
}

impl std::fmt::Debug for RuntimeChanges {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeChanges")
            .field("generation", &self.generation.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

impl RuntimeChanges {
    pub(super) fn watch(root: &Path) -> Option<Arc<Self>> {
        use notify::Watcher;
        let package = root.parent()?.to_owned();
        let observed = package.clone();
        let generation = Arc::new(AtomicUsize::new(0));
        let healthy = Arc::new(AtomicBool::new(true));
        let changed = generation.clone();
        let health = healthy.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
                Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                    if event.need_rescan()
                        || event.paths.iter().any(|path| path.starts_with(&observed))
                    {
                        changed.fetch_add(1, Ordering::AcqRel);
                    }
                }
                Err(_) => {
                    health.store(false, Ordering::Release);
                    changed.fetch_add(1, Ordering::AcqRel);
                }
                _ => {}
            })
            .ok()?;
        watcher
            .watch(&package, notify::RecursiveMode::Recursive)
            .ok()?;
        if let Some(parent) = package.parent() {
            watcher
                .watch(parent, notify::RecursiveMode::NonRecursive)
                .ok()?;
        }
        Some(Arc::new(Self {
            generation,
            healthy,
            validated: Mutex::new(None),
            _watcher: Mutex::new(watcher),
        }))
    }

    pub(super) fn validate(
        &self,
        runtime: &PackagedRuntimeIdentity,
    ) -> Result<usize, ScientificCpythonUnavailable> {
        let generation = self.generation.load(Ordering::Acquire);
        let mut validated = self
            .validated
            .lock()
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
        if !self.healthy.load(Ordering::Acquire) || *validated != Some(generation) {
            verify_packaged_runtime_identity(runtime)?;
            if self.generation.load(Ordering::Acquire) != generation {
                return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
            }
            *validated = Some(generation);
        }
        drop(validated);
        Ok(generation)
    }
}

/// Reuse the exact one-shot dispatcher and bootstrap checks with framed stdio.
fn worker_script() -> String {
    let (prefix, rest) = EXECUTION_SCRIPT
        .split_once("raw=sys.stdin.buffer.read(33554433)")
        .expect("worker input boundary");
    let (_, bootstrap) = rest
        .split_once("distribution=importlib.metadata.distribution")
        .expect("distribution bootstrap");
    let (bootstrap, dispatch) = bootstrap
        .split_once("import contextlib\n")
        .expect("dispatcher boundary");
    let dispatch = dispatch.replace("sys.stdout.buffer.write(encoded)",
        "sys.stdout.buffer.write(len(encoded).to_bytes(4, 'little'))\nsys.stdout.buffer.write(encoded)\nsys.stdout.buffer.flush()");
    format!("{prefix}distribution=importlib.metadata.distribution{bootstrap}import contextlib\nwhile True:\n    raw=sys.stdin.buffer.readline(33554434)\n    if not raw: break\n    if len(raw)>33554433 or not raw.endswith(b'\\n'):\n        raise RuntimeError('interactive request exceeds stdin budget')\n    request=json.loads(raw)\n{}\n",
        dispatch.lines().map(|line| format!("    {line}")).collect::<Vec<_>>().join("\n"))
}

pub(super) struct Worker {
    child: Child,
    stdin: Option<ChildStdin>,
    responses: Receiver<Result<Vec<u8>, ScientificCpythonUnavailable>>,
    stderr_bytes: Arc<AtomicUsize>,
    completed: usize,
    generation: Option<usize>,
    _scratch: ScratchDirectory,
}

impl std::fmt::Debug for Worker {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("InteractiveWorker")
            .field("pid", &self.child.id())
            .field("completed", &self.completed)
            .finish_non_exhaustive()
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = terminate_worker(&mut self.child);
    }
}

impl Worker {
    /// The acquisition probe becomes the first worker: expensive library imports
    /// are paid once and retained for the first user interaction.
    pub(super) fn acquire(
        host: &HostIdentity,
        runtime: &PackagedRuntimeIdentity,
    ) -> Result<(Self, Vec<u8>), ScientificCpythonUnavailable> {
        let generation = runtime
            .changes
            .as_ref()
            .map(|changes| changes.validate(runtime))
            .transpose()?;
        let probe = serde_json::to_string(super::PREFLIGHT_SCRIPT)
            .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
        let dispatcher = serde_json::to_string(&worker_script())
            .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
        let script = format!("import contextlib,io,sys\n_capture=io.StringIO()\nwith contextlib.redirect_stdout(_capture):\n    exec({probe})\n_probe=_capture.getvalue().encode('utf-8')\nsys.stdout.buffer.write(len(_probe).to_bytes(4,'little'))\nsys.stdout.buffer.write(_probe)\nsys.stdout.buffer.flush()\nif not ready: raise SystemExit(0)\nsys.argv[2]=callable_path\nsys.argv[3]=callable_sha256\nexec({dispatcher})\n");
        let scratch = ScratchDirectory::create()?;
        let mut command = scientific_worker_command_with_script(
            host,
            host,
            Some(&runtime.site_packages),
            &scratch.path,
            &script,
        )?;
        command
            .env("OPENBLAS_NUM_THREADS", "1")
            .env("OMP_NUM_THREADS", "1")
            .env("MKL_NUM_THREADS", "1");
        let mut worker = Self::spawn_command(command, scratch)?;
        worker.generation = generation;
        let output = worker
            .responses
            .recv_timeout(super::SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => ScientificCpythonUnavailable::TimedOut,
                mpsc::RecvTimeoutError::Disconnected => {
                    ScientificCpythonUnavailable::OutputReadFailed
                }
            })??;
        if output.len() > super::MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES {
            return Err(ScientificCpythonUnavailable::StdoutTooLarge);
        }
        if let Some(changes) = &runtime.changes {
            if Some(changes.validate(runtime)?) != generation {
                return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
            }
        }
        Ok((worker, output))
    }

    fn spawn(
        host: &HostIdentity,
        callable: &HostIdentity,
        runtime: &PackagedRuntimeIdentity,
    ) -> Result<Self, ScientificCpythonUnavailable> {
        let scratch = ScratchDirectory::create()?;
        let mut command = scientific_worker_command_with_script(
            host,
            callable,
            Some(&runtime.site_packages),
            &scratch.path,
            &worker_script(),
        )?;
        // Interactive requests share the desktop. Prevent each small preview
        // from expanding into a full machine's BLAS thread pool.
        command
            .env("OPENBLAS_NUM_THREADS", "1")
            .env("OMP_NUM_THREADS", "1")
            .env("MKL_NUM_THREADS", "1");
        Self::spawn_command(command, scratch)
    }

    fn spawn_command(
        mut command: Command,
        scratch: ScratchDirectory,
    ) -> Result<Self, ScientificCpythonUnavailable> {
        let mut child = command
            .spawn()
            .map_err(|_| ScientificCpythonUnavailable::SpawnFailed)?;
        let (Some(stdin), Some(stdout), Some(mut stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            let _ = terminate_worker(&mut child);
            return Err(ScientificCpythonUnavailable::ProcessFailed);
        };
        let (sender, responses) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let result = (|| {
                    let mut header = [0_u8; 4];
                    reader
                        .read_exact(&mut header)
                        .map_err(|_| ScientificCpythonUnavailable::OutputReadFailed)?;
                    let size = u32::from_le_bytes(header) as usize;
                    if size > MAX_FRAME_BYTES {
                        return Err(ScientificCpythonUnavailable::StdoutTooLarge);
                    }
                    let mut output = vec![0_u8; size];
                    reader
                        .read_exact(&mut output)
                        .map_err(|_| ScientificCpythonUnavailable::OutputReadFailed)?;
                    Ok(output)
                })();
                let failed = result.is_err();
                if sender.send(result).is_err() || failed {
                    break;
                }
            }
        });
        let stderr_bytes = Arc::new(AtomicUsize::new(0));
        let diagnostic_size = stderr_bytes.clone();
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            while let Ok(count) = stderr.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                diagnostic_size.fetch_add(count, Ordering::AcqRel);
            }
        });
        Ok(Self {
            child,
            stdin: Some(stdin),
            responses,
            stderr_bytes,
            completed: 0,
            generation: None,
            _scratch: scratch,
        })
    }

    fn exchange(
        &mut self,
        input: &[u8],
        timeout: Duration,
    ) -> Result<Vec<u8>, ScientificCpythonUnavailable> {
        let mut stdin = self
            .stdin
            .take()
            .ok_or(ScientificCpythonUnavailable::ProcessFailed)?;
        let started = Instant::now();
        let stderr_before = self.stderr_bytes.load(Ordering::Acquire);
        let bytes = input.to_vec();
        let (write_sender, write_complete) = mpsc::sync_channel(1);
        let writer = std::thread::spawn(move || {
            let result = stdin
                .write_all(&bytes)
                .and_then(|()| stdin.write_all(b"\n"))
                .and_then(|()| stdin.flush());
            let _ = write_sender.send((stdin, result));
        });
        let output = match self.responses.recv_timeout(timeout) {
            Ok(value) => value,
            Err(mpsc::RecvTimeoutError::Timeout) => Err(ScientificCpythonUnavailable::TimedOut),
            Err(_) => Err(ScientificCpythonUnavailable::OutputReadFailed),
        };
        if output.is_err() {
            let _ = terminate_worker(&mut self.child);
        }
        let written = write_complete.recv_timeout(timeout.saturating_sub(started.elapsed()));
        if written.is_err() {
            let _ = terminate_worker(&mut self.child);
        }
        writer
            .join()
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        let (stdin, written) = written.map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => ScientificCpythonUnavailable::TimedOut,
            mpsc::RecvTimeoutError::Disconnected => ScientificCpythonUnavailable::ProcessFailed,
        })?;
        self.stdin = Some(stdin);
        let output = output?;
        written.map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        if self
            .stderr_bytes
            .load(Ordering::Acquire)
            .saturating_sub(stderr_before)
            > MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES
        {
            return Err(ScientificCpythonUnavailable::StderrTooLarge);
        }
        self.completed += 1;
        Ok(output)
    }
}

impl CpythonScientificJobExecutor {
    pub(super) fn run_interactive_request(
        &self,
        host: &HostIdentity,
        callable: &HostIdentity,
        runtime: &PackagedRuntimeIdentity,
        input: &[u8],
        timeout: Duration,
    ) -> Result<Value, ScientificCpythonUnavailable> {
        let request: Value = serde_json::from_slice(input)
            .map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?;
        let (input_limit, output_limit) = request_limits(&request);
        if input.len() > input_limit {
            return Err(ScientificCpythonUnavailable::InvalidRequest);
        }
        let expected_id = request
            .get("request_id")
            .or_else(|| request.get("job_id"))
            .and_then(Value::as_str)
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
        let start = Instant::now();
        loop {
            for slot in &self.warm_workers {
                if let Ok(mut slot) = slot.try_lock() {
                    let result = (|| {
                        let generation = if let Some(changes) = &runtime.changes {
                            Some(changes.validate(runtime)?)
                        } else {
                            verify_identity(host)?;
                            verify_identity(callable)?;
                            verify_packaged_runtime_identity(runtime)?;
                            None
                        };
                        let expired = match slot.as_mut() {
                            Some(worker) => {
                                worker.generation != generation
                                    || worker
                                        .child
                                        .try_wait()
                                        .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?
                                        .is_some()
                            }
                            None => false,
                        };
                        if expired {
                            slot.take();
                        }
                        if slot.is_none() {
                            let mut worker = Worker::spawn(host, callable, runtime)?;
                            worker.generation = generation;
                            *slot = Some(worker);
                        }
                        let remaining = timeout
                            .checked_sub(start.elapsed())
                            .ok_or(ScientificCpythonUnavailable::TimedOut)?;
                        let output = slot
                            .as_mut()
                            .expect("created worker")
                            .exchange(input, remaining)?;
                        if let Some(changes) = &runtime.changes {
                            if changes.validate(runtime)? != generation.unwrap_or_default() {
                                // The response was produced across a runtime update.
                                // Refuse it and discard the old imported modules.
                                return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
                            }
                        } else {
                            verify_packaged_runtime_identity(runtime)?;
                        }
                        if output.len() > output_limit {
                            return Err(ScientificCpythonUnavailable::StdoutTooLarge);
                        }
                        validate_worker_response(&request, &output, expected_id)
                    })();
                    // Never retry an executed request: mutations may have completed.
                    // A later request receives a fresh, independently attested worker.
                    if result.is_err() {
                        slot.take();
                    }
                    return result;
                }
            }
            if start.elapsed() >= timeout {
                return Err(ScientificCpythonUnavailable::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;

    fn worker(script: &str) -> Worker {
        use std::os::unix::process::CommandExt;
        let scratch = ScratchDirectory::create().unwrap();
        let mut command = Command::new("/usr/bin/python3");
        command
            .args(["-I", "-B", "-c", script])
            .current_dir(&scratch.path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        Worker::spawn_command(command, scratch).unwrap()
    }

    #[test]
    fn interactive_frames_reuse_one_process_and_preserve_request_boundaries() {
        let mut worker = worker("import sys,json,os\nfor line in sys.stdin.buffer:\n request=json.loads(line)\n value=json.dumps({'pid':os.getpid(),'id':request['id']}).encode()\n sys.stdout.buffer.write(len(value).to_bytes(4,'little')+value)\n sys.stdout.buffer.flush()\n");
        let pid = worker.child.id();
        for id in 0..20 {
            let output = worker
                .exchange(
                    serde_json::json!({"id":id}).to_string().as_bytes(),
                    Duration::from_secs(2),
                )
                .unwrap();
            let response: Value = serde_json::from_slice(&output).unwrap();
            assert_eq!(response["id"], id);
            assert_eq!(response["pid"], pid);
        }
        assert_eq!(worker.completed, 20);
    }

    #[test]
    fn interactive_timeout_terminates_the_process_and_releases_its_pipes() {
        let mut worker = worker("import sys,time\nsys.stdin.buffer.readline()\ntime.sleep(60)");
        let started = Instant::now();
        assert_eq!(
            worker.exchange(b"{}", Duration::from_millis(50)),
            Err(ScientificCpythonUnavailable::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(worker.child.try_wait().unwrap().is_some());
    }

    #[test]
    fn interactive_timeout_also_bounds_a_worker_that_does_not_read_stdin() {
        let mut worker = worker("import sys,time\nsys.stdout.buffer.write((2).to_bytes(4,'little')+b'{}')\nsys.stdout.buffer.flush()\ntime.sleep(60)");
        let started = Instant::now();
        assert_eq!(
            worker.exchange(&vec![b'x'; 1024 * 1024], Duration::from_millis(50)),
            Err(ScientificCpythonUnavailable::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(worker.child.try_wait().unwrap().is_some());
    }

    #[test]
    fn interactive_stdout_is_bounded_before_allocating_an_announced_frame() {
        let mut worker = worker("import sys\nsys.stdin.buffer.readline()\nsys.stdout.buffer.write((33554433).to_bytes(4,'little'))\nsys.stdout.buffer.flush()");
        assert_eq!(
            worker.exchange(b"{}", Duration::from_secs(2)),
            Err(ScientificCpythonUnavailable::StdoutTooLarge)
        );
        assert!(worker.child.try_wait().unwrap().is_some());
    }

    #[test]
    fn interactive_dispatcher_retains_bootstrap_attestation_and_protocol_limits() {
        let script = worker_script();
        let distribution = script
            .find("distribution=importlib.metadata.distribution")
            .unwrap();
        let loop_start = script.find("while True:").unwrap();
        assert!(distribution < loop_start);
        assert!(script.contains("sys.stdout.buffer.flush()"));
        assert!(script.contains("len(encoded).to_bytes(4, 'little')"));
        assert!(!script.contains("sys.stdin.buffer.read(33554433)"));
        let mut worker = worker("import sys,ast\nraw=sys.stdin.buffer.readline()\nimport json\nast.parse(json.loads(raw)['script'])\nv=b'{}'\nsys.stdout.buffer.write(len(v).to_bytes(4,'little')+v)\nsys.stdout.buffer.flush()");
        worker
            .exchange(
                serde_json::json!({"script":script}).to_string().as_bytes(),
                Duration::from_secs(2),
            )
            .unwrap();
    }
}
