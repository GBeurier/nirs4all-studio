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
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional, Tuple

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


def get_app_directory() -> Path:
    """Get the application installation directory."""
    if getattr(sys, "frozen", False):
        # Running as packaged executable
        return Path(sys.executable).parent
    else:
        # Running from source
        return Path(__file__).parent.parent


def get_executable_name() -> str:
    """Get the name of the main executable."""
    if sys.platform == "win32":
        return "nirs4all-webapp.exe"
    elif sys.platform == "darwin":
        return "nirs4all-webapp"
    else:
        return "nirs4all-webapp"


# Windows updater batch script template
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

echo [%DATE% %TIME%] Starting update process >> "%LOG_FILE%"
echo [%DATE% %TIME%] Waiting for application to exit (PID: %APP_PID%)... >> "%LOG_FILE%"

:: Wait for the application to exit
:wait_loop
tasklist /FI "PID eq %APP_PID%" 2>NUL | find /I "%APP_PID%" >NUL
if %ERRORLEVEL%==0 (
    timeout /t 1 /nobreak >NUL
    goto wait_loop
)

echo [%DATE% %TIME%] Application exited, proceeding with update >> "%LOG_FILE%"

:: Small delay to ensure file handles are released
timeout /t 2 /nobreak >NUL

:: Backup current version
echo [%DATE% %TIME%] Creating backup... >> "%LOG_FILE%"
if exist "%BACKUP_DIR%" rmdir /s /q "%BACKUP_DIR%"
mkdir "%BACKUP_DIR%"
xcopy /e /i /h /y "%APP_DIR%\\*" "%BACKUP_DIR%\\" >> "%LOG_FILE%" 2>&1

:: Copy new files
echo [%DATE% %TIME%] Installing update... >> "%LOG_FILE%"
xcopy /e /i /h /y "%STAGING_DIR%\\*" "%APP_DIR%\\" >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% neq 0 (
    echo [%DATE% %TIME%] Update failed, restoring backup... >> "%LOG_FILE%"
    xcopy /e /i /h /y "%BACKUP_DIR%\\*" "%APP_DIR%\\" >> "%LOG_FILE%" 2>&1
    goto cleanup
)

echo [%DATE% %TIME%] Update completed successfully >> "%LOG_FILE%"

:cleanup
:: Clean up staging directory
rmdir /s /q "%STAGING_DIR%" 2>NUL

:: Launch the updated application
echo [%DATE% %TIME%] Launching updated application... >> "%LOG_FILE%"
start "" "%APP_DIR%\\%EXECUTABLE%"

:: Self-delete this script
(goto) 2>nul & del "%~f0"
'''


# Unix updater shell script template
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

# Wait for the application to exit
while kill -0 "$APP_PID" 2>/dev/null; do
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

    app_pid = os.getpid()
    executable = get_executable_name()

    if sys.platform == "win32":
        script_content = WINDOWS_UPDATER_TEMPLATE.format(
            app_pid=app_pid,
            app_dir=str(app_dir),
            staging_dir=str(staging_dir),
            backup_dir=str(backup_dir),
            executable=executable,
            log_file=str(log_file),
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

    # Write script to temp directory
    script_dir = Path(tempfile.gettempdir())
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

    Args:
        script_path: Path to the updater script

    Returns:
        True if updater was launched successfully
    """
    try:
        if sys.platform == "win32":
            # On Windows, use start to launch in a new process
            subprocess.Popen(
                ["cmd", "/c", "start", "", str(script_path)],
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
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
    """Clean up old update artifacts."""
    try:
        cache_dir = get_update_cache_dir()
        staging_dir = get_staging_dir()
        backup_dir = get_backup_dir()

        # Clean staging directory (should be empty after successful update)
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)

        # Keep backup for recovery, but could add age-based cleanup
        # For now, just ensure the directory exists
        backup_dir.mkdir(parents=True, exist_ok=True)

        # Clean old cached downloads (keep last 2)
        if cache_dir.exists():
            files = sorted(cache_dir.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True)
            for f in files[2:]:
                if f.is_file():
                    f.unlink()
                elif f.is_dir():
                    shutil.rmtree(f, ignore_errors=True)
    except Exception as e:
        print(f"Warning: Cleanup failed: {e}")
