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
        Arc, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard, TryLockError,
    },
    time::{Duration, Instant},
};

const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
const MAX_WORKER_DIAGNOSTIC_BYTES: usize = 4096;

fn is_foreground_prediction_read(request: &Value) -> bool {
    request["schema"] == crate::document_cpython::REQUEST_SCHEMA
        && matches!(
            request["operation"].as_str(),
            Some("results.chains" | "results.chain" | "results.arrays" | "results.page")
        )
}

// Match the renderer's normal readiness polling cadence. This schedules a real
// background validation after a read burst; it never caches a ready response.
const READINESS_QUIET_PERIOD: Duration = Duration::from_secs(1);

#[derive(Default)]
struct PredictionReadState {
    active: usize,
    last_finished: Option<Instant>,
    failed: bool,
}

pub struct PredictionReadActivity(Arc<Mutex<PredictionReadState>>);

impl Drop for PredictionReadActivity {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.lock() {
            match state.active.checked_sub(1) {
                Some(active) => state.active = active,
                None => state.failed = true,
            }
            state.last_finished = Some(Instant::now());
        }
    }
}

struct RuntimeAdmission {
    gate: RwLock<()>,
    reads: Arc<Mutex<PredictionReadState>>,
    quiet_period: Duration,
}

impl Default for RuntimeAdmission {
    fn default() -> Self {
        Self {
            gate: RwLock::default(),
            reads: Arc::default(),
            quiet_period: READINESS_QUIET_PERIOD,
        }
    }
}

#[cfg(test)]
mod admission_tests {
    use super::*;

    #[test]
    fn only_existing_prediction_reads_defer_availability_scans() {
        for operation in [
            "results.chains",
            "results.chain",
            "results.arrays",
            "results.page",
        ] {
            assert!(is_foreground_prediction_read(&serde_json::json!({
                "schema": crate::document_cpython::REQUEST_SCHEMA, "operation": operation
            })));
        }
        for operation in [
            "predictions.run",
            "workspace.upgrade",
            "documents.batch",
            "dataset.preview",
        ] {
            assert!(!is_foreground_prediction_read(&serde_json::json!({
                "schema": crate::document_cpython::REQUEST_SCHEMA, "operation": operation
            })));
        }
        assert!(!is_foreground_prediction_read(&serde_json::json!({
            "schema": "nirs4all.studio-playground-job.v1", "operation": "results.page"
        })));
    }

    #[test]
    fn background_waits_for_all_foreground_boundaries_and_resumes_after_release() {
        let admission = Arc::new(RuntimeAdmission::default());
        let first = admission.foreground(Duration::from_secs(1)).unwrap();
        let second = admission.foreground(Duration::from_secs(1)).unwrap();
        let (entered, receive) = mpsc::channel();
        let pending = Arc::clone(&admission);
        let task = std::thread::spawn(move || {
            let _background = pending.background(Duration::from_secs(2)).unwrap();
            entered.send(()).unwrap();
        });
        assert!(receive.recv_timeout(Duration::from_millis(20)).is_err());
        drop(first);
        assert!(receive.recv_timeout(Duration::from_millis(20)).is_err());
        drop(second);
        receive.recv_timeout(Duration::from_secs(2)).unwrap();
        task.join().unwrap();
        assert!(admission.foreground(Duration::from_secs(1)).is_ok());
    }

    #[test]
    fn admission_is_bounded_and_does_not_leave_failed_background_waiters() {
        let admission = RuntimeAdmission::default();
        let foreground = admission.foreground(Duration::from_secs(1)).unwrap();
        assert!(matches!(
            admission.background(Duration::ZERO),
            Err(ScientificCpythonUnavailable::TimedOut)
        ));
        drop(foreground);
        let background = admission.background(Duration::from_secs(1)).unwrap();
        assert!(matches!(
            admission.foreground(Duration::ZERO),
            Err(ScientificCpythonUnavailable::TimedOut)
        ));
        drop(background);
        assert!(admission.foreground(Duration::from_secs(1)).is_ok());
    }

    #[test]
    fn poisoned_admission_refuses_both_paths_instead_of_skipping_validation() {
        let admission = Arc::new(RuntimeAdmission::default());
        let poison = Arc::clone(&admission);
        assert!(std::thread::spawn(move || {
            let _held = poison.background(Duration::from_secs(1)).unwrap();
            panic!("test admission panic");
        })
        .join()
        .is_err());
        assert!(matches!(
            admission.foreground(Duration::from_secs(1)),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        ));
        assert!(matches!(
            admission.background(Duration::from_secs(1)),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        ));
    }

