"""
External updater module for nirs4all webapp self-update.

This module handles the creation and execution of platform-specific
updater scripts that can replace the running application.

The update flow:
1. Download update to staging directory
2. Verify checksum
3. Create platform-specific updater script
4. Launch updater script and exit current process
5. Updater waits for app to exit, replaces files, launches new version
"""

import hashlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

import platformdirs

APP_NAME = "nirs4all-webapp"
APP_AUTHOR = "nirs4all"


def get_update_cache_dir() -> Path:
    """Get the directory for caching downloaded updates."""
    app_data = Path(platformdirs.user_data_dir(APP_NAME, APP_AUTHOR))
    cache_dir = app_data / "update_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def get_staging_dir() -> Path:
    """Get the directory for staging updates before apply."""
    app_data = Path(platformdirs.user_data_dir(APP_NAME, APP_AUTHOR))
    staging_dir = app_data / "update_staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    return staging_dir


def get_backup_dir() -> Path:
    """Get the directory for backing up current version before update."""
    app_data = Path(platformdirs.user_data_dir(APP_NAME, APP_AUTHOR))
    backup_dir = app_data / "update_backup"
    backup_dir.mkdir(parents=True, exist_ok=True)
    return backup_dir


def calculate_sha256(file_path: Path) -> str:
    """Calculate SHA256 checksum of a file."""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()


def verify_checksum(file_path: Path, expected_sha256: str) -> bool:
    """Verify file checksum matches expected value."""
    actual = calculate_sha256(file_path)
    return actual.lower() == expected_sha256.lower()


def is_portable_mode() -> bool:
    """Check if running as an electron-builder portable executable."""
    return bool(os.environ.get("NIRS4ALL_PORTABLE_EXE"))


def get_app_directory() -> Path:
    """Get the application installation directory.

    Priority:
    1. Portable mode: directory containing the portable exe
    2. Electron mode: NIRS4ALL_APP_DIR (Electron exe directory)
    3. PyInstaller: sys.executable parent
    4. Source: project root
    """
    portable_exe = os.environ.get("NIRS4ALL_PORTABLE_EXE")
    if portable_exe:
        return Path(portable_exe).parent
    electron_app_dir = os.environ.get("NIRS4ALL_APP_DIR")
    if electron_app_dir:
        return Path(electron_app_dir)
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent.parent


def get_executable_name() -> str:
    """Get the name of the main executable.

    Priority:
    1. Portable mode: basename of the portable exe
    2. Electron mode: NIRS4ALL_APP_EXE (e.g. "nirs4all Studio.exe")
    3. Fallback: hardcoded name
    """
    portable_exe = os.environ.get("NIRS4ALL_PORTABLE_EXE")
    if portable_exe:
        return Path(portable_exe).name
    electron_exe = os.environ.get("NIRS4ALL_APP_EXE")
    if electron_exe:
        return electron_exe
    if sys.platform == "win32":
        return "nirs4all-webapp.exe"
    elif sys.platform == "darwin":
        return "nirs4all-webapp"
    else:
        return "nirs4all-webapp"


# ---------- Progress HTA (Windows only) ----------
# Shown while the updater waits for exit + copies files.
# Uses basic HTML/VBScript that works on all Windows 10/11 Trident engines.

