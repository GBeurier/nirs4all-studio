#!/usr/bin/env bash
# scripts/pre-publish.sh
# Mirrors .github/workflows/ci.yml + playwright.yml locally.
#
# Usage:
#   ./scripts/pre-publish.sh [OPTIONS]
#
# Options:
#   --skip-backend       Skip backend lint + tests
#   --skip-e2e           Skip Playwright E2E tests
#   --skip-build         Skip production build validation
#   --skip-electron      Skip Electron build test
#   --only STEP          Run only one step: lint | validate-nodes | type-check |
#                        frontend-tests | backend-lint | backend-tests | e2e | build | electron
#   --docker             Run inside a clean ubuntu:24.04 Docker container (closest to GitHub Actions)
#   --python PYTHON      Python interpreter to use (default: .venv/bin/python or python3)
#   -h, --help           Show this help

set -euo pipefail

ALL_ARGS=("$@")

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[pre-publish]${RESET} $*"; }
success() { echo -e "${GREEN}[pre-publish]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[pre-publish]${RESET} $*"; }
err()     { echo -e "${RED}[pre-publish]${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}"; \
            echo -e "${BOLD}${CYAN}  $*${RESET}"; \
            echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}"; }

# ──────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ──────────────────────────────────────────────────────────────────────────────

SKIP_BACKEND=false
SKIP_E2E=false
SKIP_BUILD=false
SKIP_ELECTRON=false
ONLY_STEP=""
PYTHON=""
USE_DOCKER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-backend)   SKIP_BACKEND=true; shift ;;
    --skip-e2e)       SKIP_E2E=true; shift ;;
    --skip-build)     SKIP_BUILD=true; shift ;;
    --skip-electron)  SKIP_ELECTRON=true; shift ;;
    --only)           ONLY_STEP="$2"; shift 2 ;;
    --python)         PYTHON="$2"; shift 2 ;;
    --docker)         USE_DOCKER=true; shift ;;
    -h|--help)
      sed -n '/^# Usage:/,/^[^#]/p' "$0" | head -n -1 | sed 's/^# \{0,3\}//'
      exit 0 ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# ──────────────────────────────────────────────────────────────────────────────
# Resolve project root
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
  err "Could not locate package.json under $PROJECT_ROOT"
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
# Resolve Python interpreter
# ──────────────────────────────────────────────────────────────────────────────

if [[ -z "$PYTHON" ]]; then
  if [[ -f "$PROJECT_ROOT/.venv/bin/python" ]]; then
    PYTHON="$PROJECT_ROOT/.venv/bin/python"
  elif [[ -f "$PROJECT_ROOT/../.venv/bin/python" ]]; then
    PYTHON="$PROJECT_ROOT/../.venv/bin/python"
  else
    PYTHON="python3"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# Docker mode – re-run this script inside a clean ubuntu:24.04 container
# ──────────────────────────────────────────────────────────────────────────────

if $USE_DOCKER; then
  info "Docker mode: running inside ubuntu:24.04 container"

  if ! command -v docker &>/dev/null; then
    err "Docker not found. Install Docker first or run without --docker."
    exit 1
  fi

  # Forward all original flags except --docker
  FORWARD_ARGS=()
  for arg in "${ALL_ARGS[@]}"; do
    [[ "$arg" != "--docker" ]] && FORWARD_ARGS+=("$arg")
  done

  exec docker run --rm \
    --cpus=8 \
    -v "$PROJECT_ROOT:/workspace:ro" \
    ubuntu:24.04 \
    bash -c "
      set -e
      export DEBIAN_FRONTEND=noninteractive

      echo '[docker] Installing system packages ...'
      apt-get update -qq && apt-get install -y -qq \
        bash python3 python3-pip python3-venv git rsync curl \
        libgirepository1.0-dev libcairo2-dev \
        gir1.2-gtk-3.0 gir1.2-webkit2-4.1 \
        2>&1 | tail -1

      # Install Node.js 22
      echo '[docker] Installing Node.js 22 ...'
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tail -1
      apt-get install -y -qq nodejs 2>&1 | tail -1

      echo '[docker] Copying repo to writable /build ...'
      rsync -a --info=progress2 \
        --exclude '.venv' --exclude '.git' --exclude '__pycache__' \
        --exclude 'node_modules' --exclude '.ruff_cache' \
        --exclude '.pytest_cache' --exclude 'dist' --exclude 'dist-electron' \
        --exclude 'playwright-report' --exclude 'test-results' \
        /workspace/ /build/

      echo '[docker] Setting up Python venv ...'
      python3 -m venv /build/.venv
      export PATH=/build/.venv/bin:\$PATH

      echo '[docker] Installing Python dependencies ...'
      cd /build
      pip install --quiet --upgrade pip
      pip install --quiet -r requirements.txt
      pip install --quiet -r requirements-test.txt
      pip install --quiet ruff nirs4all

      echo '[docker] Installing Node dependencies ...'
      npm ci --quiet

      # Install Playwright browsers (only chromium for E2E)
      npx playwright install --with-deps chromium 2>&1 | tail -3

      echo '[docker] Running pre-publish validation ...'
      bash scripts/pre-publish.sh --python /build/.venv/bin/python ${FORWARD_ARGS[*]:-}
    "
fi

# ──────────────────────────────────────────────────────────────────────────────
# State tracking
# ──────────────────────────────────────────────────────────────────────────────

declare -A STEP_RESULT   # "pass" | "fail" | "skip"
declare -A STEP_LOG      # path to log file

