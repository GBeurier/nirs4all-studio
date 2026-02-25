# scripts/pre-publish.ps1
# Native PowerShell port of pre-publish.sh
# Mirrors .github/workflows/ci.yml + playwright.yml locally.
#
# Usage:
#   .\scripts\pre-publish.ps1 [OPTIONS]
#
# Options:
#   -SkipBackend         Skip backend lint + tests
#   -SkipE2E             Skip Playwright E2E tests
#   -SkipBuild           Skip production build validation
#   -SkipElectron        Skip Electron build test
#   -Only STEP           Run only one step: lint | validate-nodes | type-check |
#                        frontend-tests | backend-lint | backend-tests | e2e | build | electron
#   -Python PATH         Python interpreter to use (default: .venv\Scripts\python.exe or python)
#   -Help                Show this help

param(
    [switch]$SkipBackend,
    [switch]$SkipE2E,
    [switch]$SkipBuild,
    [switch]$SkipElectron,
    [string]$Only = "",
    [string]$Python = "",
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

# ──────────────────────────────────────────────────────────────────────────────
# UTF-8 output — ensures child processes (npm, npx, playwright) render correctly
# ──────────────────────────────────────────────────────────────────────────────

$prevOutputEncoding = [Console]::OutputEncoding
$prevPSOutputEncoding = $OutputEncoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Also set the console codepage so cmd /c children inherit UTF-8
$null = cmd /c "chcp 65001 >nul 2>&1"

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

$ESC = [char]27
$BOLD   = "$ESC[1m"
$RED    = "$ESC[0;31m"
$GREEN  = "$ESC[0;32m"
$YELLOW = "$ESC[1;33m"
$CYAN   = "$ESC[0;36m"
$RESET  = "$ESC[0m"

function Write-Info    { param([string]$Msg) Write-Host "${CYAN}[pre-publish]${RESET} $Msg" }
function Write-Success { param([string]$Msg) Write-Host "${GREEN}[pre-publish]${RESET} $Msg" }
function Write-Warn    { param([string]$Msg) Write-Host "${YELLOW}[pre-publish]${RESET} $Msg" }
function Write-Err     { param([string]$Msg) Write-Host "${RED}[pre-publish]${RESET} $Msg" -ForegroundColor Red }
function Write-Header  { param([string]$Msg)
    Write-Host ""
    Write-Host "${BOLD}${CYAN}$([string][char]0x2550 * 54)${RESET}"
    Write-Host "${BOLD}${CYAN}  $Msg${RESET}"
    Write-Host "${BOLD}${CYAN}$([string][char]0x2550 * 54)${RESET}"
}

# ──────────────────────────────────────────────────────────────────────────────
# Help
# ──────────────────────────────────────────────────────────────────────────────

if ($Help) {
    Write-Host @"
Usage:
  .\scripts\pre-publish.ps1 [OPTIONS]

Options:
  -SkipBackend         Skip backend lint + tests
  -SkipE2E             Skip Playwright E2E tests
  -SkipBuild           Skip production build validation
  -SkipElectron        Skip Electron build test
  -Only STEP           Run only one step: lint | validate-nodes | type-check |
                       frontend-tests | backend-lint | backend-tests | e2e | build | electron
  -Python PATH         Python interpreter to use (default: .venv\Scripts\python.exe or python)
  -Help                Show this help
"@
    exit 0
}

# ──────────────────────────────────────────────────────────────────────────────
# Resolve project root
# ──────────────────────────────────────────────────────────────────────────────

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir

if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
    Write-Err "Could not locate package.json under $ProjectRoot"
    exit 1
}

# ──────────────────────────────────────────────────────────────────────────────
# Resolve Python interpreter
# ──────────────────────────────────────────────────────────────────────────────

if (-not $Python) {
    $VenvLocal = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
    $VenvParent = Join-Path $ProjectRoot "..\.venv\Scripts\python.exe"
    if (Test-Path $VenvLocal) {
        $Python = $VenvLocal
    } elseif (Test-Path $VenvParent) {
        $Python = $VenvParent
    } else {
        $Python = "python"
    }
}

# Ensure venv tools (ruff, pytest, etc.) are in PATH for npm scripts
if ($Python -ne "python" -and (Test-Path $Python)) {
    $VenvBin = Split-Path -Parent $Python
    $env:PATH = "$VenvBin;$env:PATH"
}

# ──────────────────────────────────────────────────────────────────────────────
# State tracking
# ──────────────────────────────────────────────────────────────────────────────