PROGRESS_HTA_CONTENT = '''\
<html>
<head><title>nirs4all Studio - Updating</title>
<HTA:APPLICATION APPLICATIONNAME="nirs4all-updater"
 BORDER="thin" BORDERSTYLE="normal" CAPTION="yes"
 MAXIMIZEBUTTON="no" MINIMIZEBUTTON="no" SYSMENU="no"
 SCROLL="no" SHOWINTASKBAR="yes" SINGLEINSTANCE="yes"/>
<script language="VBScript">
Dim dc: dc = 0
Dim msgIdx: msgIdx = -1
Dim barPos: barPos = 0
Dim barDir: barDir = 1
Dim msgs

Sub Window_onLoad
    window.resizeTo 460, 200
    window.moveTo (screen.availWidth - 460) \\ 2, (screen.availHeight - 200) \\ 2
    Randomize
    msgs = Array( _
        "Calibrating photon detectors...", _
        "Aligning spectral wavelengths...", _
        "Warming up the spectrometer...", _
        "Counting near-infrared photons...", _
        "Initializing chemometric engines...", _
        "Tuning neural pathways...", _
        "Preparing molecular vibrations...", _
        "Charging the laser diodes...", _
        "Waking up the PLS algorithm...", _
        "Compiling scatter correction routines...", _
        "Establishing Beer-Lambert equilibrium...", _
        "Teaching vectors some manners...", _
        "Interpolating between universes...", _
        "Casting spells on residuals...", _
        "Untangling correlated destinies...", _
        "Rescuing lost gradients...", _
        "Harmonizing signal and noise...", _
        "Consulting the Fourier elders...", _
        "Aligning latent chakras...", _
        "Convincing randomness to settle down...", _
        "Diagonalizing stubborn matrices...", _
        "Orthogonalizing rebellious vectors...", _
        "Maximizing likelihood with crossed fingers...", _
        "Minimizing convex regret...", _
        "Sampling from dubious posteriors...", _
        "Cholesky-decomposing my feelings...", _
        "Batch-normalizing reflectance regrets...", _
        "Stacking operators in suspicious order...", _
        "Reducing dimensionality without breaking CI...", _
        "Awaiting convergence across distributed photons..." _
    )
    Animate
    AnimateBar
    CycleMessage
    window.setTimeout "window.close", 300000
End Sub

Sub Animate
    dc = dc + 1
    If dc > 3 Then dc = 0
    Dim d: d = ""
    Dim i: For i = 1 To dc: d = d & ".": Next
    document.getElementById("dots").innerText = d
    window.setTimeout "Animate", 400
End Sub

Sub AnimateBar
    barPos = barPos + barDir * 3
    If barPos >= 140 Then barDir = -1
    If barPos <= 0 Then barDir = 1
    document.getElementById("bar").style.marginLeft = barPos & "px"
    window.setTimeout "AnimateBar", 30
End Sub

Sub CycleMessage
    Dim newIdx
    Do
        newIdx = Int(Rnd() * (UBound(msgs) + 1))
    Loop While newIdx = msgIdx And UBound(msgs) > 0
    msgIdx = newIdx
    document.getElementById("humor").innerText = msgs(msgIdx)
    window.setTimeout "CycleMessage", 3500
End Sub
</script></head>
<body style="background:#ffffff;color:#18181b;font-family:Segoe UI,sans-serif;margin:0;padding:0;overflow:hidden">
<div style="display:table;width:100%;height:100%">
<div style="display:table-cell;vertical-align:middle;text-align:center;padding:20px">
<div style="font-size:22px;font-weight:600;margin-bottom:6px">Updating nirs4all Studio</div>
<div style="font-size:13px;color:#71717a;margin-bottom:14px">Please wait, nirs4all Studio will restart automatically<span id="dots"></span></div>
<div style="width:180px;height:3px;background:#e4e4e7;margin:0 auto 16px auto;overflow:hidden"><div id="bar" style="width:50px;height:3px;background:rgb(37,119,187)"></div></div>
<div id="humor" style="font-family:Consolas,monospace;font-size:11px;color:#a1a1aa;min-height:14px"></div>
</div></div></body></html>
'''


# ---------- Windows batch script template ----------

