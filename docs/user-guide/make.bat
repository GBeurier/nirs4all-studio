:; printf '%s\n' "This Windows batch file must be run with cmd.exe or PowerShell, not bash." >&2; exit 1
@ECHO OFF
REM The leading ':;' line is a cross-shell guard: cmd treats it as a label, bash exits.
pushd %~dp0

if "%SPHINXBUILD%" == "" (
	set SPHINXBUILD=sphinx-build
)
set SOURCEDIR=source
set BUILDDIR=_build

%SPHINXBUILD% >NUL 2>NUL
if errorlevel 9009 (
	echo.The 'sphinx-build' command was not found.
	exit /b 1
)

if "%1" == "" goto help

%SPHINXBUILD% -M %1 %SOURCEDIR% %BUILDDIR% %SPHINXOPTS% %O%
goto end

:help
%SPHINXBUILD% -M help %SOURCEDIR% %BUILDDIR% %SPHINXOPTS% %O%

:end
popd
