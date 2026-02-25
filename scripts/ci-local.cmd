@echo off
setlocal enabledelayedexpansion
REM =============================================================================
REM ci-local.cmd - Run all webapp CI checks locally (parallelized)
REM =============================================================================
REM Usage:
REM   scripts\ci-local.cmd          Run everything (lint + tests + build)
REM   scripts\ci-local.cmd lint     ESLint + TypeScript + node registry + ruff + syntax (parallel)
REM   scripts\ci-local.cmd test     Vitest + pytest backend (parallel)
REM   scripts\ci-local.cmd build    Web + Electron builds
REM   scripts\ci-local.cmd e2e      Playwright E2E
REM =============================================================================

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
cd /d "%PROJECT_ROOT%"

set "VENV=%PROJECT_ROOT%\..\.venv"
set "P=0"
set "F=0"
set "PL="
set "FL="

REM ESC character for ANSI colors (Windows 10+)
for /f %%e in ('echo prompt $E ^| cmd') do set "E=%%e"

if exist "%VENV%\Scripts\activate.bat" (
    call "%VENV%\Scripts\activate.bat"
) else (
    echo %E%[33mNo .venv found at %VENV% - using system Python%E%[0m
)

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=all"

if /i "%TARGET%"=="lint"  goto :lint
if /i "%TARGET%"=="test"  goto :test
if /i "%TARGET%"=="build" goto :build
if /i "%TARGET%"=="e2e"   goto :e2e
if /i "%TARGET%"=="all"   goto :lint
echo Usage: %~nx0 {all^|lint^|test^|build^|e2e}
exit /b 1

REM ===== LINT (5 checks in parallel) =====
:lint

echo.
echo %E%[36m%E%[1m=== Lint (5 checks in parallel) ===%E%[0m
call npx concurrently --group --names "eslint,tsc,nodes,ruff,py-syntax" --prefix-colors "blue,cyan,magenta,yellow,green" "npm:lint:eslint" "npm:lint:tsc" "npm:lint:nodes" "npm:lint:ruff" "npm:lint:py-syntax"
if !errorlevel! equ 0 ( set /a P+=1 & set "PL=!PL! lint" & echo %E%[32mOK%E%[0m lint ) else ( set /a F+=1 & set "FL=!FL! lint" & echo %E%[31mFAIL%E%[0m lint )

if /i not "%TARGET%"=="all" goto :summary

REM ===== TEST (vitest + pytest in parallel) =====
:test

echo.
echo %E%[36m%E%[1m=== Tests (vitest + pytest in parallel) ===%E%[0m
call npx concurrently --group --names "vitest,pytest" --prefix-colors "blue,yellow" "npm:test:frontend" "npm:test:backend"
if !errorlevel! equ 0 ( set /a P+=1 & set "PL=!PL! test" & echo %E%[32mOK%E%[0m test ) else ( set /a F+=1 & set "FL=!FL! test" & echo %E%[31mFAIL%E%[0m test )

if /i not "%TARGET%"=="all" goto :summary

REM ===== BUILD (sequential — shared Vite cache) =====
:build

echo.
echo %E%[36m%E%[1m--- build-web ---%E%[0m
call npm run build
if !errorlevel! equ 0 ( set /a P+=1 & set "PL=!PL! build-web" & echo %E%[32mOK%E%[0m build-web ) else ( set /a F+=1 & set "FL=!FL! build-web" & echo %E%[31mFAIL%E%[0m build-web )

echo.
echo %E%[36m%E%[1m--- build-electron ---%E%[0m
cmd /c "set ELECTRON=true && call npm run build:electron"
if !errorlevel! equ 0 ( set /a P+=1 & set "PL=!PL! build-electron" & echo %E%[32mOK%E%[0m build-electron ) else ( set /a F+=1 & set "FL=!FL! build-electron" & echo %E%[31mFAIL%E%[0m build-electron )

echo.
echo %E%[36m%E%[1m--- verify-build ---%E%[0m
set "BOK=1"
if not exist "dist\index.html" ( echo dist\index.html not found & set "BOK=0" )
if not exist "dist-electron" ( echo dist-electron\ not found & set "BOK=0" )
if "!BOK!"=="1" ( echo Build outputs verified & set /a P+=1 & set "PL=!PL! verify-build" & echo %E%[32mOK%E%[0m verify-build ) else ( set /a F+=1 & set "FL=!FL! verify-build" & echo %E%[31mFAIL%E%[0m verify-build )

if /i not "%TARGET%"=="all" goto :summary
goto :summary

REM ===== E2E =====
:e2e

echo.
echo %E%[36m%E%[1m--- playwright ---%E%[0m
call npx playwright test --project=web-chromium
if !errorlevel! equ 0 ( set /a P+=1 & set "PL=!PL! playwright" & echo %E%[32mOK%E%[0m playwright ) else ( set /a F+=1 & set "FL=!FL! playwright" & echo %E%[31mFAIL%E%[0m playwright )

goto :summary

REM ===== SUMMARY =====
:summary
echo.
echo %E%[1m===================================================%E%[0m
echo %E%[1m Results%E%[0m
echo %E%[1m===================================================%E%[0m
for %%i in (!PL!) do echo   %E%[32mOK%E%[0m   %%i
for %%i in (!FL!) do echo   %E%[31mFAIL%E%[0m %%i
echo %E%[1m===================================================%E%[0m
if !F! equ 0 (
    echo %E%[32m%E%[1m All !P! checks passed%E%[0m
    exit /b 0
) else (
    echo %E%[31m%E%[1m !F! failed%E%[0m, %E%[32m!P! passed%E%[0m
    exit /b 1
)
