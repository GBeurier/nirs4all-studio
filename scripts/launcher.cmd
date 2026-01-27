@echo off
setlocal enabledelayedexpansion
REM =============================================================================
REM nirs4all webapp - Unified Launcher (Windows)
REM =============================================================================
REM Commands:
REM   start <mode>  - Start servers (web:dev, web:prod, desktop:dev, desktop:prod)
REM   stop          - Stop all running servers
REM   restart       - Restart servers (stop + start)
REM   clean         - Stop servers and clean build artifacts
REM   status        - Show server status
REM =============================================================================

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
cd /d "%PROJECT_ROOT%"

set "PORT_FRONTEND=5173"
set "PORT_BACKEND=8000"
set "NIRS4ALL_VENV=%PROJECT_ROOT%\..\.venv"
set "LOG_DIR=%TEMP%\nirs4all"

REM Ensure log directory exists
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Parse arguments
set "COMMAND="
set "MODE="
set "NO_BUILD="

:parse_args
if "%~1"=="" goto :run_command
if /i "%~1"=="start" set "COMMAND=start" & shift & goto :parse_args
if /i "%~1"=="stop" set "COMMAND=stop" & shift & goto :parse_args
if /i "%~1"=="restart" set "COMMAND=restart" & shift & goto :parse_args
if /i "%~1"=="clean" set "COMMAND=clean" & shift & goto :parse_args
if /i "%~1"=="status" set "COMMAND=status" & shift & goto :parse_args
if /i "%~1"=="web:dev" set "MODE=web:dev" & shift & goto :parse_args
if /i "%~1"=="web:prod" set "MODE=web:prod" & shift & goto :parse_args
if /i "%~1"=="desktop:dev" set "MODE=desktop:dev" & shift & goto :parse_args
if /i "%~1"=="desktop:prod" set "MODE=desktop:prod" & shift & goto :parse_args
if /i "%~1"=="--no-build" set "NO_BUILD=true" & shift & goto :parse_args
if /i "%~1"=="--help" goto :print_usage
if /i "%~1"=="-h" goto :print_usage
echo Unknown option: %~1
goto :print_usage

:run_command
if "%COMMAND%"=="" goto :interactive_menu
if "%COMMAND%"=="start" goto :cmd_start
if "%COMMAND%"=="stop" goto :cmd_stop
if "%COMMAND%"=="restart" goto :cmd_restart
if "%COMMAND%"=="clean" goto :cmd_clean
if "%COMMAND%"=="status" goto :cmd_status
goto :print_usage

REM =============================================================================
REM Interactive Menu
REM =============================================================================

:interactive_menu
echo.
echo ========================================
echo   nirs4all webapp - Launcher
echo ========================================
echo.
echo   1) web:dev        (Vite + FastAPI)
echo   2) web:prod       (FastAPI serves build)
echo   3) desktop:dev    (Electron + Vite)
echo   4) desktop:prod   (Electron + build)
echo   5) stop
echo   6) status
echo   0) Exit
echo.
set /p MENU_CHOICE="Choose [0-6]: "
if "%MENU_CHOICE%"=="0" exit /b 0
if "%MENU_CHOICE%"=="1" set "COMMAND=start" & set "MODE=web:dev" & goto :cmd_start
if "%MENU_CHOICE%"=="2" set "COMMAND=start" & set "MODE=web:prod" & goto :cmd_start
if "%MENU_CHOICE%"=="3" set "COMMAND=start" & set "MODE=desktop:dev" & goto :cmd_start
if "%MENU_CHOICE%"=="4" set "COMMAND=start" & set "MODE=desktop:prod" & goto :cmd_start
if "%MENU_CHOICE%"=="5" goto :cmd_stop
if "%MENU_CHOICE%"=="6" goto :cmd_status
goto :interactive_menu

REM =============================================================================
REM Print Usage
REM =============================================================================

:print_usage
echo.
echo ========================================
echo   nirs4all webapp - Launcher
echo ========================================
echo.
echo Usage: %~nx0 ^<command^> [options]
echo.
echo Commands:
echo   start ^<mode^>     Start servers
echo   stop             Stop all running servers
echo   restart [mode]   Restart servers (default: web:dev)
echo   clean            Stop servers and clean build artifacts
echo   status           Show server status
echo.
echo Modes:
echo   web:dev          Web development (Vite + FastAPI with hot reload)
echo   web:prod         Web production (FastAPI serves built frontend)
echo   desktop:dev      Desktop development (Electron + Vite dev server)
echo   desktop:prod     Desktop production (Electron + built frontend)
echo.
echo Options:
echo   --no-build       Skip frontend build (for prod modes)
echo   --help, -h       Show this help message
echo.
echo Examples:
echo   %~nx0 start web:dev
echo   %~nx0 stop
echo   %~nx0 restart web:dev
echo   %~nx0 clean
echo.
exit /b 1