WINDOWS_UPDATER_TEMPLATE = '''@echo off
setlocal enabledelayedexpansion

:: nirs4all-webapp updater script
:: This script is generated automatically - do not edit

set "APP_PID={app_pid}"
set "APP_DIR={app_dir}"
set "STAGING_DIR={staging_dir}"
set "BACKUP_DIR={backup_dir}"
set "EXECUTABLE={executable}"
set "LOG_FILE={log_file}"
set "PROGRESS_HTA={progress_hta}"
set "UPDATE_MODE={update_mode}"

:: Show progress window (HTA)
if exist "%PROGRESS_HTA%" start "" mshta.exe "%PROGRESS_HTA%"

echo [%DATE% %TIME%] Starting update process >> "%LOG_FILE%"
echo [%DATE% %TIME%] App dir: %APP_DIR% >> "%LOG_FILE%"
echo [%DATE% %TIME%] Executable: %EXECUTABLE% >> "%LOG_FILE%"
echo [%DATE% %TIME%] Mode: %UPDATE_MODE% >> "%LOG_FILE%"
echo [%DATE% %TIME%] Waiting for application to exit (PID: %APP_PID%)... >> "%LOG_FILE%"

:: Wait for the application to exit (max 30 seconds)
:: Uses CSV format + findstr for locale-independent PID detection.
set "WAIT_COUNT=0"
:wait_loop
set /a WAIT_COUNT+=1
if !WAIT_COUNT! GTR 30 (
    echo [%DATE% %TIME%] Timed out waiting for PID %APP_PID%, proceeding anyway >> "%LOG_FILE%"
    goto :done_waiting
)
tasklist /FI "PID eq %APP_PID%" /FO CSV /NH 2>NUL | findstr /C:"%APP_PID%" >NUL 2>NUL
if !ERRORLEVEL!==0 (
    timeout /t 1 /nobreak >NUL
    goto wait_loop
)

:done_waiting
echo [%DATE% %TIME%] Application exited, proceeding with update >> "%LOG_FILE%"

:: Small delay to ensure file handles are released
timeout /t 2 /nobreak >NUL

:: Check if we have write access to the app directory.
:: Per-machine NSIS installs go to Program Files, which requires elevation.
:: Try writing a temp file; if it fails, re-launch this script elevated.
set "ELEVATE_TEST=%APP_DIR%\\.nirs4all_update_test"
echo test > "%ELEVATE_TEST%" 2>NUL
if !ERRORLEVEL! neq 0 (
    echo [%DATE% %TIME%] No write access to %APP_DIR%, requesting elevation... >> "%LOG_FILE%"
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >NUL 2>NUL
    exit /b 0
)
del "%ELEVATE_TEST%" 2>NUL

if "%UPDATE_MODE%"=="portable" goto :portable_update

:: ===== Directory mode: full backup and replace =====
echo [%DATE% %TIME%] Creating backup... >> "%LOG_FILE%"
if exist "%BACKUP_DIR%" rmdir /s /q "%BACKUP_DIR%"
mkdir "%BACKUP_DIR%"
xcopy /e /i /h /y "%APP_DIR%\\*" "%BACKUP_DIR%\\" >> "%LOG_FILE%" 2>&1

set "COPY_ATTEMPT=0"
:copy_loop
set /a COPY_ATTEMPT+=1
echo [%DATE% %TIME%] Installing update (attempt !COPY_ATTEMPT!)... >> "%LOG_FILE%"
xcopy /e /i /h /y "%STAGING_DIR%\\*" "%APP_DIR%\\" >> "%LOG_FILE%" 2>&1

if !ERRORLEVEL! neq 0 (
    if !COPY_ATTEMPT! lss 10 (
        echo [%DATE% %TIME%] Copy failed, retrying in 3 seconds... >> "%LOG_FILE%"
        timeout /t 3 /nobreak >NUL
        goto copy_loop
    )
    echo [%DATE% %TIME%] Update failed after 10 retries, restoring backup... >> "%LOG_FILE%"
    xcopy /e /i /h /y "%BACKUP_DIR%\\*" "%APP_DIR%\\" >> "%LOG_FILE%" 2>&1
    goto cleanup
)

echo [%DATE% %TIME%] Update completed successfully >> "%LOG_FILE%"
goto cleanup

:portable_update
:: ===== Portable mode: replace single executable =====
echo [%DATE% %TIME%] Creating backup of portable exe... >> "%LOG_FILE%"
if exist "%BACKUP_DIR%" rmdir /s /q "%BACKUP_DIR%"
mkdir "%BACKUP_DIR%"
copy /y "%APP_DIR%\\%EXECUTABLE%" "%BACKUP_DIR%\\%EXECUTABLE%" >> "%LOG_FILE%" 2>&1

set "COPY_ATTEMPT=0"
:portable_copy_loop
set /a COPY_ATTEMPT+=1
echo [%DATE% %TIME%] Replacing portable exe (attempt !COPY_ATTEMPT!)... >> "%LOG_FILE%"
copy /y "%STAGING_DIR%\\%EXECUTABLE%" "%APP_DIR%\\%EXECUTABLE%" >> "%LOG_FILE%" 2>&1

if !ERRORLEVEL! neq 0 (
    if !COPY_ATTEMPT! lss 10 (
        echo [%DATE% %TIME%] Copy failed, retrying in 3 seconds... >> "%LOG_FILE%"
        timeout /t 3 /nobreak >NUL
        goto portable_copy_loop
    )
    echo [%DATE% %TIME%] Update failed after 10 retries, restoring backup... >> "%LOG_FILE%"
    copy /y "%BACKUP_DIR%\\%EXECUTABLE%" "%APP_DIR%\\%EXECUTABLE%" >> "%LOG_FILE%" 2>&1
    goto cleanup
)

echo [%DATE% %TIME%] Update completed successfully >> "%LOG_FILE%"

:cleanup
:: Clean up staging directory
rmdir /s /q "%STAGING_DIR%" 2>NUL

:: Close progress window
taskkill /f /fi "WINDOWTITLE eq nirs4all Studio - Updating" >NUL 2>NUL

:: Launch the updated application
echo [%DATE% %TIME%] Launching updated application... >> "%LOG_FILE%"
start "" "%APP_DIR%\\%EXECUTABLE%"

:: Self-delete this script
(goto) 2>nul & del "%~f0"
'''


