param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [int]$WaitSeconds = 0,

    [switch]$SimulatePortable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-LatestWriteUtc {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $null
    }

    $latest = (Get-Item -LiteralPath $Path).LastWriteTimeUtc
    Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.LastWriteTimeUtc -gt $latest) {
                $latest = $_.LastWriteTimeUtc
            }
        }
    return $latest
}

$sourceExe = (Resolve-Path -LiteralPath $ExecutablePath).Path
$runRoot = Join-Path $env:TEMP ("n4a-portable-smoke-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$simulatedPortableExe = Join-Path $runRoot (Split-Path -Path $sourceExe -Leaf)
$portableRoot = Join-Path $runRoot ".nirs4all"

$sharedDirs = @(
    (Join-Path $env:APPDATA "nirs4all Studio"),
    (Join-Path $env:APPDATA "nirs4all"),
    (Join-Path $env:LOCALAPPDATA "nirs4all-webapp")
)

$baseline = @{}
foreach ($dir in $sharedDirs) {
    $baseline[$dir] = Get-LatestWriteUtc -Path $dir
}

New-Item -ItemType Directory -Path $runRoot | Out-Null

if (-not $SimulatePortable) {
    Copy-Item -LiteralPath $sourceExe -Destination $simulatedPortableExe
}

Write-Host ""
Write-Host "Portable smoke run"
Write-Host "  Source exe : $sourceExe"
Write-Host "  Run root   : $runRoot"
Write-Host "  Portable   : $portableRoot"
Write-Host "  Mode       : $(if ($SimulatePortable) { 'simulate PORTABLE_EXECUTABLE_FILE on unpacked exe' } else { 'real portable wrapper' })"
Write-Host ""
Write-Host "Launching portable build..."

if ($SimulatePortable) {
    $portableExeEscaped = $simulatedPortableExe.Replace("'", "''")
    $sourceExeEscaped = $sourceExe.Replace("'", "''")
    $command = "`$env:PORTABLE_EXECUTABLE_FILE = '$portableExeEscaped'; & '$sourceExeEscaped'"
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command", $command
    ) -WorkingDirectory (Split-Path -Path $sourceExe -Parent) -PassThru
} else {
    $proc = Start-Process -FilePath $simulatedPortableExe -PassThru
}

if ($WaitSeconds -gt 0) {
    Start-Sleep -Seconds $WaitSeconds
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
    }
} else {
    Write-Host "Close the app once it has finished startup, then press Enter here."
    [void](Read-Host)
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
    }
}

Write-Host ""
if (Test-Path $portableRoot) {
    Write-Host "Portable root created:"
    Get-ChildItem -LiteralPath $portableRoot -Force | Select-Object Mode, LastWriteTime, Name
} else {
    Write-Host "Portable root was not created."
}

$changedSharedDirs = @()
foreach ($dir in $sharedDirs) {
    $after = Get-LatestWriteUtc -Path $dir
    $before = $baseline[$dir]

    if ($before -eq $null -and $after -ne $null) {
        $changedSharedDirs += $dir
        continue
    }

    if ($before -ne $null -and $after -ne $null -and $after -gt $before) {
        $changedSharedDirs += $dir
    }
}

Write-Host ""
if ($changedSharedDirs.Count -eq 0) {
    Write-Host "PASS: no shared AppData locations changed during the portable run."
} else {
    Write-Host "WARNING: shared AppData locations changed:"
    $changedSharedDirs | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "Next check:"
Write-Host "  Verify that startup logs and env state live under $portableRoot"