REM =============================================================================
REM Check Prerequisites
REM =============================================================================

:check_venv
if not exist "%NIRS4ALL_VENV%\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found at %NIRS4ALL_VENV%
    echo Create it in nirs4all\ with:
    echo   cd ..\nirs4all ^&^& python -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -e .
    exit /b 1
)
exit /b 0

:check_node_modules
if not exist "node_modules" (
    echo ERROR: node_modules not found
    echo Run: npm install
    exit /b 1
)
exit /b 0

REM =============================================================================
REM Stop Command
REM =============================================================================

:cmd_stop
echo.
echo ========================================
echo   Stop Servers
echo ========================================
echo.
echo Stopping processes...

REM Kill Node/Vite processes
taskkill /F /IM "node.exe" /FI "WINDOWTITLE eq *vite*" 2>nul
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq node.exe" /fo list ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | findstr /i "vite" >nul && taskkill /F /PID %%a 2>nul
)

REM Kill Python backend processes
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq python.exe" /fo list ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | findstr /i "uvicorn main:app" >nul && taskkill /F /PID %%a 2>nul
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | findstr /i "main.py" >nul && taskkill /F /PID %%a 2>nul
)

REM Kill Electron
taskkill /F /IM "electron.exe" 2>nul

echo.
echo Freeing ports...

REM Kill processes on ports
for %%p in (%PORT_FRONTEND% %PORT_BACKEND%) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        if not "%%a"=="0" (
            taskkill /F /PID %%a 2>nul && echo   Port %%p freed
        )
    )
)

echo.
echo All servers stopped
exit /b 0

REM =============================================================================
REM Status Command
REM =============================================================================

:cmd_status
echo.
echo ========================================
echo   Server Status
echo ========================================
echo.
echo Ports:

REM Check frontend port
netstat -ano | findstr ":%PORT_FRONTEND% " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo   Frontend ^(%PORT_FRONTEND%^): IN USE
) else (
    echo   Frontend ^(%PORT_FRONTEND%^): FREE
)

REM Check backend port
netstat -ano | findstr ":%PORT_BACKEND% " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo   Backend ^(%PORT_BACKEND%^):  IN USE
) else (
    echo   Backend ^(%PORT_BACKEND%^):  FREE
)

echo.
echo Logs:
echo   Backend:  %LOG_DIR%\backend.log
echo   Frontend: %LOG_DIR%\frontend.log
echo   Desktop:  %LOG_DIR%\desktop.log
exit /b 0

REM =============================================================================
REM Clean Command
REM =============================================================================

:cmd_clean
echo.
echo ========================================
echo   Clean
echo ========================================
echo.
call :cmd_stop
echo.
echo Cleaning build artifacts...
if exist "dist" rmdir /s /q "dist"
if exist "dist-electron" rmdir /s /q "dist-electron"
if exist "backend-dist" rmdir /s /q "backend-dist"
if exist "build" rmdir /s /q "build"
if exist "release" rmdir /s /q "release"
if exist ".vite" rmdir /s /q ".vite"
del /q "%LOG_DIR%\*.log" 2>nul
echo Build artifacts cleaned
exit /b 0

REM =============================================================================
REM Start Command
REM =============================================================================

:cmd_start
if "%MODE%"=="" (
    echo ERROR: No mode specified
    echo Usage: %~nx0 start ^<mode^>
    echo Modes: web:dev, web:prod, desktop:dev, desktop:prod
    exit /b 1
)
if "%MODE%"=="web:dev" goto :start_web_dev
if "%MODE%"=="web:prod" goto :start_web_prod
if "%MODE%"=="desktop:dev" goto :start_desktop_dev
if "%MODE%"=="desktop:prod" goto :start_desktop_prod
echo Unknown mode: %MODE%
exit /b 1

REM =============================================================================
REM Web Dev
REM =============================================================================

:start_web_dev
echo.
echo ========================================
echo   Web Development
echo ========================================
echo.

call :check_venv || exit /b 1
call :check_node_modules || exit /b 1
call :cmd_stop

