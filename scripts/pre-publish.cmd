:; printf '%s\n' "This Windows batch file must be run with cmd.exe or PowerShell, not bash." >&2; exit 1
@echo off
REM The leading ':;' line is a cross-shell guard: cmd treats it as a label, bash exits.
REM ==========================================================
REM  nirs4all webapp - Pre-publish Validation (Windows)
REM ==========================================================
REM
REM  Runs pre-publish validation using PowerShell (native) or
REM  bash (Git Bash / WSL) as fallback.
REM
REM  Usage:
REM    scripts\pre-publish.cmd [OPTIONS]
REM
REM  This wrapper invokes pre-publish.ps1 first, so use PowerShell-style options:
REM    -Only lint|tests|e2e|build
REM    -SkipBackend  -SkipE2E  -SkipBuild  -SkipElectron  -Python PATH  -Help
REM  Run scripts\pre-publish.sh --help only when using the bash variant directly.
REM
REM ==========================================================

REM Try PowerShell first (always available on Windows)
where powershell >nul 2>&1
if %errorlevel% equ 0 (
    powershell -ExecutionPolicy Bypass -File "%~dp0pre-publish.ps1" %*
    exit /b %errorlevel%
)

REM Fallback to bash
where bash >nul 2>&1
if %errorlevel% equ 0 (
    bash "%~dp0pre-publish.sh" %*
    exit /b %errorlevel%
)

echo.
echo  ERROR: Neither PowerShell nor bash found.
echo.
echo  Run directly from PowerShell:
echo    .\scripts\pre-publish.ps1
echo.
exit /b 1
