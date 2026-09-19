"""Installation output uses real subprocesses; no packages are installed."""

import subprocess
import sys
import time

import pytest

from api.install_log import InstallationLog, stream_install_process


def test_large_mixed_output_and_partial_utf8_are_drained():
    lines = []
    code = "import os,time; os.write(1,b'x'*(8*1024*1024)+b'\\n'); os.write(2,b'progress\\r'); os.write(1,b'\\xc3'); time.sleep(.01); os.write(1,b'\\xa9\\n')"
    assert stream_install_process([sys.executable, "-c", code], lines.append, timeout=3) == 0
    assert "é" in lines and "progress" in lines
    assert "[Oversized output line omitted]" in lines


def test_silent_process_deadline_applies_while_reader_is_blocked():
    start = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        stream_install_process([sys.executable, "-c", "import time; time.sleep(30)"], lambda line: None, timeout=.1)
    assert time.monotonic() - start < 2


def test_nonzero_exit_and_output_are_preserved_with_credentials_redacted():
    lines = []
    code = "import sys; print('https://user:private_password@example.test/simple?token=private_token'); sys.exit(7)"
    assert stream_install_process([sys.executable, "-c", code], lines.append) == 7
    assert "[redacted]" in "\n".join(lines)
    assert "private_password" not in str(lines) and "private_token" not in str(lines)


def test_history_is_bounded_and_completion_does_not_erase_failure_output():
    log = InstallationLog()
    log.start("example")
    for index in range(1000):
        log.append(f"{index}:" + "x" * 3000)
    log.finish(False, "pip failed")
    snapshot = log.snapshot()
    assert snapshot["status"] == "error"
    assert snapshot["lines"][-1]["text"] == "pip failed"
    assert len(snapshot["lines"]) <= 250
    assert sum(len(line["text"]) for line in snapshot["lines"]) <= 64000
    assert log.snapshot() == snapshot