# ---------- Unix shell script template ----------

UNIX_UPDATER_TEMPLATE = '''#!/bin/bash

# nirs4all-webapp updater script
# This script is generated automatically - do not edit

APP_PID="{app_pid}"
APP_DIR="{app_dir}"
STAGING_DIR="{staging_dir}"
BACKUP_DIR="{backup_dir}"
EXECUTABLE="{executable}"
LOG_FILE="{log_file}"

log() {{
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}}

log "Starting update process"
log "Waiting for application to exit (PID: $APP_PID)..."

# Wait for the application to exit (max 30 seconds)
WAIT_COUNT=0
while kill -0 "$APP_PID" 2>/dev/null; do
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ "$WAIT_COUNT" -gt 30 ]; then
        log "Timed out waiting for PID $APP_PID, proceeding anyway"
        break
    fi
    sleep 1
done

log "Application exited, proceeding with update"

# Small delay to ensure file handles are released
sleep 2

# Backup current version
log "Creating backup..."
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -R "$APP_DIR"/* "$BACKUP_DIR/" 2>> "$LOG_FILE"

# Copy new files
log "Installing update..."
cp -R "$STAGING_DIR"/* "$APP_DIR/" 2>> "$LOG_FILE"

if [ $? -ne 0 ]; then
    log "Update failed, restoring backup..."
    cp -R "$BACKUP_DIR"/* "$APP_DIR/" 2>> "$LOG_FILE"
else
    log "Update completed successfully"
fi

# Clean up staging directory
rm -rf "$STAGING_DIR"

# Make executable
chmod +x "$APP_DIR/$EXECUTABLE"

# Launch the updated application
log "Launching updated application..."
nohup "$APP_DIR/$EXECUTABLE" > /dev/null 2>&1 &

# Self-delete this script
rm -f "$0"
'''