TMPDIR_LOGS="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOGS"' EXIT

run_step() {
  local name="$1"; shift
  local logfile="$TMPDIR_LOGS/${name}.log"
  STEP_LOG[$name]="$logfile"

  header "$name"
  if "$@" 2>&1 | tee "$logfile"; then
    STEP_RESULT[$name]="pass"
    success "$name — PASSED"
  else
    STEP_RESULT[$name]="fail"
    err "$name — FAILED  (full log: $logfile)"
  fi
}

skip_step() {
  local name="$1"
  STEP_RESULT[$name]="skip"
  warn "$name — SKIPPED"
}

should_run() {
  local name="$1"
  [[ -z "$ONLY_STEP" || "$ONLY_STEP" == "$name" ]]
}

# ──────────────────────────────────────────────────────────────────────────────
# Steps
# ──────────────────────────────────────────────────────────────────────────────

cd "$PROJECT_ROOT"

# ── 1. ESLint ────────────────────────────────────────────────────────────────
if should_run lint; then
  run_step lint npm run lint
else
  skip_step lint
fi

# ── 2. Validate nodes ────────────────────────────────────────────────────────
if should_run validate-nodes; then
  run_step validate-nodes npm run validate:nodes
else
  skip_step validate-nodes
fi

# ── 3. TypeScript type check ─────────────────────────────────────────────────
if should_run type-check; then
  run_step type-check npx tsc --noEmit
else
  skip_step type-check
fi

# ── 4. Frontend tests (vitest) ───────────────────────────────────────────────
if should_run frontend-tests; then
  run_step frontend-tests npm run test -- --run
else
  skip_step frontend-tests
fi

# ── 5. Backend lint (ruff) ───────────────────────────────────────────────────
if should_run backend-lint; then
  if $SKIP_BACKEND; then
    skip_step backend-lint
  else
    run_step backend-lint bash -c "
      $PYTHON -m pip install --quiet ruff 2>/dev/null || pip install --quiet ruff
      ruff check .
    "
  fi
else
  skip_step backend-lint
fi

# ── 6. Backend tests (pytest) ────────────────────────────────────────────────
if should_run backend-tests; then
  if $SKIP_BACKEND; then
    skip_step backend-tests
  else
    run_step backend-tests bash -c "
      $PYTHON -m pytest tests/ -v --tb=short --timeout=120
    "
  fi
else
  skip_step backend-tests
fi

# ── 7. E2E tests (Playwright) ───────────────────────────────────────────────
if should_run e2e; then
  if $SKIP_E2E; then
    skip_step e2e
  else
    run_step e2e npx playwright test --project=web-chromium
  fi
else
  skip_step e2e
fi

# ── 8. Production build ─────────────────────────────────────────────────────
if should_run build; then
  if $SKIP_BUILD; then
    skip_step build
  else
    run_step build bash -c "
      npm run build
      test -f dist/index.html || { echo 'dist/index.html not found'; exit 1; }
      echo 'Web build OK'
    "
  fi
else
  skip_step build
fi

# ── 9. Electron build ───────────────────────────────────────────────────────
if should_run electron; then
  if $SKIP_ELECTRON; then
    skip_step electron
  else
    run_step electron bash -c "
      npm run build:electron
      test -d dist-electron || { echo 'dist-electron not found'; exit 1; }
      echo 'Electron build OK'
    "
  fi
else
  skip_step electron
fi

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║           PRE-PUBLISH VALIDATION SUMMARY                      ║${RESET}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════════════════╣${RESET}"

ALL_PASS=true
ORDERED_STEPS=(lint validate-nodes type-check frontend-tests backend-lint backend-tests e2e build electron)
declare -A STEP_LABELS=(
  [lint]="ESLint        "
  [validate-nodes]="Node Registry "
  [type-check]="TypeScript    "
  [frontend-tests]="Frontend Tests"
  [backend-lint]="Backend Lint  "
  [backend-tests]="Backend Tests "
  [e2e]="E2E Tests     "
  [build]="Web Build     "
  [electron]="Electron Build"
)

for step in "${ORDERED_STEPS[@]}"; do
  result="${STEP_RESULT[$step]:-skip}"
  label="${STEP_LABELS[$step]}"
  case "$result" in
    pass) echo -e "${BOLD}║${RESET}  ${label} ${GREEN}✅ PASSED${RESET}                                   ${BOLD}║${RESET}" ;;
    fail) echo -e "${BOLD}║${RESET}  ${label} ${RED}❌ FAILED${RESET}                                   ${BOLD}║${RESET}"
          ALL_PASS=false ;;
    skip) echo -e "${BOLD}║${RESET}  ${label} ${YELLOW}⏭  SKIPPED${RESET}                                  ${BOLD}║${RESET}" ;;
  esac
done

echo -e "${BOLD}╠═══════════════════════════════════════════════════════════════╣${RESET}"

if $ALL_PASS; then
  echo -e "${BOLD}║  ${GREEN}🎉 Ready to publish! Create your release now.${RESET}${BOLD}              ║${RESET}"
  echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${RESET}"
  exit 0
else
  echo -e "${BOLD}║  ${RED}⚠️  Fix issues above before creating a release.${RESET}${BOLD}              ║${RESET}"
  echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${RESET}"
  # Print failed log paths
  for step in "${ORDERED_STEPS[@]}"; do
    if [[ "${STEP_RESULT[$step]:-}" == "fail" ]]; then
      err "Log for $step: ${STEP_LOG[$step]}"
    fi
  done
  exit 1
fi
