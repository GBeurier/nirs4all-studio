#!/usr/bin/env python3
"""Provision a fresh local wizard profile through the real HTTP alignment API.

This is deliberately separate from the core CPU catalog and installer gates.
Creates an isolated venv/config/workspace; never touches the user's open Studio.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--profile", default="cpu")
    parser.add_argument("--node", default="node")
    parser.add_argument("--existing-venv", type=Path, help="Explicit opt-in follow-up on a previously qualified isolated environment")
    parser.add_argument("--extra", action="append", default=[], help="Explicit user-selected optional package in addition to real preselection")
    args = parser.parse_args()
    if sys.version_info < (3, 11):  # noqa: UP036 - standalone CLI may be launched by the system Python
        parser.error("Run this qualification with Python 3.11 or later, matching the installed desktop runtime.")
    directory = args.output_root.resolve()
    directory.mkdir(parents=True, exist_ok=False)
    report = {"profile": args.profile, "status": "failed", "scope": "fresh venv, real profile API, real frontend preselection, restart; no installer bundle"}
    wheel_dir = directory / "python-wheels"
    wheel_dir.mkdir()
    wheel = wheel_dir / args.wheel.name
    shutil.copyfile(args.wheel, wheel)
    report["wheel_sha256"] = hashlib.sha256(wheel.read_bytes()).hexdigest()
    env = {**os.environ, "NIRS4ALL_CONFIG": str(directory / "config"),
           "NIRS4ALL_DEFAULT_WORKSPACE": str(directory / "workspace"),
           "XDG_DATA_HOME": str(directory / "data"), "XDG_CONFIG_HOME": str(directory / "xdg-config"),
           "NIRS4ALL_RECOVERY_WHEEL": str(wheel), "NIRS4ALL_DESKTOP": "true", "N4A_ENGINE": "legacy",
           "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "MKL_NUM_THREADS": "1",
           "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "SENTRY_DSN": ""}
    for name in ("PYTHONPATH", "NIRS4ALL_WORKSPACE", "NIRS4ALL_RUNTIME_MODE", "NIRS4ALL_BACKEND_TOKEN"):
        env.pop(name, None)
    backend = None
    logs = []

    def save():
        (directory / "qualification.json").write_text(json.dumps(report, indent=2, default=str))

    def command(command_args, name, timeout=900):
        with (directory / f"{name}.log").open("w") as log:
            subprocess.run(command_args, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=timeout)

    def stop():
        nonlocal backend
        if backend and backend.poll() is None:
            os.killpg(backend.pid, signal.SIGTERM)
            try:
                backend.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(backend.pid, signal.SIGKILL)
                backend.wait(timeout=5)
        backend = None

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    def request(path, payload=None, timeout=15):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api{path}", data=data,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)

    def launch(label):
        nonlocal backend
        log = (directory / f"backend-{label}.log").open("w")
        logs.append(log)
        backend = subprocess.Popen([str(python), "-I", "-c", "import sys,uvicorn;sys.path.insert(0,sys.argv[1]);uvicorn.run('main:app',host='127.0.0.1',port=int(sys.argv[2]))", str(ROOT), str(port)],
                                   cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        started = time.monotonic()
        while time.monotonic() - started < 120:
            if backend.poll() is not None:
                raise RuntimeError(f"Backend exited: {label}; see backend log")
            try:
                status = request("/system/readiness")
            except (OSError, ValueError):
                time.sleep(0.2)
                continue
            if status.get("ml_error") and not status.get("requires_restart"):
                raise RuntimeError(str(status))
            if status.get("ml_ready") and status.get("workspace_ready") and not status.get("requires_restart"):
                report[f"readiness_{label}"] = {"seconds": time.monotonic() - started, "response": status}
                save()
                return
            time.sleep(0.2)
        raise TimeoutError(f"Readiness after {label} exceeded 120 seconds")

    try:
        if args.existing_venv:
            python = args.existing_venv.resolve() / "bin/python"
            report["scope"] = "explicit optional-package selection on previously qualified isolated wizard venv; no new bootstrap"
            report["existing_venv"] = str(args.existing_venv.resolve())
            if not python.is_file():
                raise FileNotFoundError(python)
        else:
            command([sys.executable, "-m", "venv", str(directory / "venv")], "create-venv", 60)
            python = directory / "venv/bin/python"
            bootstrap_start = time.monotonic()
            command([str(python), "-m", "pip", "install", "--disable-pip-version-check", "--progress-bar", "off",
                     "--only-binary=nirs4all-io,nirs4all-core", "-r", str(ROOT / "requirements-cpu.txt"), str(wheel)], "bootstrap")
            report["bootstrap_seconds"] = time.monotonic() - bootstrap_start
        inventory = "import importlib.metadata,json;print(json.dumps({d.metadata['Name']:d.version for d in importlib.metadata.distributions()}))"
        provenance_code = "import importlib.metadata,json,hashlib;d=importlib.metadata.distribution('nirs4all');print(json.dumps({'version':d.version,'record_sha256':hashlib.sha256((d.read_text('RECORD') or '').encode()).hexdigest(),'direct_url':json.loads(d.read_text('direct_url.json') or 'null')}))"
        report["library_before"] = json.loads(subprocess.check_output([str(python), "-I", "-c", provenance_code], env=env))
        before = json.loads(subprocess.check_output([str(python), "-I", "-c", inventory], env=env))
        (directory / "packages-before.json").write_text(json.dumps(before, indent=2))
        launch("before")
        config = request("/config/recommended")
        (directory / "recommended.json").write_text(json.dumps(config, indent=2))
        # Invoke the same TypeScript selectors as both setup screens, not a Python approximation.
        selection_js = """import fs from 'node:fs';import {getPreselectedOptionalPackageNames,filterPackageNamesForProfile} from './src/lib/setup-config.ts';
