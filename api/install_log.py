"""Bounded installation output and a watchdog independent of pipe reads."""

import codecs
import functools
import os
import re
import signal
import subprocess
import threading
import time
from collections import deque


def redact_install_output(text: str) -> str:
    text = re.sub(r"(https?://)[^\s/@]+(?::[^\s/@]*)?@", r"\1[redacted]@", text)
    text = re.sub(r"(?i)([?&](?:token|key|password|secret|access_token)=)[^&\s]+", r"\1[redacted]", text)
    return re.sub(r"(?i)(authorization\s*[:=]\s*(?:bearer\s+|basic\s+)?)[^\s]+", r"\1[redacted]", text)


class InstallationLog:
    def __init__(self):
        self.lock = threading.Lock()
        self.operation_lock = threading.Lock()
        self.lines = deque(maxlen=250)
        self.sequence = 0
        self.status = "idle"
        self.started_at = None
        self.updated_at = None
        self.package = ""

    def append(self, text):
        text = redact_install_output(str(text))[:2000]
        with self.lock:
            self.sequence += 1
            self.updated_at = time.time() * 1000
            self.lines.append({"id": self.sequence, "time": self.updated_at, "text": text})
            while sum(len(line["text"]) for line in self.lines) > 64000:
                self.lines.popleft()

    def start(self, package):
        with self.lock:
            self.status = "running"
            self.package = package
            self.started_at = time.time() * 1000
        self.append(f"Installing {package}")

    def finish(self, success, message):
        with self.lock:
            self.status = "complete" if success else "error"
        self.append(message)

    def snapshot(self):
        with self.lock:
            return {"status": self.status, "package": self.package, "started_at": self.started_at,
                    "updated_at": self.updated_at, "lines": list(self.lines)}


installation_log = InstallationLog()


def installation_operation(function):
    @functools.wraps(function)
    def wrapped(self, package, *args, **kwargs):
        if not installation_log.operation_lock.acquire(blocking=False):
            result = (False, "Another package operation is still running")
            return (*result, []) if function.__name__ == "install_package" else result
        installation_log.start(package)
        try:
            result = function(self, package, *args, **kwargs)
            installation_log.finish(result[0], result[1])
            return result
        except Exception as error:
            installation_log.finish(False, redact_install_output(str(error)))
            raise
        finally:
            installation_log.operation_lock.release()
    return wrapped


def stream_install_process(command, on_line, timeout=600):
    """Drain merged output on a reader thread while the caller enforces the deadline."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               bufsize=0, start_new_session=os.name != "nt")
    read_errors = []

    def read_output():
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        pending = ""
        oversized = False
        try:
            while True:
                chunk = process.stdout.read(4096)
                pending += decoder.decode(chunk or b"", final=not chunk).replace("\r", "\n")
                while "\n" in pending:
                    line, pending = pending.split("\n", 1)
                    if oversized or len(line) > 4096:
                        on_line("[Oversized output line omitted]")
                    elif line.strip():
                        on_line(redact_install_output(line.strip()))
                    oversized = False
                if len(pending) > 4096:
                    pending = ""
                    oversized = True
                if not chunk:
                    if oversized:
                        on_line("[Oversized output line omitted]")
                    elif pending.strip():
                        on_line(redact_install_output(pending.strip()))
                    break
        except Exception as error:
            read_errors.append(error)
        finally:
            process.stdout.close()

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            subprocess.run(["taskkill", "/pid", str(process.pid), "/t", "/f"], capture_output=True, timeout=10, check=False)
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=10)
        reader.join(timeout=5)
        raise
    reader.join(timeout=5)
    if reader.is_alive():
        raise RuntimeError("Installation exited but its output pipe did not close")
    if read_errors:
        raise RuntimeError("Could not read installation output") from read_errors[0]
    return process.returncode
