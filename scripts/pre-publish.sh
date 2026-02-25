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

# Ensure venv tools (ruff, pytest, etc.) are in PATH for npm scripts
if [[ -n "$PYTHON" && "$PYTHON" != "python3" && -f "$PYTHON" ]]; then
  VENV_BIN="$(dirname "$PYTHON")"
  export PATH="$VENV_BIN:$PATH"
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
ORDERED_STEPS=()         # populated dynamically for summary

TMPDIR_LOGS="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOGS"' EXIT

run_step() {
  local name="$1"; shift
  local safe_name="${name//[^a-zA-Z0-9_-]/_}"
  local logfile="$TMPDIR_LOGS/${safe_name}.log"
  STEP_LOG[$name]="$logfile"
  ORDERED_STEPS+=("$name")

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
  ORDERED_STEPS+=("$name")
  warn "$name — SKIPPED"
}

# ──────────────────────────────────────────────────────────────────────────────
# Steps
# ──────────────────────────────────────────────────────────────────────────────

cd "$PROJECT_ROOT"

if [[ -n "$ONLY_STEP" ]]; then
  # ── Single step mode ──────────────────────────────────────────────────────
  case "$ONLY_STEP" in
    lint)            run_step "ESLint" npm run lint ;;
    validate-nodes)  run_step "Node Registry" npm run validate:nodes ;;
    type-check)      run_step "TypeScript" npx tsc --noEmit ;;
    frontend-tests)  run_step "Frontend Tests" npm run test:frontend ;;
    backend-lint)    run_step "Backend Lint" npm run lint:ruff ;;
    backend-tests)   run_step "Backend Tests" npm run test:backend ;;
    e2e)             run_step "E2E Tests" npx playwright test --project=web-chromium --workers=2 --retries=2 ;;
    build)           run_step "Web Build" bash -c "npm run build && test -f dist/index.html && echo 'Web build OK'" ;;
    electron)        run_step "Electron Build" bash -c "npm run build:electron && test -d dist-electron && echo 'Electron build OK'" ;;
    *) err "Unknown step: $ONLY_STEP"; err "Valid: lint validate-nodes type-check frontend-tests backend-lint backend-tests e2e build electron"; exit 1 ;;
  esac
else
  # ── Parallel mode ─────────────────────────────────────────────────────────

  # Phase 1: Lint (all independent checks in parallel)
  LINT_CMDS=()
  LINT_NAMES=()

  LINT_CMDS+=("npm run lint");           LINT_NAMES+=("eslint")
  LINT_CMDS+=("npm run validate:nodes"); LINT_NAMES+=("nodes")
  LINT_CMDS+=("npx tsc --noEmit");       LINT_NAMES+=("tsc")

  if ! $SKIP_BACKEND; then
    LINT_CMDS+=("npm run lint:ruff");      LINT_NAMES+=("ruff")
    LINT_CMDS+=("npm run lint:py-syntax"); LINT_NAMES+=("py-syntax")
  fi

  run_step "Lint (${#LINT_CMDS[@]} checks)" npx concurrently --group \
    --names "$(IFS=,; echo "${LINT_NAMES[*]}")" \
    "${LINT_CMDS[@]}"

  # Phase 2: Tests (vitest + pytest in parallel)
  if $SKIP_BACKEND; then
    run_step "Frontend Tests" npm run test:frontend
  else
    run_step "Tests (vitest + pytest)" npx concurrently --group \
      --names "vitest,pytest" \
      "npm run test:frontend" \
      "npm run test:backend"
  fi

  # Phase 3: E2E
  if $SKIP_E2E; then
    skip_step "E2E Tests"
  else
    run_step "E2E Tests" npx playwright test --project=web-chromium --workers=2 --retries=2
  fi

  # Phase 4: Builds
  if $SKIP_BUILD; then
    skip_step "Web Build"
  else
    run_step "Web Build" bash -c "npm run build && test -f dist/index.html && echo 'Web build OK'"
  fi

  if $SKIP_ELECTRON; then
    skip_step "Electron Build"
  else
    run_step "Electron Build" bash -c "npm run build:electron && test -d dist-electron && echo 'Electron build OK'"
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║           PRE-PUBLISH VALIDATION SUMMARY                      ║${RESET}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════════════════╣${RESET}"

ALL_PASS=true

# Find max label width for alignment
MAX_LEN=0
for step in "${ORDERED_STEPS[@]}"; do
  [[ ${#step} -gt $MAX_LEN ]] && MAX_LEN=${#step}
done

for step in "${ORDERED_STEPS[@]}"; do
  result="${STEP_RESULT[$step]:-skip}"
  padded=$(printf "%-${MAX_LEN}s" "$step")
  case "$result" in
    pass) echo -e "${BOLD}║${RESET}  ${padded}  ${GREEN}✅ PASSED${RESET}" ;;
    fail) echo -e "${BOLD}║${RESET}  ${padded}  ${RED}❌ FAILED${RESET}"
          ALL_PASS=false ;;
    skip) echo -e "${BOLD}║${RESET}  ${padded}  ${YELLOW}⏭  SKIPPED${RESET}" ;;
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
  for step in "${ORDERED_STEPS[@]}"; do
    if [[ "${STEP_RESULT[$step]:-}" == "fail" ]]; then
      err "Log for $step: ${STEP_LOG[$step]}"
    fi
  done
  exit 1
fi
