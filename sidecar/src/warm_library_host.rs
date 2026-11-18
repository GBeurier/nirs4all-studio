//! Two reusable interactive workers. Training keeps its dedicated job process.
use super::{
    request_limits, scientific_worker_command, terminate_worker, validate_worker_response,
    CpythonScientificJobExecutor, ScientificCpythonUnavailable, ScientificHost, ScratchDirectory,
    EXECUTION_SCRIPT, MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES,
};
use serde_json::Value;
use std::{
    io::BufReader,
    process::{Child, ChildStdin},
    sync::mpsc::{self, Receiver},
};
use std::{
    io::{Read, Write},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const MAX_WORKER_DIAGNOSTIC_BYTES: usize = 4096;

/// Reuse the exact one-shot dispatcher and bootstrap checks with framed stdio:
/// one request per line, each response preceded by its 8-byte length.
fn worker_script() -> String {
    let (prefix, rest) = EXECUTION_SCRIPT
        .split_once("raw=sys.stdin.buffer.read()")
        .expect("worker input boundary");
    let (_, bootstrap) = rest
        .split_once("request=json.loads(raw)\n")
        .expect("library bootstrap");
    let (bootstrap, dispatch) = bootstrap
        .split_once("import contextlib\n")
        .expect("dispatcher boundary");
    let dispatch = dispatch.replace("sys.stdout.buffer.write(encoded)",
        "sys.stdout.buffer.write(len(encoded).to_bytes(8, 'little'))\nsys.stdout.buffer.write(encoded)\nsys.stdout.buffer.flush()");
    format!("{prefix}{bootstrap}import contextlib\nwhile True:\n    raw=sys.stdin.buffer.readline()\n    if not raw: break\n    if not raw.endswith(b'\\n'):\n        raise RuntimeError('interactive request is not one complete line')\n    request=json.loads(raw)\n{}\n",
        dispatch.lines().map(|line| format!("    {line}")).collect::<Vec<_>>().join("\n"))
}

pub(super) struct Worker {
    child: Child,
    stdin: Option<ChildStdin>,
    responses: Receiver<Result<Vec<u8>, ScientificCpythonUnavailable>>,
    stderr_bytes: Arc<AtomicUsize>,
    stderr_tail: Arc<Mutex<Vec<u8>>>,
    stderr_reader: Option<std::thread::JoinHandle<()>>,
    completed: usize,
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
    #[cfg(all(test, unix))]
    pub(super) fn process_id(&self) -> u32 {
        self.child.id()
    }

    /// The admission probe becomes the first worker: expensive library imports
    /// are paid once and retained for the first user interaction. Returns the
    /// probe's report; the caller drops the worker when it refuses the host.
    pub(super) fn acquire(
        host: &ScientificHost,
        timeout: Duration,
    ) -> Result<(Self, Vec<u8>), ScientificCpythonUnavailable> {
        let probe = serde_json::to_string(super::PREFLIGHT_SCRIPT)
            .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
        let dispatcher = serde_json::to_string(&worker_script())
            .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
        let script = format!("import contextlib,io,sys\n_capture=io.StringIO()\nwith contextlib.redirect_stdout(_capture):\n    exec({probe})\n_probe=_capture.getvalue().encode('utf-8')\nsys.stdout.buffer.write(len(_probe).to_bytes(8,'little'))\nsys.stdout.buffer.write(_probe)\nsys.stdout.buffer.flush()\nif not ready: raise SystemExit(0)\nsys.argv[3]=distribution_version\nexec({dispatcher})\n");
        let mut worker = Self::spawn_script(host, &script)?;
        let output = worker
            .responses
            .recv_timeout(timeout)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => ScientificCpythonUnavailable::TimedOut,
                mpsc::RecvTimeoutError::Disconnected => {
                    ScientificCpythonUnavailable::OutputReadFailed
                }
            })
            .and_then(|output| output)
            .inspect_err(|_| {
                // The probe did not report: retain why for the application log.
                let _ = terminate_worker(&mut worker.child);
                if let Some(reader) = worker.stderr_reader.take() {
                    let _ = reader.join();
                }
                if let Ok(tail) = worker.stderr_tail.lock() {
                    eprintln!(
                        "Studio scientific host probe failed: {}",
                        super::bounded_process_diagnostic(&tail)
                    );
                }
            })?;
        if output.len() > super::MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES {
            return Err(ScientificCpythonUnavailable::StdoutTooLarge);
        }
        Ok((worker, output))
    }

    fn spawn(host: &ScientificHost) -> Result<Self, ScientificCpythonUnavailable> {
        Self::spawn_script(host, &worker_script())
    }

    fn spawn_script(
        host: &ScientificHost,
        script: &str,
    ) -> Result<Self, ScientificCpythonUnavailable> {
        let scratch = ScratchDirectory::create()?;
        let mut command = scientific_worker_command(host, &scratch.path, script)?;
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
        if super::performance_diagnostics_enabled() {
            eprintln!("Studio performance worker_started pid={}", child.id());
        }
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
                    let mut header = [0_u8; 8];
                    reader
                        .read_exact(&mut header)
                        .map_err(|_| ScientificCpythonUnavailable::OutputReadFailed)?;
                    // Refuse an announced frame the host cannot hold before
                    // allocating it: the worker runs third-party code.
                    let size = usize::try_from(u64::from_le_bytes(header))
                        .ok()
                        .filter(|size| *size <= crate::host_memory::allowance())
                        .ok_or(ScientificCpythonUnavailable::StdoutTooLarge)?;
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
        let stderr_tail = Arc::new(Mutex::new(Vec::new()));
        let diagnostic_tail = stderr_tail.clone();
        let stderr_reader = std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            while let Ok(count) = stderr.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                diagnostic_size.fetch_add(count, Ordering::AcqRel);
                if let Ok(mut tail) = diagnostic_tail.lock() {
                    tail.extend_from_slice(&buffer[..count]);
                    let excess = tail.len().saturating_sub(MAX_WORKER_DIAGNOSTIC_BYTES);
                    tail.drain(..excess);
                }
            }
        });
        Ok(Self {
            child,
            stdin: Some(stdin),
            responses,
            stderr_bytes,
            stderr_tail,
            stderr_reader: Some(stderr_reader),
            completed: 0,
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
            if let Some(reader) = self.stderr_reader.take() {
                let _ = reader.join();
            }
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
        host: &ScientificHost,
        input: &[u8],
        timeout: Duration,
    ) -> Result<Value, ScientificCpythonUnavailable> {
        let request: Value = serde_json::from_slice(input)
            .map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?;
        let (input_limit, output_limit) = request_limits(&request);
        if input.len() > input_limit {
            return Err(ScientificCpythonUnavailable::RequestTooLarge);
        }
        let expected_id = request
            .get("request_id")
            .or_else(|| request.get("job_id"))
            .and_then(Value::as_str)
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
        // Waiting for a free worker is bounded separately from execution: time
        // spent queued behind another request must not shrink this request's
        // own execution budget.
        let admission_started = Instant::now();
        loop {
            for slot in &self.warm_workers {
                if let Ok(mut slot) = slot.try_lock() {
                    let start = Instant::now();
                    let result = (|| {
                        let exited = match slot.as_mut() {
                            Some(worker) => worker
                                .child
                                .try_wait()
                                .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?
                                .is_some(),
                            None => false,
                        };
                        if exited {
                            slot.take();
                        }
                        if slot.is_none() {
                            *slot = Some(Worker::spawn(host)?);
                        }
                        let remaining = timeout
                            .checked_sub(start.elapsed())
                            .ok_or(ScientificCpythonUnavailable::TimedOut)?;
                        let output = {
                            let _timing = super::BoundaryTiming::start("worker_exchange");
                            slot.as_mut()
                                .expect("created worker")
                                .exchange(input, remaining)?
                        };
                        if output.len() > output_limit {
                            return Err(ScientificCpythonUnavailable::StdoutTooLarge);
                        }
                        validate_worker_response(&request, &output, expected_id)
                    })();
                    // Never retry an executed request: mutations may have completed.
                    // A later request receives a fresh worker.
                    if let Err(error) = result.as_ref() {
                        // Match the one-shot host: disposable CI retains a bounded
                        // diagnostic; the public response remains a stable refusal.
                        if matches!(std::env::var("CI").as_deref(), Ok("true" | "1")) {
                            let diagnostic = slot
                                .as_ref()
                                .and_then(|worker| {
                                    worker
                                        .stderr_tail
                                        .lock()
                                        .ok()
                                        .map(|tail| super::bounded_process_diagnostic(&tail))
                                })
                                .unwrap_or_else(|| "(worker unavailable)".into());
                            eprintln!(
                                "Scientific CPython interactive worker failed ({}): {}",
                                error.reason(),
                                diagnostic
                            );
                        }
                        slot.take();
                    } else {
                        self.start_spare_worker(host);
                    }
                    return result;
                }
            }
            if admission_started.elapsed() >= timeout {
                return Err(ScientificCpythonUnavailable::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// Start the other interactive worker once a request has succeeded, so the
    /// first concurrent request does not pay a cold interpreter start. Spawning
    /// a process is quick; the child imports the library on its own while this
    /// request's response is returned. The pool stays at two workers, and a slot
    /// that is busy or already populated is left alone.
    fn start_spare_worker(&self, host: &ScientificHost) {
        for spare in &self.warm_workers {
            let Ok(mut spare) = spare.try_lock() else {
                continue;
            };
            if spare.is_none() {
                *spare = Worker::spawn(host).ok();
            }
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
    fn interactive_failure_retains_only_a_bounded_stderr_tail() {
        let mut worker = worker("import sys\nsys.stdin.buffer.readline()\nsys.stderr.write('x'*10000+'hidden-facade-cause')\nsys.stderr.flush()\nraise SystemExit(1)");
        assert_eq!(
            worker.exchange(b"{}", Duration::from_secs(2)),
            Err(ScientificCpythonUnavailable::OutputReadFailed)
        );
        let tail = worker.stderr_tail.lock().unwrap();
        assert_eq!(tail.len(), MAX_WORKER_DIAGNOSTIC_BYTES);
        assert!(tail.ends_with(b"hidden-facade-cause"));
        drop(tail);
        assert_eq!(worker.completed, 0);
    }

    #[test]
    fn interactive_frames_reuse_one_process_and_preserve_request_boundaries() {
        let mut worker = worker("import sys,json,os\nfor line in sys.stdin.buffer:\n request=json.loads(line)\n value=json.dumps({'pid':os.getpid(),'id':request['id']}).encode()\n sys.stdout.buffer.write(len(value).to_bytes(8,'little')+value)\n sys.stdout.buffer.flush()\n");
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

    /// An admitted host whose workers are supplied by each test.
    fn selected_executor(
        root: &tempfile::TempDir,
    ) -> (CpythonScientificJobExecutor, ScientificHost) {
        let host = ScientificHost {
            python: "/usr/bin/python3".into(),
            site_packages: root.path().join("site-packages"),
            adapters: root.path().join("adapters"),
            distribution_version: "2.3.4".into(),
        };
        let executor = CpythonScientificJobExecutor::unavailable(
            ScientificCpythonUnavailable::RequestResolverUnavailable,
            root.path().join("config"),
        );
        (executor, host)
    }

    #[test]
    fn executed_interactive_failure_is_not_replayed_and_discards_worker() {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join("executions");
        let script = format!("import sys,json\nfor line in sys.stdin.buffer:\n with open({},'a') as f: f.write('executed\\n')\n sys.stdout.buffer.write((2).to_bytes(8,'little')+b'{{}}')\n sys.stdout.buffer.flush()\n", serde_json::to_string(marker.to_str().unwrap()).unwrap());
        let (executor, host) = selected_executor(&root);
        *executor.warm_workers[0].lock().unwrap() = Some(worker(&script));
        assert_eq!(
            executor.run_interactive_request(
                &host,
                DOCUMENT_REQUEST.as_bytes(),
                Duration::from_secs(2)
            ),
            Err(ScientificCpythonUnavailable::MalformedResponse)
        );
        assert_eq!(std::fs::read_to_string(marker).unwrap(), "executed\n");
        assert!(executor.warm_workers[0].lock().unwrap().is_none());
        assert!(executor.warm_workers[1].lock().unwrap().is_none());
    }

    const DOCUMENT_REQUEST: &str = r#"{"schema":"nirs4all.studio-document-request.v1","job_id":"document-translation","operation":"dataset.preview","payload":{}}"#;

    #[test]
    fn queue_wait_does_not_consume_the_execution_budget() {
        let root = tempfile::tempdir().unwrap();
        let (executor, host) = selected_executor(&root);
        let reply = r#"{"schema":"nirs4all.studio-document-response.v1","job_id":"document-translation","success":true,"result":{},"error":null}"#;
        let script = format!("import sys,time\nfor line in sys.stdin.buffer:\n time.sleep(0.4)\n v={reply:?}.encode()\n sys.stdout.buffer.write(len(v).to_bytes(8,'little')+v)\n sys.stdout.buffer.flush()\n");
        *executor.warm_workers[0].lock().unwrap() = Some(worker(&script));
        // Both slots are busy for 600 ms; the request then needs 400 ms of
        // execution. With a 700 ms budget it only succeeds if queueing is free.
        let executor = Arc::new(executor);
        let second = executor.warm_workers[1].lock().unwrap();
        let first = executor.warm_workers[0].lock().unwrap();
        let task = {
            let executor = Arc::clone(&executor);
            std::thread::spawn(move || {
                executor.run_interactive_request(
                    &host,
                    DOCUMENT_REQUEST.as_bytes(),
                    Duration::from_millis(700),
                )
            })
        };
        std::thread::sleep(Duration::from_millis(600));
        drop(first);
        drop(second);
        let response = task.join().unwrap().unwrap();
        assert_eq!(response["success"], true);
    }

    #[test]
    fn queue_wait_is_still_bounded() {
        let root = tempfile::tempdir().unwrap();
        let (executor, host) = selected_executor(&root);
        let _first = executor.warm_workers[0].lock().unwrap();
        let _second = executor.warm_workers[1].lock().unwrap();
        let started = Instant::now();
        assert_eq!(
            executor.run_interactive_request(
                &host,
                DOCUMENT_REQUEST.as_bytes(),
                Duration::from_millis(100),
            ),
            Err(ScientificCpythonUnavailable::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn spare_worker_starts_after_a_successful_request_but_not_after_a_failure() {
        let root = tempfile::tempdir().unwrap();
        let (executor, host) = selected_executor(&root);
        let reply = r#"{"schema":"nirs4all.studio-document-response.v1","job_id":"document-translation","success":true,"result":{},"error":null}"#;
        let script = format!("import sys\nfor line in sys.stdin.buffer:\n v={reply:?}.encode()\n sys.stdout.buffer.write(len(v).to_bytes(8,'little')+v)\n sys.stdout.buffer.flush()\n");
        *executor.warm_workers[0].lock().unwrap() = Some(worker(&script));
        executor
            .run_interactive_request(&host, DOCUMENT_REQUEST.as_bytes(), Duration::from_secs(2))
            .unwrap();
        assert!(executor.warm_workers[0].lock().unwrap().is_some());
        assert!(executor.warm_workers[1].lock().unwrap().is_some());

        let failing = tempfile::tempdir().unwrap();
        let (executor, host) = selected_executor(&failing);
        *executor.warm_workers[0].lock().unwrap() = Some(worker(
            "import sys\nsys.stdin.buffer.readline()\nraise SystemExit(1)",
        ));
        assert!(executor
            .run_interactive_request(&host, DOCUMENT_REQUEST.as_bytes(), Duration::from_secs(2))
            .is_err());
        assert!(executor.warm_workers[0].lock().unwrap().is_none());
        assert!(executor.warm_workers[1].lock().unwrap().is_none());
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
        let mut worker = worker("import sys,time\nsys.stdout.buffer.write((2).to_bytes(8,'little')+b'{}')\nsys.stdout.buffer.flush()\ntime.sleep(60)");
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
        let mut worker = worker("import sys\nsys.stdin.buffer.readline()\nsys.stdout.buffer.write((2**63).to_bytes(8,'little'))\nsys.stdout.buffer.flush()");
        assert_eq!(
            worker.exchange(b"{}", Duration::from_secs(2)),
            Err(ScientificCpythonUnavailable::StdoutTooLarge)
        );
        assert!(worker.child.try_wait().unwrap().is_some());
    }

    #[test]
    fn interactive_frames_above_the_former_32_mib_ceiling_are_accepted() {
        // 40 MiB: what an 898 x 1557 Playground response used to be refused for.
        let mut worker = worker("import sys\nsys.stdin.buffer.readline()\nv=b'['+b'0,'*(20*1024*1024)+b'0]'\nsys.stdout.buffer.write(len(v).to_bytes(8,'little')+v)\nsys.stdout.buffer.flush()\nsys.stdin.buffer.readline()");
        let output = worker.exchange(b"{}", Duration::from_secs(30)).unwrap();
        assert_eq!(output.len(), 40 * 1024 * 1024 + 3);
    }

    #[test]
    fn interactive_dispatcher_retains_the_bootstrap_and_protocol_limits() {
        let script = worker_script();
        let admitted = script
            .find("importlib.metadata.version(\"nirs4all\") != sys.argv[3]")
            .unwrap();
        let loop_start = script.find("while True:").unwrap();
        assert!(admitted < script.find("import nirs4all\n").unwrap());
        assert!(script.find("import nirs4all\n").unwrap() < loop_start);
        assert!(script.contains("sys.stdout.buffer.flush()"));
        assert!(script.contains("len(encoded).to_bytes(8, 'little')"));
        assert!(!script.contains("sys.stdin.buffer.read()"));
        assert!(script.contains("raw=sys.stdin.buffer.readline()\n"));
        let mut worker = worker("import sys,ast\nraw=sys.stdin.buffer.readline()\nimport json\nast.parse(json.loads(raw)['script'])\nv=b'{}'\nsys.stdout.buffer.write(len(v).to_bytes(8,'little')+v)\nsys.stdout.buffer.flush()");
        worker
            .exchange(
                serde_json::json!({"script":script}).to_string().as_bytes(),
                Duration::from_secs(2),
            )
            .unwrap();
    }
}
