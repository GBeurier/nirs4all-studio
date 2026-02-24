@echo off
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
REM  Options are forwarded to the underlying script.
REM  Run with -Help (PowerShell) or --help (bash) for details.
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