    #[test]
    fn cold_background_validation_has_no_quiet_delay() {
        let admission = RuntimeAdmission::default();
        let _validation = admission.background(Duration::ZERO).unwrap();
    }

    #[test]
    fn read_activity_covers_post_exchange_work_without_a_second_readlock() {
        let admission = Arc::new(RuntimeAdmission {
            quiet_period: Duration::from_millis(40),
            ..RuntimeAdmission::default()
        });
        let activity = admission.read_activity().unwrap();
        let exchange = admission.foreground(Duration::ZERO).unwrap();
        let (entered, receive) = mpsc::channel();
        let pending = Arc::clone(&admission);
        let background = std::thread::spawn(move || {
            let _validation = pending.background(Duration::from_secs(2)).unwrap();
            entered.send(()).unwrap();
        });
        drop(exchange);
        // Adapter post-verification and response serialization are still active.
        assert!(receive.recv_timeout(Duration::from_millis(60)).is_err());
        // A next foreground exchange must not deadlock on a queued writer.
        drop(admission.foreground(Duration::ZERO).unwrap());
        drop(activity);
        assert!(receive.recv_timeout(Duration::from_millis(10)).is_err());
        receive.recv_timeout(Duration::from_secs(2)).unwrap();
        background.join().unwrap();
    }

    #[test]
    fn background_waits_for_complete_read_burst_and_overlapping_responses() {
        let admission = Arc::new(RuntimeAdmission {
            quiet_period: Duration::from_millis(60),
            ..RuntimeAdmission::default()
        });
        let first = admission.read_activity().unwrap();
        let second = admission.read_activity().unwrap();
        let (entered, receive) = mpsc::channel();
        let pending = Arc::clone(&admission);
        let background = std::thread::spawn(move || {
            let _validation = pending.background(Duration::from_secs(2)).unwrap();
            entered.send(()).unwrap();
        });
        drop(first);
        assert!(receive.recv_timeout(Duration::from_millis(80)).is_err());
        drop(second);
        assert!(receive.recv_timeout(Duration::from_millis(20)).is_err());
        // The client submits another read during the ordinary polling interval.
        let third = admission.read_activity().unwrap();
        assert!(receive.recv_timeout(Duration::from_millis(80)).is_err());
        drop(third);
        assert!(receive.recv_timeout(Duration::from_millis(20)).is_err());
        receive.recv_timeout(Duration::from_secs(2)).unwrap();
        background.join().unwrap();
    }

    #[test]
    fn failed_read_releases_activity_but_does_not_bypass_background_validation() {
        let admission = RuntimeAdmission {
            quiet_period: Duration::from_millis(10),
            ..RuntimeAdmission::default()
        };
        let failed_read = || -> Result<(), &'static str> {
            let _activity = admission.read_activity().unwrap();
            Err("response construction failed")
        };
        assert!(failed_read().is_err());
        assert!(matches!(
            admission.background(Duration::ZERO),
            Err(ScientificCpythonUnavailable::TimedOut)
        ));
        let _validation = admission.background(Duration::from_secs(1)).unwrap();
    }

    #[test]
    fn poisoned_read_activity_refuses_foreground_and_background_admission() {
        let admission = Arc::new(RuntimeAdmission::default());
        let poison = Arc::clone(&admission);
        assert!(std::thread::spawn(move || {
            let _state = poison.reads.lock().unwrap();
            panic!("test activity panic");
        })
        .join()
        .is_err());
        assert!(matches!(
            admission.read_activity(),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        ));
        assert!(matches!(
            admission.foreground(Duration::ZERO),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        ));
        assert!(matches!(
            admission.background(Duration::ZERO),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        ));
    }
}

impl RuntimeAdmission {
    fn read_activity(&self) -> Result<PredictionReadActivity, ScientificCpythonUnavailable> {
        let mut state = self
            .reads
            .lock()
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
        if state.failed {
            return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
        }
        if let Some(active) = state.active.checked_add(1) {
            state.active = active;
        } else {
            state.failed = true;
            drop(state);
            return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
        }
        drop(state);
        Ok(PredictionReadActivity(Arc::clone(&self.reads)))
    }

    fn reads_quiet(&self) -> Result<bool, ScientificCpythonUnavailable> {
        let state = self
            .reads
            .lock()
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
        if state.failed {
            return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
        }
        Ok(state.active == 0
            && state
                .last_finished
                .is_none_or(|finished| finished.elapsed() >= self.quiet_period))
    }