def create_updater_script(
    staging_dir: Path,
    app_dir: Path | None = None,
) -> tuple[Path, str]:
    """
    Create a platform-specific updater script.

    Args:
        staging_dir: Directory containing the staged update files
        app_dir: Application directory (defaults to detected location)

    Returns:
        Tuple of (script_path, script_content)
    """
    if app_dir is None:
        app_dir = get_app_directory()

    backup_dir = get_backup_dir()
    log_dir = Path(platformdirs.user_log_dir(APP_NAME, APP_AUTHOR))
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "update.log"

    # When running under Electron, wait for the Electron process (our parent)
    # instead of the Python backend. The Electron process holds file locks on
    # the .exe and asar files that must be released before we can copy.
    if os.environ.get("NIRS4ALL_ELECTRON"):
        app_pid = os.getppid()  # Electron main process
    else:
        app_pid = os.getpid()   # Python backend (web/standalone mode)
    executable = get_executable_name()
    portable = is_portable_mode()

    print(f"[Updater] app_dir={app_dir}, executable={executable}, app_pid={app_pid}, portable={portable}")
    print(f"[Updater] staging_dir={staging_dir}, backup_dir={backup_dir}")

    script_dir = Path(tempfile.gettempdir())

    if sys.platform == "win32":
        # Write the progress HTA file alongside the batch script
        hta_path = script_dir / "nirs4all_updater_progress.hta"
        with open(hta_path, "w", encoding="utf-8") as f:
            f.write(PROGRESS_HTA_CONTENT)

        script_content = WINDOWS_UPDATER_TEMPLATE.format(
            app_pid=app_pid,
            app_dir=str(app_dir),
            staging_dir=str(staging_dir),
            backup_dir=str(backup_dir),
            executable=executable,
            log_file=str(log_file),
            progress_hta=str(hta_path),
            update_mode="portable" if portable else "directory",
        )
        script_name = "nirs4all_updater.bat"
    else:
        script_content = UNIX_UPDATER_TEMPLATE.format(
            app_pid=app_pid,
            app_dir=str(app_dir),
            staging_dir=str(staging_dir),
            backup_dir=str(backup_dir),
            executable=executable,
            log_file=str(log_file),
        )
        script_name = "nirs4all_updater.sh"

    script_path = script_dir / script_name

    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script_content)

    # Make executable on Unix
    if sys.platform != "win32":
        script_path.chmod(script_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    return script_path, script_content


def launch_updater(script_path: Path) -> bool:
    """
    Launch the updater script and prepare to exit.

    On Windows, uses a VBScript wrapper to launch the batch file with a
    hidden console window AND as a fully detached process. This solves two
    issues simultaneously:
    - DETACHED_PROCESS and CREATE_NO_WINDOW are mutually exclusive Windows
      flags (using both causes a visible console), so VBS handles hiding.
    - The WshShell.Run-spawned cmd.exe is a child of wscript.exe (not of
      the Python backend or Electron), so it survives when Electron exits.

    Args:
        script_path: Path to the updater script

    Returns:
        True if updater was launched successfully
    """
    try:
        if sys.platform == "win32":
            # Create a VBScript that launches the batch file with a hidden
            # window.  wscript.exe is a GUI app (no console flicker) and
            # WshShell.Run with window style 0 hides cmd.exe's console.
            vbs_path = script_path.parent / "nirs4all_updater_launcher.vbs"
            bat = str(script_path).replace('"', '""')
            with open(vbs_path, "w", encoding="utf-8") as f:
                f.write('Set s = CreateObject("WScript.Shell")\n')
                f.write(f's.Run "cmd /c ""{bat}""", 0, False\n')

            # wscript.exe is a GUI subsystem app — DETACHED_PROCESS won't
            # create a console.  CREATE_NEW_PROCESS_GROUP gives it its own
            # process group so it is not killed by taskkill /f on the backend.
            subprocess.Popen(
                ["wscript.exe", str(vbs_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            )
        else:
            # On Unix, launch with nohup
            subprocess.Popen(
                ["nohup", str(script_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        return True
    except Exception as e:
        print(f"Failed to launch updater: {e}")
        return False


def cleanup_old_updates() -> None:
    """Clean up old update artifacts.

    Called at startup after a successful launch.  Only cleans up
    post-update leftovers (backup dir, already-applied staging).
    Downloaded/staged updates that have NOT been applied yet are
    preserved so the user can apply them without re-downloading.
    """
    try:
        backup_dir = get_backup_dir()
        update_was_applied = backup_dir.exists() and any(backup_dir.iterdir())

        # Always clean backup directory — it's only used during the
        # update process for rollback and is no longer needed.
        if backup_dir.exists():
            shutil.rmtree(backup_dir, ignore_errors=True)

        # Only clean staging and cache if an update was just applied
        # (indicated by the backup dir having content). This preserves
        # downloaded-but-not-yet-applied updates across restarts.
        if update_was_applied:
            staging_dir = get_staging_dir()
            cache_dir = get_update_cache_dir()
            if staging_dir.exists():
                shutil.rmtree(staging_dir, ignore_errors=True)
            if cache_dir.exists():
                shutil.rmtree(cache_dir, ignore_errors=True)
    except Exception as e:
        print(f"Warning: Cleanup failed: {e}")