echo.
echo Starting backend (FastAPI)...
call "%NIRS4ALL_VENV%\Scripts\activate.bat"
start /b cmd /c "python -m uvicorn main:app --host 127.0.0.1 --port %PORT_BACKEND% --reload --log-level warning > "%LOG_DIR%\backend.log" 2>&1"
echo   Backend starting...

REM Wait for backend
echo Waiting for backend...
set /a retries=0
:wait_backend
timeout /t 1 /nobreak >nul
curl -s "http://127.0.0.1:%PORT_BACKEND%/api/health" >nul 2>&1
if %errorlevel%==0 (
    echo   Backend ready
    goto :backend_ready
)
set /a retries+=1
if %retries% lss 30 goto :wait_backend
echo   Backend: timeout (may still be starting)

:backend_ready
echo.
echo Starting frontend (Vite)...
start /b cmd /c "npm run dev > "%LOG_DIR%\frontend.log" 2>&1"
echo   Frontend starting...

REM Wait for frontend
echo Waiting for frontend...
set /a retries=0
:wait_frontend
timeout /t 1 /nobreak >nul
curl -s "http://127.0.0.1:%PORT_FRONTEND%" >nul 2>&1
if %errorlevel%==0 (
    echo   Frontend ready
    goto :frontend_ready
)
set /a retries+=1
if %retries% lss 30 goto :wait_frontend
echo   Frontend: timeout (may still be starting)

:frontend_ready
echo.
echo ========================================
echo   Web Development servers running
echo ========================================
echo   Frontend: http://localhost:%PORT_FRONTEND%
echo   Backend:  http://localhost:%PORT_BACKEND%
echo   API Docs: http://localhost:%PORT_BACKEND%/docs
echo.
echo   Logs: %LOG_DIR%\
echo   Stop: scripts\launcher.cmd stop
echo.
exit /b 0

REM =============================================================================
REM Web Prod
REM =============================================================================

:start_web_prod
echo.
echo ========================================
echo   Web Production
echo ========================================
echo.

call :check_venv || exit /b 1
call :check_node_modules || exit /b 1
call :cmd_stop

if not "%NO_BUILD%"=="true" (
    echo.
    echo Building frontend...
    call npm run build
    echo   Frontend built
)

if not exist "dist" (
    echo ERROR: dist\ not found. Run without --no-build
    exit /b 1
)

echo.
echo Starting production server...
call "%NIRS4ALL_VENV%\Scripts\activate.bat"
set "NIRS4ALL_PRODUCTION=true"
start /b cmd /c "python main.py > "%LOG_DIR%\backend.log" 2>&1"
echo   Server starting...

REM Wait for server
echo Waiting for server...
set /a retries=0
:wait_prod
timeout /t 1 /nobreak >nul
curl -s "http://127.0.0.1:%PORT_BACKEND%/api/health" >nul 2>&1
if %errorlevel%==0 (
    echo   Server ready
    goto :prod_ready
)
set /a retries+=1
if %retries% lss 30 goto :wait_prod
echo   Server: timeout (may still be starting)

:prod_ready
echo.
echo ========================================
echo   Web Production server running
echo ========================================
echo   Application: http://localhost:%PORT_BACKEND%
echo   API Docs:    http://localhost:%PORT_BACKEND%/docs
echo.
echo   Log: %LOG_DIR%\backend.log
echo   Stop: scripts\launcher.cmd stop
echo.
exit /b 0

REM =============================================================================
REM Desktop Dev
REM =============================================================================

:start_desktop_dev
echo.
echo ========================================
echo   Desktop Development (Electron)
echo ========================================
echo.

call :check_venv || exit /b 1
call :check_node_modules || exit /b 1
call :cmd_stop

echo.
echo Launching Electron in development mode...
call npm run dev:electron
echo.
echo Desktop window closed
exit /b 0

REM =============================================================================
REM Desktop Prod
REM =============================================================================

:start_desktop_prod
echo.
echo ========================================
echo   Desktop Production (Electron)
echo ========================================
echo.

call :check_venv || exit /b 1
call :check_node_modules || exit /b 1
call :cmd_stop

if not "%NO_BUILD%"=="true" (
    echo.
    echo Building Electron app...
    call npm run build:electron
    echo   Electron app built
)

if not exist "dist-electron" (
    echo ERROR: dist-electron\ not found. Run without --no-build
    exit /b 1
)

echo.
echo Launching Electron...
call npm run electron:preview
echo.
echo Desktop window closed
exit /b 0

REM =============================================================================
REM Restart Command
REM =============================================================================

:cmd_restart
if "%MODE%"=="" set "MODE=web:dev"
goto :cmd_start