$StepResult = @{}   # "pass" | "fail" | "skip"
$StepLog    = @{}   # path to log file
$OrderedSteps = [System.Collections.ArrayList]@()  # populated dynamically for summary

$TmpLogDir = Join-Path $env:TEMP "pre-publish-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $TmpLogDir -Force | Out-Null

function Invoke-Step {
    param(
        [string]$Name,
        [string]$Command
    )
    $safeName = $Name -replace '[^a-zA-Z0-9_-]', '_'
    $logFile = Join-Path $TmpLogDir "$safeName.log"
    $StepLog[$Name] = $logFile
    $null = $OrderedSteps.Add($Name)

    Write-Header $Name
    try {
        # Split command into executable + args and invoke directly (avoids cmd /c codepage issues)
        $parts = $Command -split '\s+', 2
        $exe = $parts[0]
        $cmdArgs = if ($parts.Length -gt 1) { $parts[1] -split '\s+' } else { @() }
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $exe @cmdArgs 2>&1 | Tee-Object -FilePath $logFile
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEAP
        }
        if ($exitCode -eq 0) {
            $StepResult[$Name] = "pass"
            Write-Success "$Name - PASSED"
        } else {
            $StepResult[$Name] = "fail"
            Write-Err "$Name - FAILED  (full log: $logFile)"
        }
    } catch {
        $_ | Out-File -FilePath $logFile -Append
        $StepResult[$Name] = "fail"
        Write-Err "$Name - FAILED  (full log: $logFile)"
    }
}

function Invoke-ParallelStep {
    param(
        [string]$Name,
        [string[]]$Names,
        [string[]]$Commands
    )
    $safeName = $Name -replace '[^a-zA-Z0-9_-]', '_'
    $logFile = Join-Path $TmpLogDir "$safeName.log"
    $StepLog[$Name] = $logFile
    $null = $OrderedSteps.Add($Name)

    Write-Header $Name
    try {
        $namesStr = $Names -join ","
        $npxArgs = @("concurrently", "--group", "--names", $namesStr) + $Commands
        # Temporarily allow stderr (npm warnings) without throwing
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & npx @npxArgs 2>&1 | Tee-Object -FilePath $logFile
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEAP
        }
        if ($exitCode -eq 0) {
            $StepResult[$Name] = "pass"
            Write-Success "$Name - PASSED"
        } else {
            $StepResult[$Name] = "fail"
            Write-Err "$Name - FAILED  (full log: $logFile)"
        }
    } catch {
        $_ | Out-File -FilePath $logFile -Append
        $StepResult[$Name] = "fail"
        Write-Err "$Name - FAILED  (full log: $logFile)"
    }
}

function Skip-Step {
    param([string]$Name)
    $StepResult[$Name] = "skip"
    $null = $OrderedSteps.Add($Name)
    Write-Warn "$Name - SKIPPED"
}

# ──────────────────────────────────────────────────────────────────────────────
# Steps
# ──────────────────────────────────────────────────────────────────────────────

