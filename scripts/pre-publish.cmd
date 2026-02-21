@echo off
REM ==========================================================
REM  nirs4all webapp - Pre-publish Validation (Windows)
REM ==========================================================
REM
REM  This script delegates to the bash pre-publish.sh script.
REM  On Windows, use one of:
REM    1. Docker:    scripts\pre-publish.cmd --docker
REM    2. WSL:       wsl bash scripts/pre-publish.sh
REM    3. Git Bash:  bash scripts/pre-publish.sh
REM
REM ==========================================================

where bash >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: bash not found.
    echo.
    echo  Install Git for Windows ^(includes Git Bash^) or use WSL:
    echo    wsl bash scripts/pre-publish.sh %*
    echo.
    exit /b 1
)

bash "%~dp0pre-publish.sh" %*
