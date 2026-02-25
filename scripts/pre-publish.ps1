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

# ──────────────────────────────────────────────────────────────────────────────
# State tracking
# ──────────────────────────────────────────────────────────────────────────────

$StepResult = @{}   # "pass" | "fail" | "skip"
$StepLog    = @{}   # path to log file

$TmpLogDir = Join-Path $env:TEMP "pre-publish-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $TmpLogDir -Force | Out-Null

function Invoke-Step {
    param(
        [string]$Name,
        [string]$Command
    )
    $logFile = Join-Path $TmpLogDir "$Name.log"
    $StepLog[$Name] = $logFile

    Write-Header $Name
    try {
        $output = cmd /c "$Command 2>&1"
        $exitCode = $LASTEXITCODE
        $output | Tee-Object -FilePath $logFile
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
    Write-Warn "$Name - SKIPPED"
}

function Test-ShouldRun {
    param([string]$Name)
    return (-not $Only) -or ($Only -eq $Name)
}

# ──────────────────────────────────────────────────────────────────────────────
# Steps
# ──────────────────────────────────────────────────────────────────────────────

try {
    Push-Location $ProjectRoot

    # ── 1. ESLint ────────────────────────────────────────────────────────────
    if (Test-ShouldRun "lint") {
        Invoke-Step "lint" "npm run lint"
    } else { Skip-Step "lint" }

    # ── 2. Validate nodes ────────────────────────────────────────────────────
    if (Test-ShouldRun "validate-nodes") {
        Invoke-Step "validate-nodes" "npm run validate:nodes"
    } else { Skip-Step "validate-nodes" }

    # ── 3. TypeScript type check ─────────────────────────────────────────────
    if (Test-ShouldRun "type-check") {
        Invoke-Step "type-check" "npx tsc --noEmit"
    } else { Skip-Step "type-check" }

    # ── 4. Frontend tests (vitest) ───────────────────────────────────────────
    if (Test-ShouldRun "frontend-tests") {
        Invoke-Step "frontend-tests" "npm run test -- --run"
    } else { Skip-Step "frontend-tests" }

    # ── 5. Backend lint (ruff) ───────────────────────────────────────────────
    if (Test-ShouldRun "backend-lint") {
        if ($SkipBackend) { Skip-Step "backend-lint" }
        else {
            Invoke-Step "backend-lint" "$Python -m ruff check ."
        }
    } else { Skip-Step "backend-lint" }

    # ── 6. Backend tests (pytest) ────────────────────────────────────────────
    if (Test-ShouldRun "backend-tests") {
        if ($SkipBackend) { Skip-Step "backend-tests" }
        else {
            Invoke-Step "backend-tests" "$Python -m pytest tests/ -v --tb=short --timeout=120"
        }
    } else { Skip-Step "backend-tests" }

    # ── 7. E2E tests (Playwright) ────────────────────────────────────────────
    if (Test-ShouldRun "e2e") {
        if ($SkipE2E) { Skip-Step "e2e" }
        else {
            Invoke-Step "e2e" "npx playwright test --project=web-chromium --workers=1"
        }
    } else { Skip-Step "e2e" }

    # ── 8. Production build ──────────────────────────────────────────────────
    if (Test-ShouldRun "build") {
        if ($SkipBuild) { Skip-Step "build" }
        else {
            Invoke-Step "build" "npm run build"
            if ($StepResult["build"] -eq "pass") {
                $indexPath = Join-Path $ProjectRoot "dist\index.html"
                if (-not (Test-Path $indexPath)) {
                    $StepResult["build"] = "fail"
                    Write-Err "build - dist\index.html not found"
                } else {
                    Write-Info "Web build OK"
                }
            }
        }
    } else { Skip-Step "build" }

    # ── 9. Electron build ────────────────────────────────────────────────────
    if (Test-ShouldRun "electron") {
        if ($SkipElectron) { Skip-Step "electron" }
        else {
            Invoke-Step "electron" "npm run build:electron"
            if ($StepResult["electron"] -eq "pass") {
                $distElectron = Join-Path $ProjectRoot "dist-electron"
                if (-not (Test-Path $distElectron)) {
                    $StepResult["electron"] = "fail"
                    Write-Err "electron - dist-electron not found"
                } else {
                    Write-Info "Electron build OK"
                }
            }
        }
    } else { Skip-Step "electron" }

    # ──────────────────────────────────────────────────────────────────────────
    # Summary
    # ──────────────────────────────────────────────────────────────────────────

    $OrderedSteps = @(
        @{ Key = "lint";            Label = "ESLint        " }
        @{ Key = "validate-nodes";  Label = "Node Registry " }
        @{ Key = "type-check";      Label = "TypeScript    " }
        @{ Key = "frontend-tests";  Label = "Frontend Tests" }
        @{ Key = "backend-lint";    Label = "Backend Lint  " }
        @{ Key = "backend-tests";   Label = "Backend Tests " }
        @{ Key = "e2e";             Label = "E2E Tests     " }
        @{ Key = "build";           Label = "Web Build     " }
        @{ Key = "electron";        Label = "Electron Build" }
    )

    Write-Host ""
    Write-Host "${BOLD}$([char]0x2554)$([string][char]0x2550 * 63)$([char]0x2557)${RESET}"
    Write-Host "${BOLD}$([char]0x2551)           PRE-PUBLISH VALIDATION SUMMARY                      $([char]0x2551)${RESET}"
    Write-Host "${BOLD}$([char]0x2560)$([string][char]0x2550 * 63)$([char]0x2563)${RESET}"

    $AllPass = $true
    foreach ($step in $OrderedSteps) {
        $key = $step.Key
        $label = $step.Label
        $result = if ($StepResult.ContainsKey($key)) { $StepResult[$key] } else { "skip" }
        switch ($result) {
            "pass" { Write-Host "${BOLD}$([char]0x2551)${RESET}  $label ${GREEN}$([char]0x2705) PASSED${RESET}                                   ${BOLD}$([char]0x2551)${RESET}" }
            "fail" { Write-Host "${BOLD}$([char]0x2551)${RESET}  $label ${RED}$([char]0x274C) FAILED${RESET}                                   ${BOLD}$([char]0x2551)${RESET}"
                     $AllPass = $false }
            "skip" { Write-Host "${BOLD}$([char]0x2551)${RESET}  $label ${YELLOW}$([char]0x23ED)  SKIPPED${RESET}                                  ${BOLD}$([char]0x2551)${RESET}" }
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
            $key = $step.Key
            if ($StepResult.ContainsKey($key) -and $StepResult[$key] -eq "fail") {
                Write-Err "Log for ${key}: $($StepLog[$key])"
            }
        }
        exit 1
    }

} finally {
    Pop-Location
    if (Test-Path $TmpLogDir) {
        Remove-Item -Recurse -Force $TmpLogDir -ErrorAction SilentlyContinue
    }
}