try {
    Push-Location $ProjectRoot

    if ($Only) {
        # ── Single step mode ────────────────────────────────────────────────
        switch ($Only) {
            "lint"            { Invoke-Step "ESLint" "npm run lint" }
            "validate-nodes"  { Invoke-Step "Node Registry" "npm run validate:nodes" }
            "type-check"      { Invoke-Step "TypeScript" "npx tsc --noEmit" }
            "frontend-tests"  { Invoke-Step "Frontend Tests" "npm run test:frontend" }
            "backend-lint"    { Invoke-Step "Backend Lint" "npm run lint:ruff" }
            "backend-tests"   { Invoke-Step "Backend Tests" "npm run test:backend" }
            "e2e"             { Invoke-Step "E2E Tests" "npx playwright test --project=web-chromium --workers=2 --retries=2" }
            "build"           { Invoke-Step "Web Build" "npm run build" }
            "electron"        { Invoke-Step "Electron Build" "npm run build:electron" }
            default {
                Write-Err "Unknown step: $Only"
                Write-Err "Valid: lint validate-nodes type-check frontend-tests backend-lint backend-tests e2e build electron"
                exit 1
            }
        }
    } else {
        # ── Parallel mode ───────────────────────────────────────────────────

        # Phase 1: Lint (all independent checks in parallel)
        $lintNames = @("eslint", "nodes", "tsc")
        $lintCmds  = @("npm run lint", "npm run validate:nodes", "npx tsc --noEmit")

        if (-not $SkipBackend) {
            $lintNames += @("ruff", "py-syntax")
            $lintCmds  += @("npm run lint:ruff", "npm run lint:py-syntax")
        }

        Invoke-ParallelStep "Lint ($($lintCmds.Count) checks)" -Names $lintNames -Commands $lintCmds

        # Phase 2: Tests (vitest + pytest in parallel)
        if ($SkipBackend) {
            Invoke-Step "Frontend Tests" "npm run test:frontend"
        } else {
            Invoke-ParallelStep "Tests (vitest + pytest)" `
                -Names @("vitest", "pytest") `
                -Commands @("npm run test:frontend", "npm run test:backend")
        }

        # Phase 3: E2E
        if ($SkipE2E) { Skip-Step "E2E Tests" }
        else { Invoke-Step "E2E Tests" "npx playwright test --project=web-chromium --workers=2 --retries=2" }

        # Phase 4: Builds
        if ($SkipBuild) { Skip-Step "Web Build" }
        else {
            Invoke-Step "Web Build" "npm run build"
            if ($StepResult["Web Build"] -eq "pass") {
                $indexPath = Join-Path $ProjectRoot "dist\index.html"
                if (-not (Test-Path $indexPath)) {
                    $StepResult["Web Build"] = "fail"
                    Write-Err "Web Build - dist\index.html not found"
                } else { Write-Info "Web build OK" }
            }
        }

        if ($SkipElectron) { Skip-Step "Electron Build" }
        else {
            Invoke-Step "Electron Build" "npm run build:electron"
            if ($StepResult["Electron Build"] -eq "pass") {
                $distElectron = Join-Path $ProjectRoot "dist-electron"
                if (-not (Test-Path $distElectron)) {
                    $StepResult["Electron Build"] = "fail"
                    Write-Err "Electron Build - dist-electron not found"
                } else { Write-Info "Electron build OK" }
            }
        }
    }

    # ──────────────────────────────────────────────────────────────────────────
    # Summary
    # ──────────────────────────────────────────────────────────────────────────

    # Find max label width for alignment
    $maxLen = ($OrderedSteps | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum

    Write-Host ""
    Write-Host "${BOLD}$([char]0x2554)$([string][char]0x2550 * 63)$([char]0x2557)${RESET}"
    Write-Host "${BOLD}$([char]0x2551)           PRE-PUBLISH VALIDATION SUMMARY                      $([char]0x2551)${RESET}"
    Write-Host "${BOLD}$([char]0x2560)$([string][char]0x2550 * 63)$([char]0x2563)${RESET}"

    $AllPass = $true
    foreach ($step in $OrderedSteps) {
        $result = if ($StepResult.ContainsKey($step)) { $StepResult[$step] } else { "skip" }
        $padded = $step.PadRight($maxLen)
        switch ($result) {
            "pass" { Write-Host "${BOLD}$([char]0x2551)${RESET}  $padded  ${GREEN}$([char]0x2705) PASSED${RESET}" }
            "fail" { Write-Host "${BOLD}$([char]0x2551)${RESET}  $padded  ${RED}$([char]0x274C) FAILED${RESET}"
                     $AllPass = $false }
            "skip" { Write-Host "${BOLD}$([char]0x2551)${RESET}  $padded  ${YELLOW}$([char]0x23ED)  SKIPPED${RESET}" }
        }
    }

    Write-Host "${BOLD}$([char]0x2560)$([string][char]0x2550 * 63)$([char]0x2563)${RESET}"

    if ($AllPass) {
        Write-Host "${BOLD}$([char]0x2551)  ${GREEN}$([char]0x2714) Ready to publish! Create your release now.${RESET}${BOLD}              $([char]0x2551)${RESET}"
        Write-Host "${BOLD}$([char]0x255A)$([string][char]0x2550 * 63)$([char]0x255D)${RESET}"
    } else {
        Write-Host "${BOLD}$([char]0x2551)  ${RED}$([char]0x26A0)$([char]0xFE0F)  Fix issues above before creating a release.${RESET}${BOLD}              $([char]0x2551)${RESET}"
        Write-Host "${BOLD}$([char]0x255A)$([string][char]0x2550 * 63)$([char]0x255D)${RESET}"
        foreach ($step in $OrderedSteps) {
            if ($StepResult.ContainsKey($step) -and $StepResult[$step] -eq "fail") {
                Write-Err "Log for ${step}: $($StepLog[$step])"
            }
        }
        exit 1
    }

} finally {
    Pop-Location
    if (Test-Path $TmpLogDir) {
        Remove-Item -Recurse -Force $TmpLogDir -ErrorAction SilentlyContinue
    }
    # Restore original encodings
    [Console]::OutputEncoding = $prevOutputEncoding
    $OutputEncoding = $prevPSOutputEncoding
}