const config=JSON.parse(fs.readFileSync(process.argv[1]));const installed=Object.keys(JSON.parse(fs.readFileSync(process.argv[2])));
console.log(JSON.stringify(filterPackageNamesForProfile(getPreselectedOptionalPackageNames(config,installed),config,process.argv[3])));"""
        extras = json.loads(subprocess.check_output([args.node, "--input-type=module", "-e", selection_js,
                                                    str(directory / "recommended.json"), str(directory / "packages-before.json"), args.profile], cwd=ROOT, env=env))
        report["preselected_extras"] = extras
        report["explicit_extras"] = args.extra
        known_optionals = {entry["name"] for entry in config["optional"]}
        if set(args.extra) - known_optionals:
            raise ValueError("Explicit extras are not declared in the actual recommended configuration")
        report["request"] = {"profile": args.profile, "optional_packages": list(dict.fromkeys(extras + args.extra))}
        save()
        start = time.monotonic()
        report["alignment"] = request("/config/align", report["request"], timeout=900)
        report["alignment_seconds"] = time.monotonic() - start
        (directory / "installation-log.json").write_text(json.dumps(request("/config/install-log"), indent=2))
        save()
        if not report["alignment"]["success"]:
            raise RuntimeError("Profile alignment reported failure; see receipt and installation log")
        stop()
        launch("after")
        report["packages_after"] = json.loads(subprocess.check_output([str(python), "-I", "-c", inventory], env=env))
        report["library_after"] = json.loads(subprocess.check_output([str(python), "-I", "-c", provenance_code], env=env))
        command([str(python), "-m", "pip", "check"], "pip-check", 60)
        report["operator_availability"] = request("/system/operator-availability", timeout=60)
        report["status"] = "passed"
    except Exception:
        report["error"] = traceback.format_exc()
        if backend and backend.poll() is None:
            try:
                (directory / "installation-log.json").write_text(json.dumps(request("/config/install-log", timeout=5), indent=2))
            except Exception:
                pass
    finally:
        stop()
        for log in logs:
            log.close()
        save()
    print(json.dumps({key: value for key, value in report.items() if key not in {"operator_availability", "packages_after"}}, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
