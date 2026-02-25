#!/usr/bin/env bash
# CI Docker entrypoint — runs one or all test targets
# Usage: docker run --rm nirs4all-webapp-ci [target]
# Targets: all, frontend, backend, e2e, lint, build

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

FAILED=()

run_step() {
    local name="$1"
    shift
    echo -e "\n${CYAN}${BOLD}═══ ${name} ═══${NC}"
    if "$@"; then
        echo -e "${GREEN}✓ ${name} passed${NC}"
    else
        echo -e "${RED}✗ ${name} failed${NC}"
        FAILED+=("$name")
        return 1
    fi
}

do_lint() {
    run_step "Lint (parallel)" npx concurrently --group \
        --names "eslint,tsc,nodes,ruff,py-syntax" \
        --prefix-colors "blue,cyan,magenta,yellow,green" \
        "npm:lint:eslint" "npm:lint:tsc" "npm:lint:nodes" "npm:lint:ruff" "npm:lint:py-syntax"
}

do_frontend() {
    run_step "Vitest" npm run test -- --run
    run_step "Build (web)" npm run build
    run_step "Build (electron)" npm run build:electron
    run_step "Verify build" bash -c '
        test -f dist/index.html || { echo "dist/index.html not found"; exit 1; }
        test -d dist-electron || { echo "dist-electron not found"; exit 1; }
        echo "Build outputs verified"
    '
}

do_backend() {
    run_step "Python imports" python -c "
import fastapi, uvicorn
print('FastAPI', fastapi.__version__)
print('Uvicorn', uvicorn.__version__)
"
    run_step "CLI args" python main.py --help
    run_step "Pytest (parallel)" python -m pytest tests/ -v --tb=short --timeout=120 -n auto --cov=api --cov-report=term-missing
}

do_e2e() {
    run_step "Playwright E2E" npx playwright test --project=web-chromium
}

do_all() {
    local exit_code=0
    do_lint || exit_code=1
    do_frontend || exit_code=1
    do_backend || exit_code=1
    do_e2e || exit_code=1
    return $exit_code
}

print_summary() {
    echo -e "\n${BOLD}═══════════════════════════════════════${NC}"
    if [ ${#FAILED[@]} -eq 0 ]; then
        echo -e "${GREEN}${BOLD}All checks passed${NC}"
    else
        echo -e "${RED}${BOLD}Failed checks:${NC}"
        for f in "${FAILED[@]}"; do
            echo -e "  ${RED}✗ ${f}${NC}"
        done
        return 1
    fi
}

TARGET="${1:-all}"

case "$TARGET" in
    all)      do_all;      print_summary ;;
    lint)     do_lint;      print_summary ;;
    frontend) do_frontend;  print_summary ;;
    backend)  do_backend;   print_summary ;;
    e2e)      do_e2e;       print_summary ;;
    build)    do_frontend;  print_summary ;;
    shell)    exec /bin/bash ;;
    *)
        echo "Usage: $0 {all|lint|frontend|backend|e2e|build|shell}"
        exit 1
        ;;
esac