    fn foreground(
        &self,
        timeout: Duration,
    ) -> Result<RwLockReadGuard<'_, ()>, ScientificCpythonUnavailable> {
        let _timing = super::BoundaryTiming::start("runtime_foreground_admission_wait");
        let started = Instant::now();
        loop {
            match self.gate.try_read() {
                Ok(guard) => {
                    self.reads_quiet()?;
                    return Ok(guard);
                }
                Err(TryLockError::Poisoned(_)) => {
                    return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
                }
                Err(TryLockError::WouldBlock) => {}
            }
            if started.elapsed() >= timeout {
                return Err(ScientificCpythonUnavailable::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn background(
        &self,
        timeout: Duration,
    ) -> Result<RwLockWriteGuard<'_, ()>, ScientificCpythonUnavailable> {
        let _timing = super::BoundaryTiming::start("runtime_availability_admission_wait");
        let started = Instant::now();
        loop {
            match self.gate.try_write() {
                Ok(guard) if self.reads_quiet()? => return Ok(guard),
                Ok(guard) => drop(guard),
                Err(TryLockError::Poisoned(_)) => {
                    return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
                }
                Err(TryLockError::WouldBlock) => {}
            }
            if started.elapsed() >= timeout {
                return Err(ScientificCpythonUnavailable::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

/// Filesystem notifications invalidate the installation validation, not user
/// requests. Unsupported watchers retain exhaustive request-time validation.
pub(super) struct RuntimeChanges {
    generation: Arc<AtomicUsize>,
    healthy: Arc<AtomicBool>,
    validated: Mutex<Option<usize>>,
    admission: RuntimeAdmission,
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
            admission: RuntimeAdmission::default(),
            _watcher: Mutex::new(watcher),
        }))
    }

    pub(super) fn validate(
        &self,
        runtime: &PackagedRuntimeIdentity,
    ) -> Result<usize, ScientificCpythonUnavailable> {
        let _timing = super::BoundaryTiming::start("runtime_validation_total");
        let generation = self.generation.load(Ordering::Acquire);
        let waiting = super::BoundaryTiming::start("runtime_validation_lock_wait");
        let mut validated = self
            .validated
            .lock()
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
        drop(waiting);
        // Windows may coalesce a same-size write followed by restored mtime into
        // no directory notification. Its FILE_BASIC_INFO.ChangeTime snapshot is
        // still authoritative; check it on every boundary while retaining the
        // cryptographic hash cache for unchanged installations.
        if cfg!(windows) || !self.healthy.load(Ordering::Acquire) || *validated != Some(generation)
        {
            verify_packaged_runtime_identity(runtime)?;
            if self.generation.load(Ordering::Acquire) != generation {
                return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
            }
            *validated = Some(generation);
        }
        drop(validated);
        Ok(generation)
    }

    fn foreground_prediction_read(
        &self,
        request: &Value,
        timeout: Duration,
    ) -> Result<Option<RwLockReadGuard<'_, ()>>, ScientificCpythonUnavailable> {
        if is_foreground_prediction_read(request) {
            self.admission.foreground(timeout).map(Some)
        } else {
            Ok(None)
        }
    }

    pub(super) fn prediction_read_activity(
        &self,
        operation: &str,
    ) -> Result<Option<PredictionReadActivity>, ScientificCpythonUnavailable> {
        if is_foreground_prediction_read(&serde_json::json!({
            "schema": crate::document_cpython::REQUEST_SCHEMA,
            "operation": operation,
        })) {
            self.admission.read_activity().map(Some)
        } else {
            Ok(None)
        }
    }

    pub(super) fn validate_background(
        &self,
        runtime: &PackagedRuntimeIdentity,
    ) -> Result<usize, ScientificCpythonUnavailable> {
        // Availability still performs the same exhaustive validation. Wait for
        // active guarded exchanges instead of inserting scans between their
        // before/after boundaries; never synthesize a ready response.
        let _admission = self
            .admission
            .background(super::SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT)?;
        self.validate(runtime)
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
    stderr_tail: Arc<Mutex<Vec<u8>>>,
    stderr_reader: Option<std::thread::JoinHandle<()>>,
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
    #[cfg(test)]
    pub(super) fn process_id(&self) -> u32 {
        self.child.id()
    }

    /// The acquisition probe becomes the first worker: expensive library imports
    /// are paid once and retained for the first user interaction.
    pub(super) fn acquire(
        host: &HostIdentity,
        runtime: Option<&PackagedRuntimeIdentity>,
    ) -> Result<(Self, Vec<u8>), ScientificCpythonUnavailable> {
        let generation = runtime
            .and_then(|runtime| runtime.changes.as_ref().map(|changes| (runtime, changes)))
            .map(|(runtime, changes)| changes.validate(runtime))
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
            runtime.map(|runtime| runtime.site_packages.as_path()),
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
        if let Some((runtime, changes)) =
            runtime.and_then(|runtime| runtime.changes.as_ref().map(|changes| (runtime, changes)))
        {
            if Some(changes.validate(runtime)?) != generation {
                return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
            }
        }
        Ok((worker, output))
    }

    fn spawn(
        host: &HostIdentity,
        callable: &HostIdentity,
        runtime: Option<&PackagedRuntimeIdentity>,
    ) -> Result<Self, ScientificCpythonUnavailable> {
        let scratch = ScratchDirectory::create()?;
        let mut command = scientific_worker_command_with_script(
            host,
            callable,
            runtime.map(|runtime| runtime.site_packages.as_path()),
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
    fn interactive_generation(
        &self,
        host: &HostIdentity,
        callable: &HostIdentity,
        runtime: Option<&PackagedRuntimeIdentity>,
    ) -> Result<Option<usize>, ScientificCpythonUnavailable> {
        if let Some(runtime) = runtime {
            if let Some(changes) = &runtime.changes {
                return changes.validate(runtime).map(Some);
            }
            verify_identity(host)?;
            verify_identity(callable)?;
            verify_packaged_runtime_identity(runtime)?;
        } else {
            self.selected_library
                .as_ref()
                .ok_or(ScientificCpythonUnavailable::RuntimeContractUnavailable)?
                .verify()?;
        }
        Ok(None)
    }

    pub(super) fn run_interactive_request(
        &self,
        host: &HostIdentity,
        callable: &HostIdentity,
        runtime: Option<&PackagedRuntimeIdentity>,
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
        let _admission = runtime
            .and_then(|runtime| runtime.changes.as_ref())
            .map(|changes| changes.foreground_prediction_read(&request, timeout))
            .transpose()?
            .flatten();
        loop {
            for slot in &self.warm_workers {
                if let Ok(mut slot) = slot.try_lock() {
                    let result = (|| {
                        let generation = self.interactive_generation(host, callable, runtime)?;
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
                        let output = {
                            let _timing = super::BoundaryTiming::start("worker_exchange");
                            slot.as_mut()
                                .expect("created worker")
                                .exchange(input, remaining)?
                        };
                        if self.interactive_generation(host, callable, runtime)? != generation {
                            // Refuse a response produced across an installation change.
                            return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
                        }
                        if output.len() > output_limit {
                            return Err(ScientificCpythonUnavailable::StdoutTooLarge);
                        }
                        validate_worker_response(&request, &output, expected_id)
                    })();
                    // Never retry an executed request: mutations may have completed.
                    // A later request receives a fresh, independently attested worker.
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
    fn executed_interactive_failure_is_not_replayed_and_discards_worker() {
        let root = tempfile::tempdir().unwrap();
        let site = root.path().join("site-packages");
        std::fs::create_dir_all(site.join("nirs4all")).unwrap();
        std::fs::create_dir_all(site.join("nirs4all-1.4.7.dist-info")).unwrap();
        let callable_path = site.join("nirs4all/source.py");
        std::fs::write(&callable_path, b"source").unwrap();
        std::fs::write(site.join("nirs4all-1.4.7.dist-info/RECORD"), b"record").unwrap();
        let host = super::super::host_identity_with_limit(
            Path::new("/usr/bin/python3"),
            super::super::MAX_SCIENTIFIC_CPYTHON_HOST_BYTES,
        )
        .unwrap();
        let marker = root.path().join("executions");
        let script = format!("import sys,json\nfor line in sys.stdin.buffer:\n with open({},'a') as f: f.write('executed\\n')\n sys.stdout.buffer.write((2).to_bytes(4,'little')+b'{{}}')\n sys.stdout.buffer.flush()\n", serde_json::to_string(marker.to_str().unwrap()).unwrap());
        let mut executor = CpythonScientificJobExecutor::unavailable(
            ScientificCpythonUnavailable::RequestResolverUnavailable,
            root.path().join("config"),
        );
        executor.selected_library = Some(
            super::super::selected_library_identity::SelectedLibraryIdentity::capture(&host, &site)
                .unwrap(),
        );
        executor.warm_workers[0] = Mutex::new(Some(worker(&script)));
        let callable = super::super::host_identity(&callable_path).unwrap();
        let input = serde_json::json!({"schema":"nirs4all.studio-document-request.v1",
            "job_id":"document-translation", "operation":"dataset.preview", "payload":{}})
        .to_string();
        assert_eq!(
            executor.run_interactive_request(
                &host,
                &callable,
                None,
                input.as_bytes(),
                Duration::from_secs(2)
            ),
            Err(ScientificCpythonUnavailable::MalformedResponse)
        );
        assert_eq!(std::fs::read_to_string(marker).unwrap(), "executed\n");
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
